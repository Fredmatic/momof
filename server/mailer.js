// Sends booking-related emails. Uses plain SMTP via nodemailer so it works
// with Gmail, Outlook, Zoho, or any other mail provider -- see the "Email
// notifications" section in README.md for setup steps.
//
// Email sending is entirely optional: if SMTP_HOST/SMTP_USER/SMTP_PASS
// aren't set, every function below just logs a note and does nothing, so
// the rest of the app (bookings, login, etc.) keeps working normally.

const nodemailer = require("nodemailer");

const {
    SMTP_HOST,
    SMTP_PORT,
    SMTP_USER,
    SMTP_PASS,
    FROM_EMAIL,
    ADMIN_EMAIL
} = process.env;

const isConfigured = Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS);

let transporter = null;

if (isConfigured) {
    transporter = nodemailer.createTransport({
        host: SMTP_HOST,
        port: Number(SMTP_PORT) || 587,
        // Port 465 requires SSL from the start; other ports (587, 25) use
        // STARTTLS, which nodemailer negotiates automatically when secure
        // is false.
        secure: Number(SMTP_PORT) === 465,
        // Some hosts (e.g. Render's free tier) don't support outbound
        // IPv6, but smtp.gmail.com resolves to an IPv6 address first,
        // causing an instant "ENETUNREACH" failure. Forcing IPv4 avoids
        // that entirely.
        family: 4,
        auth: {
            user: SMTP_USER,
            pass: SMTP_PASS
        }
    });
} else {
    console.log(
        "Email notifications are OFF (SMTP_HOST/SMTP_USER/SMTP_PASS not set in .env). " +
        "Bookings will still work, just without emails."
    );
}

// Sends one email and never throws -- a failed email should never break a
// booking request or an admin status update. Errors are just logged.
async function send({ to, subject, html }) {

    if (!isConfigured) {
        return;
    }

    if (!to) {
        console.log(`Skipped email "${subject}" -- no recipient address was provided.`);
        return;
    }

    try {
        await transporter.sendMail({
            from: FROM_EMAIL || SMTP_USER,
            to,
            subject,
            html
        });
        console.log(`Email sent: "${subject}" -> ${to}`);
    } catch (error) {
        console.error(`Failed to send email ("${subject}" to ${to}):`, error.message);
    }
}

// Visitors choose their own name, phone number, etc., so anything that goes
// into an email's HTML must be escaped (otherwise someone could inject
// links or markup into the emails you and your customers receive).
function esc(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function ugx(amount) {
    return "UGX " + Number(amount).toLocaleString("en-US");
}

// Payment lines are only shown for bookings that were paid for online.
function paymentSummaryHtml(booking) {

    if (!booking.total_amount || !Number(booking.amount_paid)) {
        return "";
    }

    const balance = Math.max(0, Number(booking.total_amount) - Number(booking.amount_paid));

    return `
        <p><strong>Total price:</strong> ${ugx(booking.total_amount)}</p>
        <p><strong>Paid online:</strong> ${ugx(booking.amount_paid)}</p>
        <p><strong>${balance > 0 ? "Balance to pay at the salon" : "Balance"}:</strong> ${balance > 0 ? ugx(balance) : "None -- fully paid"}</p>
    `;
}

function bookingSummaryHtml(booking) {
    return `
        <p><strong>Reference:</strong> ${esc(booking.reference)}</p>
        <p><strong>Service:</strong> ${esc(booking.service)}</p>
        <p><strong>Date:</strong> ${esc(booking.date)}</p>
        <p><strong>Time:</strong> ${esc(booking.time)}</p>
        <p><strong>Name:</strong> ${esc(booking.name)}</p>
        <p><strong>Phone:</strong> ${esc(booking.phone)}</p>
        ${paymentSummaryHtml(booking)}
    `;
}

// Sent to the customer the moment they submit a booking (status: pending).
async function sendBookingReceivedEmail(booking) {
    await send({
        to: booking.email,
        subject: `We've received your booking - ${String(booking.reference).replace(/[\r\n]/g, "")}`,
        html: `
            <h2>Thanks, ${esc(booking.name)}!</h2>
            <p>Your booking at MOMO's PALOR has been received${Number(booking.amount_paid) ? ", your payment went through," : ""} and is <strong>pending confirmation</strong>.</p>
            ${bookingSummaryHtml(booking)}
            <p>We'll email you again as soon as it's confirmed.</p>
        `
    });
}

// Sent to the salon's admin inbox whenever a new booking comes in.
async function sendAdminNewBookingEmail(booking) {
    await send({
        to: ADMIN_EMAIL,
        subject: `New booking - ${String(booking.reference).replace(/[\r\n]/g, "")}`,
        html: `
            <h2>New booking received</h2>
            ${bookingSummaryHtml(booking)}
            <p>Log in to the admin dashboard to confirm or cancel it.</p>
        `
    });
}

// Sent to the customer whenever an admin changes a booking's status.
async function sendBookingStatusEmail(booking) {

    const statusText = {
        confirmed: {
            subject: "Your booking is confirmed",
            heading: "You're all set!",
            message: "Your booking has been confirmed. We look forward to seeing you."
        },
        cancelled: {
            subject: "Your booking was cancelled",
            heading: "Booking cancelled",
            message: "Your booking has been cancelled. If this is unexpected, please contact us."
        },
        completed: {
            subject: "Thanks for visiting MOMO's PALOR",
            heading: "Thank you!",
            message: "We hope you enjoyed your visit. We'd love to see you again soon."
        }
    }[booking.status];

    if (!statusText) {
        return; // unknown/other status -- nothing to email about
    }

    await send({
        to: booking.email,
        subject: `${statusText.subject} - ${booking.reference}`,
        html: `
            <h2>${statusText.heading}</h2>
            <p>${statusText.message}</p>
            ${bookingSummaryHtml(booking)}
        `
    });
}

// Sent when a customer requests a password reset.
async function sendPasswordResetEmail({ email, username, resetLink }) {
    await send({
        to: email,
        subject: "Reset your MOMO's PALOR password",
        html: `
            <h2>Password reset requested</h2>
            <p>Hi ${esc(username)}, we received a request to reset your password.</p>
            <p><a href="${esc(resetLink)}">Click here to choose a new password</a></p>
            <p>This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>
        `
    });
}

module.exports = {
    sendBookingReceivedEmail,
    sendAdminNewBookingEmail,
    sendBookingStatusEmail,
    sendPasswordResetEmail
};