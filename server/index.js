require("dotenv").config();

const path = require("path");
const express = require("express");
const cors = require("cors");
const session = require("express-session");
const pgSession = require("connect-pg-simple")(session);
const { Pool } = require("pg");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcrypt");
const multer = require("multer");
const supabase = require("./supabaseClient");
const { sendBookingReceivedEmail, sendAdminNewBookingEmail, sendBookingStatusEmail } = require("./mailer");

// Accepts one uploaded image file at a time, kept in memory just long
// enough to hand off to Supabase Storage (never written to disk).
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith("image/")) {
            cb(null, true);
        } else {
            cb(new Error("Only image files are allowed."));
        }
    }
});

const STORAGE_BUCKET = "site-uploads";

// Creates the bucket the first time the server ever starts against a given
// Supabase project. Safe to run on every startup -- if it already exists,
// Supabase just returns an error we quietly ignore.
async function ensureStorageBucket() {
    const { error } = await supabase.storage.createBucket(STORAGE_BUCKET, {
        public: true,
        fileSizeLimit: "5MB"
    });

    if (error && !String(error.message).toLowerCase().includes("already exists")) {
        console.error("Could not set up the storage bucket:", error.message);
    }
}
ensureStorageBucket();

// Uploads one file buffer to Supabase Storage under the given folder and
// returns its public URL, or null if no file was provided. Throws on a
// real storage error so the calling route's try/catch can handle it.
async function uploadImage(file, folder) {

    if (!file) {
        return null;
    }

    const safeName = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, "_");
    const path = `${folder}/${Date.now()}-${safeName}`;

    const { error } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(path, file.buffer, { contentType: file.mimetype });

    if (error) throw error;

    const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);

    return data.publicUrl;
}

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

// Sessions are stored in Postgres (the same Supabase database everything
// else uses) whenever DATABASE_URL is set, so logins survive server
// restarts, redeploys, and Render's free-tier spin-downs. Without
// DATABASE_URL, it falls back to the default in-memory store (fine for
// quick local testing, but everyone gets logged out on every restart).
let sessionStore;

if (process.env.DATABASE_URL) {

    const pgPool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false } // required for Supabase's Postgres
    });

    sessionStore = new pgSession({
        pool: pgPool,
        tableName: "user_sessions",
        createTableIfMissing: true
    });

    console.log("Sessions are stored in Postgres (persistent across restarts).");

} else {
    console.log(
        "DATABASE_URL is not set -- using in-memory sessions. " +
        "Everyone will be logged out whenever the server restarts. " +
        "See the \"Persistent sessions\" section in README.md to fix this."
    );
}

app.use(session({
    store: sessionStore, // undefined falls back to express-session's default MemoryStore
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

app.post("/bookings", upload.single("photo"), async (req, res) => {

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

        // Reference photos live in their own folder, named with the
        // booking reference so they're easy to find in Supabase Storage.
        const photoUrl = await uploadImage(req.file, `bookings/${booking.reference}`);

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
                email: booking.email || null,
                photo_url: photoUrl,
                status: booking.status || "pending",
                username: req.session.user ? req.session.user.username : null
            });

        if (insertError) throw insertError;

        console.log("New booking received:", booking.reference);

        res.json({
            message: "Booking received successfully"
        });

        // Fire-and-forget: emails never block or fail the booking response.
        sendBookingReceivedEmail(booking);
        sendAdminNewBookingEmail(booking);

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

    // Fire-and-forget: emails never block or fail the status update response.
    sendBookingStatusEmail(data);

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

// Public: anyone can see the product list, including out-of-stock items
// (the frontend shows those with a badge instead of the WhatsApp button,
// rather than hiding them, so the admin can still see what's temporarily
// unavailable).
app.get("/products", async (req, res) => {

    try {

        const { data, error } = await supabase
            .from("products")
            .select("*")
            .order("created_at", { ascending: false });

        if (error) throw error;

        res.json(data);

    } catch (error) {
        console.error("Error fetching products:", error.message);
        res.status(500).json({ message: "Something went wrong while loading products." });
    }

});

// Admin-only: add a new product.
// Converts "true"/"false" strings (from multipart form uploads) and real
// booleans (from the plain-JSON toggle-stock button) into an actual
// boolean, so either client can use this route correctly.
function parseBool(value, fallback) {
    if (value === undefined) return fallback;
    if (typeof value === "boolean") return value;
    return value === "true";
}

app.post("/products", requireAdmin, upload.single("image"), async (req, res) => {

    const { name, description, price } = req.body;

    if (!name || price === undefined || price === null || price === "") {
        return res.status(400).json({
            message: "A name and price are required."
        });
    }

    try {

        const imageUrl = await uploadImage(req.file, "products");

        const { data, error } = await supabase
            .from("products")
            .insert({
                name,
                description: description || null,
                price: Number(price),
                image: imageUrl,
                in_stock: parseBool(req.body.in_stock, true)
            })
            .select()
            .single();

        if (error) throw error;

        res.json(data);

    } catch (error) {
        console.error("Error creating product:", error.message);
        res.status(500).json({ message: "Something went wrong while adding the product." });
    }

});

// Admin-only: update any fields on an existing product (name, price,
// description, image, or in_stock -- e.g. to mark something as
// out-of-stock without deleting it). Handles both a plain JSON request
// (the quick "toggle stock" button) and a multipart request with a new
// image file (the edit form).
app.patch("/products/:id", requireAdmin, upload.single("image"), async (req, res) => {

    const { id } = req.params;
    const { name, description, price } = req.body;

    const updates = {};
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (price !== undefined) updates.price = Number(price);
    if (req.body.in_stock !== undefined) updates.in_stock = parseBool(req.body.in_stock);

    try {

        // Only replace the image if a new file was actually uploaded --
        // otherwise leave whatever's already stored untouched.
        const newImageUrl = await uploadImage(req.file, "products");
        if (newImageUrl) {
            updates.image = newImageUrl;
        }

        const { data, error } = await supabase
            .from("products")
            .update(updates)
            .eq("id", id)
            .select()
            .maybeSingle();

        if (error) throw error;

        if (!data) {
            return res.status(404).json({ message: "Product not found." });
        }

        res.json(data);

    } catch (error) {
        console.error("Error updating product:", error.message);
        res.status(500).json({ message: "Something went wrong while updating the product." });
    }

});

// Admin-only: permanently remove a product (and its stored photo, if it
// has one, to avoid leaving orphaned files in storage).
app.delete("/products/:id", requireAdmin, async (req, res) => {

    const { id } = req.params;

    try {

        const { data: product } = await supabase
            .from("products")
            .select("image")
            .eq("id", id)
            .maybeSingle();

        const { error } = await supabase
            .from("products")
            .delete()
            .eq("id", id);

        if (error) throw error;

        if (product && product.image && product.image.includes(`/${STORAGE_BUCKET}/`)) {
            const storagePath = product.image.split(`/${STORAGE_BUCKET}/`)[1];
            await supabase.storage.from(STORAGE_BUCKET).remove([storagePath]);
        }

        res.json({ message: "Product deleted." });

    } catch (error) {
        console.error("Error deleting product:", error.message);
        res.status(500).json({ message: "Something went wrong while deleting the product." });
    }

});

// Admin-only: reset a customer's password directly, no email required.
// This exists specifically because automated email isn't available on the
// free Render plan -- the admin looks the customer up by username (having
// verified who they are some other way, e.g. a phone call) and sets a new
// password for them on the spot.
app.post("/admin/reset-password", requireAdmin, async (req, res) => {

    const { username, newPassword } = req.body;

    if (!username || !newPassword) {
        return res.status(400).json({
            message: "A username and new password are required."
        });
    }

    if (newPassword.length < 6) {
        return res.status(400).json({
            message: "Password must be at least 6 characters."
        });
    }

    try {

        const { data: user, error: findError } = await supabase
            .from("users")
            .select("username")
            .eq("username", username)
            .maybeSingle();

        if (findError) throw findError;

        if (!user) {
            return res.status(404).json({
                message: "No account found with that username."
            });
        }

        const hashedPassword = await bcrypt.hash(newPassword, 10);

        const { error: updateError } = await supabase
            .from("users")
            .update({ password: hashedPassword })
            .eq("username", username);

        if (updateError) throw updateError;

        res.json({
            message: `Password updated for "${username}". Let them know their new password.`
        });

    } catch (error) {
        console.error("Error resetting customer password:", error.message);
        res.status(500).json({ message: "Something went wrong while resetting the password." });
    }

});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});