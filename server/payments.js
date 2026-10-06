// Deposit settings for bookings.
//
// Right now deposits are paid by MANUAL MOBILE MONEY: the booking page tells
// the customer which MTN / Airtel number to send the deposit to, and they
// enter the transaction ID from their confirmation SMS. You then check your
// own mobile money records and press "Payment received" in the admin page.
// No payment-company account is needed.
//
// Deposits are optional: if no number is set below (in .env), the booking
// form has no payment step at all, exactly as before.
//
// When you get a Pesapal merchant account, the automatic version can be
// added here without changing the booking page layout or the admin page.

const CURRENCY = "UGX";

// Customers must pay at least this share of the price upfront.
const MIN_PERCENT = 50;

// The mobile money numbers customers can pay to (set in .env).
function methods() {

    const list = [];

    if (process.env.PAYMENT_MTN_NUMBER) {
        list.push({ id: "MTN", label: "MTN Mobile Money", number: process.env.PAYMENT_MTN_NUMBER.trim() });
    }

    if (process.env.PAYMENT_AIRTEL_NUMBER) {
        list.push({ id: "AIRTEL", label: "Airtel Money", number: process.env.PAYMENT_AIRTEL_NUMBER.trim() });
    }

    return list;
}

function isEnabled() {
    return methods().length > 0;
}

// What the booking page is told. Only public information: the numbers are
// shown to customers on purpose.
function publicConfig() {
    return {
        enabled: isEnabled(),
        minPercent: MIN_PERCENT,
        currency: CURRENCY,
        accountName: (process.env.PAYMENT_ACCOUNT_NAME || "").trim(),
        methods: methods()
    };
}

// "mp 12 ab-34" -> "MP12AB34". Returns null unless it looks like a real
// mobile money transaction ID (6-20 letters/digits).
function normalizeTransactionId(value) {
    const id = String(value || "").toUpperCase().replace(/[\s-]/g, "");
    return /^[A-Z0-9]{6,20}$/.test(id) ? id : null;
}

module.exports = {
    isEnabled,
    methods,
    publicConfig,
    normalizeTransactionId,
    CURRENCY,
    MIN_PERCENT
};
