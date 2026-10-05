// Landing page after Flutterwave's hosted payment page. Flutterwave adds
// ?status=...&tx_ref=...&transaction_id=... to the address. We never trust
// those values: the server asks Flutterwave whether the money really arrived.
(function () {

    const params = new URLSearchParams(window.location.search);
    const txRef = params.get("tx_ref");

    const icon = document.getElementById("resultIcon");
    const title = document.getElementById("resultTitle");
    const message = document.getElementById("resultMessage");
    const details = document.getElementById("resultDetails");
    const actions = document.getElementById("resultActions");

    function show(iconClass, heading, text) {
        icon.className = "fas " + iconClass;
        title.textContent = heading;
        message.textContent = text;
    }

    function linkButtons() {
        actions.innerHTML = `
            <a class="result-link" href="services.html">Back to services</a>
            <a class="result-link" href="my-bookings.html">My bookings</a>
        `;
    }

    async function checkPayment() {

        show("fa-spinner fa-spin", "Confirming your payment...", "Please don't close this page.");
        details.innerHTML = "";
        actions.innerHTML = "";

        const query = new URLSearchParams({
            tx_ref: txRef,
            transaction_id: params.get("transaction_id") || "",
            status: params.get("status") || ""
        });

        let result;

        try {
            const response = await fetch("/payments/verify?" + query.toString());
            result = await response.json();

            if (!response.ok) throw new Error(result.message);

        } catch (error) {
            show("fa-triangle-exclamation", "We couldn't confirm your payment yet",
                error.message || "Something went wrong. Please try again.");
            actions.innerHTML = `<button type="button" class="result-link" id="checkAgain">Check again</button>`;
            document.getElementById("checkAgain").addEventListener("click", checkPayment);
            return;
        }

        const booking = result.booking;

        // Booking details are numbers/server-formatted values only.
        details.innerHTML = `
            <div class="booking-card">
                <h3></h3>
                <p>Reference: <strong></strong></p>
                <p class="when"></p>
                ${paymentInfoHtml(booking)}
            </div>
        `;
        details.querySelector("h3").textContent = booking.service;
        details.querySelector("strong").textContent = booking.reference;
        details.querySelector(".when").textContent = booking.date + " at " + booking.time;

        if (result.state === "paid" || result.state === "partial") {
            show("fa-circle-check", "Payment received",
                "Thank you! Your booking is now pending confirmation. We'll email you as soon as it's confirmed.");
            linkButtons();
            return;
        }

        if (result.state === "pending") {
            show("fa-clock", "Your payment is still processing",
                "If you approved it on your phone, it can take a minute to come through.");
            actions.innerHTML = `<button type="button" class="result-link" id="checkAgain">Check again</button>`;
            document.getElementById("checkAgain").addEventListener("click", checkPayment);
            return;
        }

        // cancelled or failed: let them try again for the same booking
        if (result.state === "cancelled") {
            show("fa-circle-xmark", "Payment cancelled",
                "You haven't been charged. Your time slot is held for 30 minutes, so you can try again.");
        } else {
            show("fa-circle-xmark", "We couldn't confirm your payment",
                "Your time slot is held for 30 minutes, so you can try again. If money left your account, please contact us with your booking reference.");
        }
        actions.innerHTML = payNowHtml(booking.total_amount);
        wirePayNow(actions, booking.reference);
    }

    if (!txRef) {
        show("fa-triangle-exclamation", "Nothing to check", "This page opens after you pay. Start from the services page.");
        linkButtons();
        return;
    }

    checkPayment();

})();
