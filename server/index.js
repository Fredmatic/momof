require("dotenv").config();

const path = require("path");
const express = require("express");
const cors = require("cors");
const session = require("express-session");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcrypt");
const supabase = require("./supabaseClient");

const app = express();

const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || "momo-beauty-secret";
// Comma-separated list of allowed origins, e.g. "http://127.0.0.1:5500,http://localhost:5500"
const CLIENT_ORIGINS = (process.env.CLIENT_ORIGIN || "http://127.0.0.1:5500,http://localhost:5500")
    .split(",")
    .map(origin => origin.trim());

app.use(cors({
    origin: CLIENT_ORIGINS,
    credentials: true
}));

app.use(express.json());

app.set("trust proxy", 1); // needed so secure cookies work correctly on Render

app.use(session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        // Render (and most hosts) serve your app over https, so secure
        // cookies should be on in production and off for local http testing.
        secure: process.env.NODE_ENV === "production"
    }
}));

// Serve the frontend (HTML/CSS/JS/images) directly from this same server,
// so you can open http://localhost:3000 and get the whole site without
// running a separate static server.
app.use(express.static(path.join(__dirname, "..")));

function requireLogin(req, res, next) {

    if (!req.session.user) {
        return res.status(401).json({
            message: "Unauthorized."
        });
    }

    next();
}
function requireAdmin(req, res, next) {

    if (!req.session.user || req.session.user.role !== "admin") {
        return res.status(403).json({
            message: "Admin access required."
        });
    }

    next();
}

// Slows down password guessing: after 5 failed or successful attempts from
// the same device in 15 minutes, further attempts get a 429 error instead
// of reaching the database. Successful logins don't reset the count, so a
// burst of correct logins from one shared device (e.g. reception) can also
// hit the limit -- that's intentional, it's still a burst of attempts.
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    limit: 5,
    standardHeaders: true, // adds RateLimit-* response headers
    legacyHeaders: false,
    message: { message: "Too many login attempts. Please try again in 15 minutes." }
});

// Simple health-check endpoint (the "/" route itself is now served by
// express.static above, which returns index.html).
app.get("/api/status", (req, res) => {
    res.send("MOMO's PALOR server is running!");
});

app.post("/bookings", async (req, res) => {

    const booking = req.body;

    try {

        const { data: existingBooking, error: findError } = await supabase
            .from("bookings")
            .select("id")
            .eq("service", booking.service)
            .eq("date", booking.date)
            .eq("time", booking.time)
            .neq("status", "cancelled")
            .maybeSingle();

        if (findError) throw findError;

        if (existingBooking) {
            return res.status(409).json({
                message: "This time slot is already booked."
            });
        }

        const { error: insertError } = await supabase
            .from("bookings")
            .insert({
                reference: booking.reference,
                service: booking.service,
                price: booking.price,
                date: booking.date,
                time: booking.time,
                name: booking.name,
                phone: booking.phone,
                status: booking.status || "pending",
                username: req.session.user ? req.session.user.username : null
            });

        if (insertError) throw insertError;

        console.log("New booking received:", booking.reference);

        res.json({
            message: "Booking received successfully"
        });

    } catch (error) {
        console.error("Error creating booking:", error.message);
        res.status(500).json({
            message: "Something went wrong while creating the booking."
        });
    }

});

// Admin-only: full bookings list for the dashboard.
app.get("/bookings", requireAdmin, async (req, res) => {

    const { data, error } = await supabase
        .from("bookings")
        .select("*")
        .order("created_at", { ascending: false });

    if (error) {
        console.error("Error fetching bookings:", error.message);
        return res.status(500).json({ message: "Could not load bookings." });
    }

    res.json(data);

});

// Public: look up a single booking by its reference (used by the
// "check your booking status" box on the services page). This intentionally
// does NOT require login, but only ever returns the one matching booking,
// never the full list.
app.get("/bookings/status/:reference", async (req, res) => {

    const { data, error } = await supabase
        .from("bookings")
        .select("*")
        .eq("reference", req.params.reference.toUpperCase())
        .maybeSingle();

    if (error) {
        console.error("Error looking up booking:", error.message);
        return res.status(500).json({ message: "Could not look up that booking." });
    }

    if (!data) {
        return res.status(404).json({ message: "Booking not found." });
    }

    res.json(data);

});

// A logged-in customer's own bookings, newest first (for "My Bookings").
app.get("/bookings/mine", requireLogin, async (req, res) => {

    const { data, error } = await supabase
        .from("bookings")
        .select("*")
        .eq("username", req.session.user.username)
        .order("date", { ascending: false })
        .order("time", { ascending: false });

    if (error) {
        console.error("Error fetching my bookings:", error.message);
        return res.status(500).json({ message: "Could not load your bookings." });
    }

    res.json(data);

});

// Public: which times are already taken for a service on a given date?
// Only the times are returned (never names or phone numbers), so it is
// safe to leave open. The booking form uses it to grey out taken slots.
app.get("/bookings/availability", async (req, res) => {

    const { service, date } = req.query;

    if (!service || !/^\d{4}-\d{2}-\d{2}$/.test(date || "")) {
        return res.status(400).json({
            message: "A service and a date (YYYY-MM-DD) are required."
        });
    }

    const { data, error } = await supabase
        .from("bookings")
        .select("time")
        .eq("service", service)
        .eq("date", date)
        .neq("status", "cancelled");

    if (error) {
        console.error("Error checking availability:", error.message);
        return res.status(500).json({ message: "Could not check availability." });
    }

    res.json({ bookedTimes: data.map(booking => booking.time) });

});

app.patch("/bookings/:reference", requireAdmin, async (req, res) => {

    const reference = req.params.reference;
    const newStatus = req.body.status;

    const { data, error } = await supabase
        .from("bookings")
        .update({ status: newStatus })
        .eq("reference", reference)
        .select()
        .maybeSingle();

    if (error) {
        console.error("Error updating booking:", error.message);
        return res.status(500).json({ message: "Could not update booking." });
    }

    if (!data) {
        return res.status(404).json({
            message: "Booking not found"
        });
    }

    res.json({
        message: "Booking status updated",
        booking: data
    });

});

app.post("/register", async (req, res) => {

    const { username, password } = req.body;

    try {

        const { data: existingUser, error: findError } = await supabase
            .from("users")
            .select("id")
            .eq("username", username)
            .maybeSingle();

        if (findError) throw findError;

        if (existingUser) {
            return res.status(409).json({
                message: "Username already exists."
            });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const { data: newUser, error: insertError } = await supabase
            .from("users")
            .insert({
                username: username,
                password: hashedPassword,
                role: "customer"
            })
            .select()
            .single();

        if (insertError) throw insertError;

        req.session.user = {
            username: newUser.username,
            role: newUser.role
        };

        res.json({
            message: "Account created successfully.",
            username: newUser.username,
            role: newUser.role
        });

    } catch (error) {
        console.error("Error registering user:", error.message);
        res.status(500).json({ message: "Something went wrong while creating the account." });
    }

});

app.post("/login", loginLimiter, async (req, res) => {

    const { username, password } = req.body;

    try {

        const { data: user, error } = await supabase
            .from("users")
            .select("*")
            .eq("username", username)
            .maybeSingle();

        if (error) throw error;

        if (!user) {
            return res.status(401).json({
                message: "Invalid username or password."
            });
        }

        const passwordMatch = await bcrypt.compare(password, user.password);

        if (!passwordMatch) {
            return res.status(401).json({
                message: "Invalid username or password."
            });
        }

        req.session.user = {
            username: user.username,
            role: user.role
        };

        res.json({
            message: "Login successful",
            username: user.username,
            role: user.role
        });

    } catch (error) {
        console.error("Error logging in:", error.message);
        res.status(500).json({ message: "Something went wrong while logging in." });
    }

});

app.get("/check-login", (req, res) => {

    if (!req.session.user) {
        return res.status(401).json({
            message: "You are not logged in."
        });
    }

    res.json({
        loggedIn: true,
        username: req.session.user.username,
        role: req.session.user.role
    });

});

app.post("/logout", (req, res) => {

    req.session.destroy((error) => {

        if (error) {
            return res.status(500).json({
                message: "Logout failed."
            });
        }

        res.clearCookie("connect.sid");

        res.json({
            message: "Logout successful."
        });

    });

});

app.post("/create-admin", async (req, res) => {

    const { username, password } = req.body;

    try {

        const { data: existingAdmin, error: findError } = await supabase
            .from("users")
            .select("id")
            .eq("role", "admin")
            .maybeSingle();

        if (findError) throw findError;

        if (existingAdmin) {
            return res.status(403).json({
                message: "An admin account already exists."
            });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const { error: insertError } = await supabase
            .from("users")
            .insert({
                username: username,
                password: hashedPassword,
                role: "admin"
            });

        if (insertError) throw insertError;

        res.json({
            message: "Admin account created successfully."
        });

    } catch (error) {
        console.error("Error creating admin:", error.message);
        res.status(500).json({ message: "Something went wrong while creating the admin account." });
    }

});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});