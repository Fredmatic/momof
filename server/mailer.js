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

function bookingSummaryHtml(booking) {
    return `
        <p><strong>Reference:</strong> ${booking.reference}</p>
        <p><strong>Service:</strong> ${booking.service}</p>
        <p><strong>Date:</strong> ${booking.date}</p>
        <p><strong>Time:</strong> ${booking.time}</p>
        <p><strong>Name:</strong> ${booking.name}</p>
        <p><strong>Phone:</strong> ${booking.phone}</p>
    `;
}

// Sent to the customer the moment they submit a booking (status: pending).
async function sendBookingReceivedEmail(booking) {
    await send({
        to: booking.email,
        subject: `We've received your booking - ${booking.reference}`,
        html: `
            <h2>Thanks, ${booking.name}!</h2>
            <p>Your booking at MOMO's PALOR has been received and is <strong>pending confirmation</strong>.</p>
            ${bookingSummaryHtml(booking)}
            <p>We'll email you again as soon as it's confirmed.</p>
        `
    });
}

// Sent to the salon's admin inbox whenever a new booking comes in.
async function sendAdminNewBookingEmail(booking) {
    await send({
        to: ADMIN_EMAIL,
        subject: `New booking - ${booking.reference}`,
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

module.exports = {
    sendBookingReceivedEmail,
    sendAdminNewBookingEmail,
    sendBookingStatusEmail
};