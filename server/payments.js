// Talks to Flutterwave (v3 "Standard" hosted checkout). Customers are sent
// to Flutterwave's own secure page to pay by card or mobile money, so card
// numbers and PINs never touch this server.
//
// Online payments are entirely optional: if FLW_SECRET_KEY isn't set,
// isEnabled() is false and the booking flow behaves exactly as it did
// before (no payment step).

const FLW_BASE = "https://api.flutterwave.com/v3";

const CURRENCY = "UGX";

// Customers must pay at least this share of the price upfront.
const MIN_PERCENT = 50;

function isEnabled() {
    return Boolean(process.env.FLW_SECRET_KEY);
}

async function flwRequest(path, options = {}) {

    const response = await fetch(FLW_BASE + path, {
        ...options,
        headers: {
            Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`,
            "Content-Type": "application/json"
        }
    });

    const body = await response.json().catch(() => ({}));

    if (!response.ok || body.status !== "success") {
        throw new Error(body.message || `Flutterwave request failed (${response.status})`);
    }

    return body.data;
}

// Creates a hosted payment page and returns its URL.
async function createPaymentLink({ txRef, amount, redirectUrl, customer, description, reference }) {

    const payload = {
        tx_ref: txRef,
        amount,
        currency: CURRENCY,
        redirect_url: redirectUrl,
        customer: {
            email: customer.email,
            name: customer.name,
            phonenumber: customer.phone
        },
        customizations: {
            title: "MOMO's PALOR",
            description
        },
        meta: { booking_reference: reference }
    };

    // Optional override, e.g. "card,mobilemoneyuganda". If unset, Flutterwave
    // shows whatever methods are enabled in your dashboard settings.
    if (process.env.FLW_PAYMENT_OPTIONS) {
        payload.payment_options = process.env.FLW_PAYMENT_OPTIONS;
    }

    const data = await flwRequest("/payments", {
        method: "POST",
        body: JSON.stringify(payload)
    });

    return data.link;
}

// Asks Flutterwave directly what happened to a transaction. Never trust the
// redirect URL or a webhook body on their own -- always confirm here.
async function verifyTransaction(transactionId) {
    return flwRequest(`/transactions/${encodeURIComponent(transactionId)}/verify`);
}

module.exports = { isEnabled, createPaymentLink, verifyTransaction, CURRENCY, MIN_PERCENT };
