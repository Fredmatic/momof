// Shared helpers for online payments. Loaded by services.html,
// my-bookings.html and payment-result.html.
// The server always works out the real amounts -- the numbers shown here
// are only for display.

const PAY_PERCENT_CHOICES = [50, 75, 100];

function ugx(amount) {
    return "UGX " + Number(amount).toLocaleString("en-US");
}

// "awaiting_payment" -> "awaiting payment"
// Escaped, because it is placed straight into HTML.
function prettyStatus(status) {
    return escapeHtml(String(status || "pending").replace(/_/g, " "));
}

// What was paid and what's left. Returns "" for bookings that were not
// paid for online (older bookings, or payments switched off).
function paymentInfoHtml(booking) {

    const total = Number(booking.total_amount);
    const paid = Number(booking.amount_paid || 0);

    if (!total || !paid) return "";

    const balance = Math.max(0, total - paid);

    return `
        <p>Total price: ${ugx(total)}</p>
        <p>Paid online: ${ugx(paid)}</p>
        <p>${balance > 0 ? "Balance to pay at the salon: " + ugx(balance) : "Fully paid, nothing more to pay"}</p>
    `;
}

// Buttons that let a customer finish paying for a booking that is still
// waiting for its first payment.
function payNowHtml(total) {

    return `
        <div class="pay-now">
            <p>This booking isn't paid yet. Pay now to secure your slot:</p>
            <div class="pay-now-buttons">
                ${PAY_PERCENT_CHOICES.map(percent => `
                    <button type="button" class="pay-now-btn" data-percent="${percent}">
                        ${percent === 100 ? "Pay in full" : "Pay " + percent + "%"} - ${ugx(Math.round(Number(total) * percent / 100))}
                    </button>
                `).join("")}
            </div>
            <p class="pay-now-message"></p>
        </div>
    `;
}

// Makes the buttons from payNowHtml() work.
function wirePayNow(container, reference) {

    const message = container.querySelector(".pay-now-message");
    const buttons = container.querySelectorAll(".pay-now-btn");

    buttons.forEach(button => {
        button.addEventListener("click", async function () {

            buttons.forEach(b => { b.disabled = true; });
            message.textContent = "Taking you to the secure payment page...";

            try {
                const response = await fetch(`/bookings/${encodeURIComponent(reference)}/pay`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ percent: Number(button.dataset.percent) })
                });

                const data = await response.json();

                if (!response.ok) throw new Error(data.message);

                window.location.href = data.paymentLink;

            } catch (error) {
                message.textContent = error.message || "Something went wrong. Please try again.";
                buttons.forEach(b => { b.disabled = false; });
            }
        });
    });
}
