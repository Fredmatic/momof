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
const crypto = require("crypto");
const payments = require("./payments");
const { sendBookingReceivedEmail, sendAdminNewBookingEmail, sendBookingStatusEmail } = require("./mailer");

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

// ---------- Online payments (Flutterwave) ----------

// Prices are decided HERE, never taken from the browser, so nobody can pay
// UGX 1 for an UGX 80,000 service by editing the page. If you add or change
// a service (or its price) in services.html, update this list to match.
const SERVICE_PRICES = {
    "Hair-styling": 50000,
    "Nail Care": 30000,
    "Makeup": 80000,
    "Skin Care": 40000
};

// A booking that is waiting for payment holds its time slot for this long.
// After that the slot opens up again for other customers.
const PAYMENT_HOLD_MS = 30 * 60 * 1000;

// Is this booking currently blocking its time slot?
function slotIsTaken(booking) {

    if (booking.status === "cancelled") return false;

    if (booking.status === "awaiting_payment") {
        return Date.now() - new Date(booking.created_at).getTime() < PAYMENT_HOLD_MS;
    }

    return true;
}

// Returns the percentage as a whole number if it is allowed (50-100), else null.
function validatePercent(value) {
    const percent = Number(value);
    const ok = Number.isInteger(percent) && percent >= payments.MIN_PERCENT && percent <= 100;
    return ok ? percent : null;
}

// Where Flutterwave sends the customer after paying. Set PUBLIC_URL if the
// site is reachable at a different address than the one the server sees.
function publicBaseUrl(req) {
    return (process.env.PUBLIC_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
}

// tx_ref looks like "MP-12345-lq3x9a": the booking reference plus a suffix.
function referenceFromTxRef(txRef) {
    return String(txRef).slice(0, String(txRef).lastIndexOf("-"));
}

// Only these fields are ever sent back to the payment-result page.
function publicPaymentView(booking) {
    return {
        reference: booking.reference,
        service: booking.service,
        date: booking.date,
        time: booking.time,
        total_amount: Number(booking.total_amount),
        amount_paid: Number(booking.amount_paid || 0),
        payment_status: booking.payment_status
    };
}

// Creates a fresh Flutterwave payment page for a booking and returns its URL.
async function startPayment(req, booking, percent) {

    const total = Number(booking.total_amount);
    const amountDue = Math.round(total * percent / 100);
    const txRef = `${booking.reference}-${Date.now().toString(36)}`;

    // created_at is refreshed so the 30-minute slot hold restarts.
    const { error } = await supabase
        .from("bookings")
        .update({
            payment_percent: percent,
            amount_due: amountDue,
            payment_tx_ref: txRef,
            created_at: new Date().toISOString()
        })
        .eq("id", booking.id);

    if (error) throw error;

    return payments.createPaymentLink({
        txRef,
        amount: amountDue,
        redirectUrl: `${publicBaseUrl(req)}/payment-result.html`,
        customer: { email: booking.email, name: booking.name, phone: booking.phone },
        description: `${booking.service} - ${percent === 100 ? "full payment" : percent + "% deposit"} (${booking.reference})`,
        reference: booking.reference
    });
}

// The one place a payment is accepted. Called both when the customer comes
// back from Flutterwave and when Flutterwave's webhook arrives, so it must
// be safe to run twice for the same payment. It asks Flutterwave directly
// whether the money really arrived before marking anything as paid.
//
// Returns { state, booking } where state is one of:
// "paid", "partial", "pending", "failed", "cancelled", "not_found".
async function settlePayment(txRef, transactionId) {

    const { data: booking, error } = await supabase
        .from("bookings")
        .select("*")
        .eq("reference", referenceFromTxRef(txRef))
        .maybeSingle();

    if (error) throw error;

    if (!booking || !booking.total_amount) {
        return { state: "not_found" };
    }

    // Already settled (e.g. the webhook got here first).
    if (booking.payment_status !== "unpaid") {
        return { state: booking.payment_status, booking };
    }

    // The customer closed or cancelled the Flutterwave page.
    if (!transactionId) {
        return { state: "cancelled", booking };
    }

    const tx = await payments.verifyTransaction(transactionId);

    if (tx.tx_ref !== txRef || tx.currency !== payments.CURRENCY) {
        console.warn("Payment mismatch for", txRef, "-- tx_ref or currency differs.");
        return { state: "failed", booking };
    }

    if (tx.status === "pending") {
        return { state: "pending", booking };
    }

    const minimum = Math.round(Number(booking.total_amount) * payments.MIN_PERCENT / 100);

    if (tx.status !== "successful" || Number(tx.amount) < minimum) {
        console.warn("Payment not accepted for", txRef, "-- status:", tx.status, "amount:", tx.amount);
        return { state: "failed", booking };
    }

    const amountPaid = Number(tx.amount);

    // "payment_status = unpaid" in the filter makes this a one-time switch:
    // if two requests race, only one of them actually updates the row.
    const { data: updated, error: updateError } = await supabase
        .from("bookings")
        .update({
            amount_paid: amountPaid,
            payment_status: amountPaid >= Number(booking.total_amount) ? "paid" : "partial",
            payment_transaction_id: String(tx.id || transactionId),
            status: "pending"
        })
        .eq("id", booking.id)
        .eq("payment_status", "unpaid")
        .select()
        .maybeSingle();

    if (updateError) throw updateError;

    if (!updated) {
        const { data: latest } = await supabase
            .from("bookings")
            .select("*")
            .eq("id", booking.id)
            .maybeSingle();

        return { state: latest ? latest.payment_status : "failed", booking: latest || booking };
    }

    // If the 30-minute hold ran out and someone else took the slot while
    // this customer was paying, keep the money on record and flag it.
    const { data: others } = await supabase
        .from("bookings")
        .select("id, status, created_at")
        .eq("service", updated.service)
        .eq("date", updated.date)
        .eq("time", updated.time)
        .neq("id", updated.id);

    if ((others || []).some(slotIsTaken)) {
        console.warn(`DOUBLE BOOKING: ${updated.reference} was paid for a slot that is also booked by someone else. Please resolve it manually.`);
    }

    console.log(`Payment received for ${updated.reference}: UGX ${amountPaid} (${updated.payment_status})`);

    // Fire-and-forget, same as before: emails never block the response.
    sendBookingReceivedEmail(updated);
    sendAdminNewBookingEmail(updated);

    return { state: updated.payment_status, booking: updated };
}

// Limits calls that hit Flutterwave on a visitor's behalf.
const paymentLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 40,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: "Too many payment requests. Please try again in a few minutes." }
});

// The booking page asks this to decide whether to show the payment options.
app.get("/api/payments/config", (req, res) => {
    res.json({
        enabled: payments.isEnabled(),
        minPercent: payments.MIN_PERCENT,
        currency: payments.CURRENCY
    });
});

app.post("/bookings", upload.single("photo"), async (req, res) => {

    const booking = req.body;
    const paymentsOn = payments.isEnabled();

    let totalAmount = null;
    let percent = null;

    if (paymentsOn) {

        totalAmount = SERVICE_PRICES[booking.service];

        if (!totalAmount) {
            return res.status(400).json({ message: "Unknown service." });
        }

        percent = validatePercent(booking.payment_percent);

        if (!percent) {
            return res.status(400).json({
                message: `Please pay at least ${payments.MIN_PERCENT}% of the price upfront.`
            });
        }

        if (!booking.email) {
            return res.status(400).json({
                message: "An email address is required so we can send your payment receipt."
            });
        }
    }

    try {

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
            price: paymentsOn ? String(totalAmount) : booking.price,
            date: booking.date,
            time: booking.time,
            name: booking.name,
            phone: booking.phone,
            email: booking.email || null,
            photo_url: photoUrl,
            status: paymentsOn ? "awaiting_payment" : (booking.status || "pending"),
            username: req.session.user ? req.session.user.username : null
        };

        if (paymentsOn) {
            row.total_amount = totalAmount;
            row.payment_status = "unpaid";
            row.amount_paid = 0;
        }

        const { data: inserted, error: insertError } = await supabase
            .from("bookings")
            .insert(row)
            .select()
            .single();

        if (insertError) throw insertError;

        if (!paymentsOn) {
            console.log("New booking received:", booking.reference);

            res.json({
                message: "Booking received successfully"
            });

            // Fire-and-forget: emails never block or fail the booking response.
            sendBookingReceivedEmail(booking);
            sendAdminNewBookingEmail(booking);
            return;
        }

        // Payments are on: hold the slot, then send the customer to pay.
        // The "booking received" emails go out once the payment is confirmed.
        let paymentLink;

        try {
            paymentLink = await startPayment(req, inserted, percent);
        } catch (paymentError) {
            // Couldn't reach Flutterwave: undo the booking so the slot isn't held for nothing.
            await supabase.from("bookings").delete().eq("id", inserted.id);
            console.error("Could not start payment:", paymentError.message);
            return res.status(502).json({
                message: "We couldn't start the payment right now. Please try again in a moment."
            });
        }

        console.log("Booking awaiting payment:", booking.reference);

        res.json({
            message: "Booking held. Redirecting to payment.",
            reference: booking.reference,
            paymentLink
        });

    } catch (error) {
        console.error("Error creating booking:", error.message);
        res.status(500).json({
            message: "Something went wrong while creating the booking."
        });
    }

});

// Customer gave up or closed the payment page: let them try again for the
// same booking (while its slot is still free) instead of filling the form in again.
app.post("/bookings/:reference/pay", paymentLimiter, async (req, res) => {

    if (!payments.isEnabled()) {
        return res.status(503).json({ message: "Online payments are not available right now." });
    }

    const percent = validatePercent(req.body.percent);

    if (!percent) {
        return res.status(400).json({
            message: `Please pay at least ${payments.MIN_PERCENT}% of the price upfront.`
        });
    }

    try {

        const { data: booking, error } = await supabase
            .from("bookings")
            .select("*")
            .eq("reference", req.params.reference.toUpperCase())
            .maybeSingle();

        if (error) throw error;

        if (!booking) {
            return res.status(404).json({ message: "Booking not found." });
        }

        if (booking.payment_status !== "unpaid" || booking.status !== "awaiting_payment") {
            return res.status(409).json({ message: "This booking doesn't need a payment." });
        }

        const { data: others, error: slotError } = await supabase
            .from("bookings")
            .select("id, status, created_at")
            .eq("service", booking.service)
            .eq("date", booking.date)
            .eq("time", booking.time)
            .neq("id", booking.id);

        if (slotError) throw slotError;

        if (others.some(slotIsTaken)) {
            return res.status(409).json({
                message: "Sorry, that time slot was taken while your payment was pending. Please book again."
            });
        }

        const paymentLink = await startPayment(req, booking, percent);

        res.json({ paymentLink });

    } catch (error) {
        console.error("Error restarting payment:", error.message);
        res.status(500).json({ message: "We couldn't start the payment. Please try again." });
    }

});

// Flutterwave sends the customer back here (via payment-result.html) with
// ?status=...&tx_ref=...&transaction_id=.... Those values come from the
// URL, so they are never trusted: settlePayment() re-checks with Flutterwave.
app.get("/payments/verify", paymentLimiter, async (req, res) => {

    const { tx_ref: txRef, transaction_id: transactionId, status } = req.query;

    if (!txRef) {
        return res.status(400).json({ message: "Missing payment reference." });
    }

    try {

        const result = await settlePayment(
            txRef,
            status === "cancelled" ? null : transactionId
        );

        if (result.state === "not_found") {
            return res.status(404).json({ message: "We couldn't find that payment." });
        }

        res.json({
            state: result.state,
            booking: publicPaymentView(result.booking)
        });

    } catch (error) {
        console.error("Error verifying payment:", error.message);
        res.status(500).json({ message: "We couldn't confirm your payment yet. If you were charged, don't worry -- we'll still receive it." });
    }

});

// Flutterwave also calls this directly, so a payment is recorded even if the
// customer closes their browser before returning to the site. Set the same
// secret value as FLW_WEBHOOK_HASH here and in the Flutterwave dashboard.
app.post("/payments/webhook", async (req, res) => {

    const expected = process.env.FLW_WEBHOOK_HASH || "";
    const received = String(req.headers["verif-hash"] || "");

    const matches =
        expected.length > 0 &&
        expected.length === received.length &&
        crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(received));

    if (!matches) {
        return res.sendStatus(401);
    }

    const event = req.body || {};
    const data = event.data || {};

    // Anything other than a successful charge needs no action.
    if (event.event !== "charge.completed" || data.status !== "successful" || !data.tx_ref || !data.id) {
        return res.sendStatus(200);
    }

    try {
        await settlePayment(data.tx_ref, data.id);
        res.sendStatus(200);
    } catch (error) {
        console.error("Webhook processing failed:", error.message);
        res.sendStatus(500); // Flutterwave will retry later
    }

});

// Admin-only: full bookings list for the dashboard.
app.get("/bookings", requireAdmin, async (req, res) => {

    // Bookings still waiting for their first payment aren't real bookings
    // yet, so they stay out of the dashboard until the money arrives.
    const { data, error } = await supabase
        .from("bookings")
        .select("*")
        .neq("status", "awaiting_payment")
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