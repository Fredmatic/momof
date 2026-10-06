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
const payments = require("./payments");
const { sendBookingReceivedEmail, sendAdminNewBookingEmail, sendBookingStatusEmail, sendPaymentConfirmedEmail, sendPaymentRejectedEmail } = require("./mailer");

// Accepts one uploaded image file at a time, kept in memory just long
// enough to hand off to Supabase Storage (never written to disk).
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 3 * 1024 * 1024 }, // 3 MB -- stays safely under limits some hosts impose at the proxy level
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

// ---------- Deposits (manual mobile money) ----------

// Prices are decided HERE, never taken from the browser, so nobody can claim
// to have paid a UGX 1 deposit on an UGX 80,000 service by editing the page.
// If you add or change a service (or its price) in services.html, update this
// list to match.
const SERVICE_PRICES = {
    "Hair-styling": 50000,
    "Nail Care": 30000,
    "Makeup": 80000,
    "Skin Care": 40000
};

// Cancelled bookings free their time slot; everything else holds it.
function slotIsTaken(booking) {
    return booking.status !== "cancelled";
}

// Returns the percentage as a whole number if it is allowed (50-100), else null.
function validatePercent(value) {
    const percent = Number(value);
    const ok = Number.isInteger(percent) && percent >= payments.MIN_PERCENT && percent <= 100;
    return ok ? percent : null;
}

// Limits how many bookings one visitor can create, so nobody can fill your
// calendar with fake bookings.
const bookingLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: "Too many bookings from this connection. Please try again later." }
});

// The booking page asks this to decide whether to show the deposit options,
// and which numbers to show.
app.get("/api/payments/config", (req, res) => {
    res.json(payments.publicConfig());
});

app.post("/bookings", bookingLimiter, upload.single("photo"), async (req, res) => {

    const booking = req.body;
    const depositsOn = payments.isEnabled();

    // References end up in web addresses and on the admin page, so only the
    // expected shape is accepted (e.g. MP-K7Q3XD9H, or old ones like MP-12345).
    if (!/^MP-[A-Z0-9]{5,12}$/.test(String(booking.reference || ""))) {
        return res.status(400).json({ message: "Invalid booking reference." });
    }

    let totalAmount = null;
    let percent = null;
    let amountDue = null;
    let method = null;
    let transactionId = null;

    if (depositsOn) {

        totalAmount = SERVICE_PRICES[booking.service];

        if (!totalAmount) {
            return res.status(400).json({ message: "Unknown service." });
        }

        percent = validatePercent(booking.payment_percent);

        if (!percent) {
            return res.status(400).json({
                message: `Please pay at least ${payments.MIN_PERCENT}% of the price as a deposit.`
            });
        }

        method = String(booking.payment_method || "").toUpperCase();

        if (!payments.methods().some(m => m.id === method)) {
            return res.status(400).json({ message: "Please choose how you paid (MTN or Airtel)." });
        }

        transactionId = payments.normalizeTransactionId(booking.payment_txn_id);

        if (!transactionId) {
            return res.status(400).json({
                message: "Please enter the transaction ID from your payment confirmation SMS."
            });
        }

        amountDue = Math.round(totalAmount * percent / 100);
    }

    try {

        if (depositsOn) {

            // A transaction ID can only pay for one booking.
            const { data: used, error: usedError } = await supabase
                .from("bookings")
                .select("id")
                .eq("payment_transaction_id", transactionId);

            if (usedError) throw usedError;

            if (used.length > 0) {
                return res.status(409).json({
                    message: "That transaction ID has already been used for another booking."
                });
            }
        }

        const { data: sameSlot, error: findError } = await supabase
            .from("bookings")
            .select("id, status, created_at")
            .eq("service", booking.service)
            .eq("date", booking.date)
            .eq("time", booking.time)
            .neq("status", "cancelled");

        if (findError) throw findError;

        if (sameSlot.some(slotIsTaken)) {
            return res.status(409).json({
                message: "This time slot is already booked."
            });
        }

        // Reference photos live in their own folder, named with the
        // booking reference so they're easy to find in Supabase Storage.
        const photoUrl = await uploadImage(req.file, `bookings/${booking.reference}`);

        const row = {
            reference: booking.reference,
            service: booking.service,
            price: depositsOn ? String(totalAmount) : booking.price,
            date: booking.date,
            time: booking.time,
            name: booking.name,
            phone: booking.phone,
            email: booking.email || null,
            photo_url: photoUrl,
            status: depositsOn ? "pending" : (booking.status || "pending"),
            username: req.session.user ? req.session.user.username : null
        };

        if (depositsOn) {
            row.total_amount = totalAmount;
            row.payment_percent = percent;
            row.amount_due = amountDue;
            row.amount_paid = 0;
            // "claimed" = the customer says they paid; it stays unconfirmed
            // until an admin checks the mobile money records.
            row.payment_status = "claimed";
            row.payment_method = method;
            row.payment_transaction_id = transactionId;
        }

        const { data: inserted, error: insertError } = await supabase
            .from("bookings")
            .insert(row)
            .select()
            .single();

        if (insertError) throw insertError;

        console.log("New booking received:", booking.reference);

        res.json({
            message: "Booking received successfully"
        });

        // Fire-and-forget: emails never block or fail the booking response.
        sendBookingReceivedEmail(inserted);
        sendAdminNewBookingEmail(inserted);

    } catch (error) {

        // Two customers submitting the same transaction ID at the same moment
        if (error.code === "23505" && /txn|transaction/i.test(error.message || "")) {
            return res.status(409).json({
                message: "That transaction ID has already been used for another booking."
            });
        }

        console.error("Error creating booking:", error.message);
        res.status(500).json({
            message: "Something went wrong while creating the booking."
        });
    }

});

// Admin checks their mobile money records, then confirms or rejects the
// payment the customer claimed.
//   { action: "received", amount: 40000 }  -> amount is what actually arrived
//   { action: "rejected" }                 -> payment never arrived; booking is cancelled
app.patch("/bookings/:reference/payment", requireAdmin, async (req, res) => {

    const action = req.body.action;

    if (action !== "received" && action !== "rejected") {
        return res.status(400).json({ message: "Unknown action." });
    }

    try {

        const { data: booking, error } = await supabase
            .from("bookings")
            .select("*")
            .eq("reference", req.params.reference)
            .maybeSingle();

        if (error) throw error;

        if (!booking) {
            return res.status(404).json({ message: "Booking not found" });
        }

        if (booking.payment_status !== "claimed") {
            return res.status(409).json({ message: "This booking has no payment waiting to be checked." });
        }

        let changes;

        if (action === "received") {

            const total = Number(booking.total_amount);
            const amount = Number(req.body.amount === undefined ? booking.amount_due : req.body.amount);

            if (!Number.isInteger(amount) || amount < 1 || amount > total) {
                return res.status(400).json({
                    message: `The amount must be a whole number between 1 and ${total}.`
                });
            }

            changes = {
                amount_paid: amount,
                payment_status: amount >= total ? "paid" : "partial"
            };

        } else {
            changes = { payment_status: "rejected", status: "cancelled" };
        }

        // "payment_status = claimed" in the filter makes this a one-time
        // switch, so a double click can't record the payment twice.
        const { data: updated, error: updateError } = await supabase
            .from("bookings")
            .update(changes)
            .eq("id", booking.id)
            .eq("payment_status", "claimed")
            .select()
            .maybeSingle();

        if (updateError) throw updateError;

        if (!updated) {
            return res.status(409).json({ message: "This payment was already checked." });
        }

        res.json({ message: "Payment updated", booking: updated });

        if (action === "received") {
            sendPaymentConfirmedEmail(updated);
        } else {
            sendPaymentRejectedEmail(updated);
        }

    } catch (error) {
        console.error("Error updating payment:", error.message);
        res.status(500).json({ message: "Could not update the payment." });
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
// Because anyone can call this, it only returns what a customer needs to
// see about their booking -- never the name, phone number, email or photo,
// so a guessed reference reveals nothing personal. It is also rate-limited
// to make guessing references impractical.
const lookupLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: "Too many lookups. Please try again in a few minutes." }
});

app.get("/bookings/status/:reference", lookupLimiter, async (req, res) => {

    const { data, error } = await supabase
        .from("bookings")
        .select("reference, service, date, time, price, status, total_amount, amount_due, amount_paid, payment_status")
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

// Public: a customer leaves a review for one of their own completed
// bookings, found by reference (same pattern as checking booking status --
// no login required). One review per booking, enforced by the database's
// unique constraint on booking_reference.
app.post("/reviews", async (req, res) => {

    const { reference, rating, comment } = req.body;

    const ratingNumber = Number(rating);

    if (!reference || !ratingNumber || ratingNumber < 1 || ratingNumber > 5) {
        return res.status(400).json({
            message: "A booking reference and a rating from 1 to 5 are required."
        });
    }

    try {

        const { data: booking, error: findError } = await supabase
            .from("bookings")
            .select("name, status")
            .eq("reference", reference.toUpperCase())
            .maybeSingle();

        if (findError) throw findError;

        if (!booking) {
            return res.status(404).json({ message: "Booking not found." });
        }

        if (booking.status !== "completed") {
            return res.status(400).json({
                message: "You can only leave a review once this booking is marked completed."
            });
        }

        const { error: insertError } = await supabase
            .from("reviews")
            .insert({
                booking_reference: reference.toUpperCase(),
                customer_name: booking.name,
                rating: ratingNumber,
                comment: comment || null
            });

        if (insertError) {

            // Postgres error code 23505 = unique constraint violation.
            if (insertError.code === "23505") {
                return res.status(409).json({
                    message: "You've already reviewed this booking. Thank you!"
                });
            }

            throw insertError;
        }

        res.json({
            message: "Thanks for your review! It'll appear on our site once approved."
        });

    } catch (error) {
        console.error("Error submitting review:", error.message);
        res.status(500).json({ message: "Something went wrong while submitting your review." });
    }

});

// Public: approved reviews only, newest first -- for the home page.
app.get("/reviews/approved", async (req, res) => {

    try {

        const { data, error } = await supabase
            .from("reviews")
            .select("*")
            .eq("approved", true)
            .order("created_at", { ascending: false });

        if (error) throw error;

        res.json(data);

    } catch (error) {
        console.error("Error fetching approved reviews:", error.message);
        res.status(500).json({ message: "Something went wrong while loading reviews." });
    }

});

// Admin-only: every review, pending or approved, for the moderation list.
app.get("/reviews", requireAdmin, async (req, res) => {

    try {

        const { data, error } = await supabase
            .from("reviews")
            .select("*")
            .order("created_at", { ascending: false });

        if (error) throw error;

        res.json(data);

    } catch (error) {
        console.error("Error fetching reviews:", error.message);
        res.status(500).json({ message: "Something went wrong while loading reviews." });
    }

});

// Admin-only: approve or un-approve a review.
app.patch("/reviews/:id", requireAdmin, async (req, res) => {

    try {

        const { data, error } = await supabase
            .from("reviews")
            .update({ approved: req.body.approved })
            .eq("id", req.params.id)
            .select()
            .maybeSingle();

        if (error) throw error;

        if (!data) {
            return res.status(404).json({ message: "Review not found." });
        }

        res.json(data);

    } catch (error) {
        console.error("Error updating review:", error.message);
        res.status(500).json({ message: "Something went wrong while updating the review." });
    }

});

// Admin-only: permanently remove a review (e.g. spam or inappropriate content).
app.delete("/reviews/:id", requireAdmin, async (req, res) => {

    try {

        const { error } = await supabase
            .from("reviews")
            .delete()
            .eq("id", req.params.id);

        if (error) throw error;

        res.json({ message: "Review deleted." });

    } catch (error) {
        console.error("Error deleting review:", error.message);
        res.status(500).json({ message: "Something went wrong while deleting the review." });
    }

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
        .select("time, status, created_at")
        .eq("service", service)
        .eq("date", date)
        .neq("status", "cancelled");

    if (error) {
        console.error("Error checking availability:", error.message);
        return res.status(500).json({ message: "Could not check availability." });
    }

    res.json({ bookedTimes: data.filter(slotIsTaken).map(booking => booking.time) });

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

// Catches file-upload errors (oversized file, wrong file type) from any
// route using `upload`, and returns a clean JSON message instead of
// Express's default HTML error page or a generic connection failure.
app.use((error, req, res, next) => {

    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({
            message: "That photo is too large. Please use one under 3MB."
        });
    }

    if (error && error.message === "Only image files are allowed.") {
        return res.status(400).json({ message: error.message });
    }

    next(error);

});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});