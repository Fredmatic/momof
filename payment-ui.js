// Small helpers for showing deposit/payment information.
// Loaded by services.html and my-bookings.html (after escape.js).

function ugx(amount) {
    return "UGX " + Number(amount).toLocaleString("en-US");
}

// "awaiting payment" style text. Escaped, because it is placed straight into HTML.
function prettyStatus(status) {
    return escapeHtml(String(status || "pending").replace(/_/g, " "));
}

// What was paid and what is left. Returns "" for bookings with no deposit
// (older bookings, or deposits switched off).
function paymentInfoHtml(booking) {

    const total = Number(booking.total_amount);

    if (!total) return "";

    // The customer said they paid, and we haven't checked yet.
    if (booking.payment_status === "claimed") {
        return `
            <p>Total price: ${ugx(total)}</p>
            <p>Deposit: ${ugx(booking.amount_due)} - waiting for us to confirm it</p>
        `;
    }

    if (booking.payment_status === "rejected") {
        return `<p>We couldn't find your deposit payment, so this booking was cancelled.</p>`;
    }

    const paid = Number(booking.amount_paid || 0);

    if (!paid) return "";

    const balance = Math.max(0, total - paid);

    return `
        <p>Total price: ${ugx(total)}</p>
        <p>Deposit received: ${ugx(paid)}</p>
        <p>${balance > 0 ? "Balance to pay at the salon: " + ugx(balance) : "Fully paid, nothing more to pay"}</p>
    `;
}
