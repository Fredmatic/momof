let selectedServiceName = ""
let selectedServicePrice = ""
const bookingModal = document.getElementById("bookingModal");
const closeBooking = document.getElementById("closeBooking")
const selectedService = document.getElementById("selectedService")
const serviceButtons = document.querySelectorAll(".service-card button")

// ---------- Deposit options (manual mobile money) ----------
// The server says whether deposits are switched on and which numbers to pay
// to. If not, the booking form works exactly as it always did.
let paymentsEnabled = false;
let paymentConfig = null;
const paymentOptions = document.getElementById("paymentOptions");
const paymentInstructions = document.getElementById("paymentInstructions");
const paymentMethodSelect = document.getElementById("paymentMethod");
const paymentTxnId = document.getElementById("paymentTxnId");
const bookingSubmit = document.getElementById("bookingSubmit");

fetch("/api/payments/config")
    .then(response => response.json())
    .then(config => {
        paymentsEnabled = Boolean(config.enabled);
        paymentConfig = config;

        if (paymentsEnabled) {
            paymentOptions.style.display = "flex";

            paymentMethodSelect.innerHTML = config.methods
                .map(method => `<option value="${escapeHtml(method.id)}">I paid with ${escapeHtml(method.label)}</option>`)
                .join("");

            updatePaymentAmounts();
        }
    })
    .catch(() => { /* leave deposits off if the server can't say */ });

function chosenPercent() {
    const chosen = document.querySelector('input[name="payPercent"]:checked');
    return chosen ? Number(chosen.value) : 50;
}

// Shows what each choice costs, and exactly where to send the money.
function updatePaymentAmounts() {

    if (!paymentsEnabled) return;

    [50, 75, 100].forEach(percent => {
        const el = document.getElementById("payAmount" + percent);
        el.textContent = "Send UGX " + Math.round(Number(selectedServicePrice || 0) * percent / 100).toLocaleString("en-US");
    });

    const amount = Math.round(Number(selectedServicePrice || 0) * chosenPercent() / 100);

    const lines = paymentConfig.methods.map(method =>
        `<li>${escapeHtml(method.label)}: <strong>${escapeHtml(method.number)}</strong></li>`
    ).join("");

    paymentInstructions.innerHTML = `
        <p>Send <strong>UGX ${amount.toLocaleString("en-US")}</strong> to:</p>
        <ul>${lines}</ul>
        ${paymentConfig.accountName ? `<p>Name on the account: <strong>${escapeHtml(paymentConfig.accountName)}</strong></p>` : ""}
    `;
}

document.querySelectorAll('input[name="payPercent"]').forEach(radio => {
    radio.addEventListener("change", updatePaymentAmounts);
});

serviceButtons.forEach(button => {
    button.addEventListener("click", function () {
        selectedServiceName = button.dataset.service;
        selectedServicePrice = button.dataset.price;
        updatePaymentAmounts();

        // localStorage.setItem("service", serviceName)
        // localStorage.setItem("price", servicePrice)
        selectedService.textContent = selectedServiceName + " - UGX " + selectedServicePrice;

        bookingModal.style.display = "flex";
        loadTimeSlots();
    })
})
closeBooking.addEventListener("click", function () {
    bookingModal.style.display = "none"
})
bookingModal.addEventListener("click", function (event) {
    if (event.target === bookingModal) {
        bookingModal.style.display = "none";
    }
});

const bookingConfirmation = document.getElementById("bookingConfirmation")
const confirmationDetails = document.getElementById("confirmationDetails")
const newBooking = document.getElementById("newBooking")
const bookingForm = document.getElementById("bookingForm")
const bookingDateInput = document.getElementById("bookingDate");

// en-CA formats as YYYY-MM-DD in the visitor's local time zone
const today = new Date().toLocaleDateString("en-CA");

bookingDateInput.min = today;

// ---------- Available time slots ----------
// One slot per hour: 08:00 ... 17:00 (we close at 18:00).
const OPENING_HOUR = 8;
const CLOSING_HOUR = 22; // 10:00 PM
// Open every day, so no CLOSED_DAY check anymore.

const bookingTimeSelect = document.getElementById("bookingTime");

// Replace everything in the <select> with one message option.
function setTimeMessage(text) {
    bookingTimeSelect.innerHTML = "";
    const option = document.createElement("option");
    option.value = "";
    option.textContent = text;
    bookingTimeSelect.appendChild(option);
}

async function loadTimeSlots() {
    const date = bookingDateInput.value;

    if (!date) {
        setTimeMessage("Choose a date first");
        return;
    }

    setTimeMessage("Loading times...");

    let bookedTimes = [];

    try {
        const response = await fetch(
            "/bookings/availability?service=" + encodeURIComponent(selectedServiceName) +
            "&date=" + date
        );

        if (!response.ok) throw new Error("Status " + response.status);

        const data = await response.json();
        bookedTimes = data.bookedTimes;
    } catch (error) {
        // Not fatal: the server still refuses double bookings on submit.
        console.error("Could not load availability:", error);
    }

    // If the person picked a different date while we were waiting, this answer is stale.
    if (date !== bookingDateInput.value) return;

    setTimeMessage("Select a time");

    const now = new Date().toTimeString().slice(0, 5); // e.g. "14:35"

    for (let hour = OPENING_HOUR; hour < CLOSING_HOUR; hour++) {
        const slot = String(hour).padStart(2, "0") + ":00";
        const isBooked = bookedTimes.includes(slot);
        const isPast = date === today && slot <= now;

        const option = document.createElement("option");
        option.value = slot;
        option.textContent = isBooked ? slot + " (booked)" : slot;
        option.disabled = isBooked || isPast;
        bookingTimeSelect.appendChild(option);
    }
}

bookingDateInput.addEventListener("change", loadTimeSlots);



// 8 random characters (no look-alikes such as 0/O or 1/I), e.g. "MP-K7Q3XD9H".
// Long enough that nobody can guess another customer's reference.
const REFERENCE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 32 characters

function makeBookingReference() {
    const bytes = crypto.getRandomValues(new Uint8Array(8));
    return "MP-" + Array.from(bytes, byte => REFERENCE_ALPHABET[byte % 32]).join("");
}

bookingForm.addEventListener("submit", function (event) {
    event.preventDefault()

    const bookingDate = document.getElementById("bookingDate").value;

    if (bookingDate < today) {
        alert("You cannot book a past date.");
        return;
    }

    const bookingTime = document.getElementById("bookingTime").value;

    const selectedDate = new Date(bookingDate + "T00:00:00");
    const day = selectedDate.getDay();

    if (day === 4) {
        alert("Sorry, we are closed on Thursday.");
        return;
    }

    if (bookingTime < "08:00" || bookingTime > "18:00") {
        alert("Please choose a time between 8:00 AM and 6:00 PM.");
        return;
    }
    const customerName = document.getElementById("customerName").value;
    const customerPhone = document.getElementById("customerPhone").value;
    const customerEmail = document.getElementById("customerEmail").value;
    const customerPhoto = document.getElementById("customerPhoto").files[0];

    const bookingReference = makeBookingReference();

    const formData = new FormData();
    formData.append("service", selectedServiceName);
    formData.append("price", selectedServicePrice);
    formData.append("date", bookingDate);
    formData.append("time", bookingTime);
    formData.append("name", customerName);
    formData.append("phone", customerPhone);
    formData.append("email", customerEmail);
    formData.append("reference", bookingReference);
    formData.append("status", "pending");

    if (customerPhoto) {
        formData.append("photo", customerPhoto);
    }

    if (paymentsEnabled) {

        const txnId = paymentTxnId.value.replace(/[\s-]/g, "");

        if (!/^[A-Za-z0-9]{6,20}$/.test(txnId)) {
            alert("Please send your deposit first, then enter the transaction ID from the confirmation SMS.");
            return;
        }

        formData.append("payment_percent", String(chosenPercent()));
        formData.append("payment_method", paymentMethodSelect.value);
        formData.append("payment_txn_id", txnId);

        bookingSubmit.disabled = true;
        bookingSubmit.textContent = "Please wait...";
    }

    fetch("/bookings", {
        method: "POST",
        // No Content-Type header here -- the browser sets the correct
        // multipart boundary automatically when the body is a FormData.
        body: formData
    })
        .then(response => {

            if (!response.ok) {
                return response.json().then(error => {
                    throw new Error(error.message);
                });
            }

            return response.json();

        })
        .then(data => {

            console.log(data);

            bookingConfirmation.style.display = "block";
            bookingForm.style.display = "none";

            confirmationDetails.innerHTML =
                "Booking Reference: <strong>" + escapeHtml(bookingReference) + "</strong><br>" +
                "Service: " + escapeHtml(selectedServiceName) + "<br>" +
                "Price: UGX " + escapeHtml(selectedServicePrice) + "<br>" +
                (paymentsEnabled
                    ? "Deposit: UGX " + Math.round(Number(selectedServicePrice) * chosenPercent() / 100).toLocaleString("en-US") +
                      " (we'll confirm it shortly)<br>"
                    : "") +
                "Date: " + escapeHtml(bookingDate) + "<br>" +
                "Time: " + escapeHtml(bookingTime) + "<br>" +
                "Name: " + escapeHtml(customerName) + "<br>" +
                "Phone: " + escapeHtml(customerPhone) +
                (customerEmail ? "<br>Email: " + escapeHtml(customerEmail) : "");

        }).catch(error => {
            console.error("Booking failed:", error);
            alert(error.message);
            loadTimeSlots(); // someone may have just taken that slot

            bookingSubmit.disabled = false;
            bookingSubmit.textContent = "Confirm Booking";
        });
});




newBooking.addEventListener("click", function () {
    bookingConfirmation.style.display = "none"
    bookingForm.style.display = "flex"
    bookingForm.reset();
    loadTimeSlots();
})
const statusReference = document.getElementById("statusReference");
const checkBooking = document.getElementById("checkBooking");
const bookingResult = document.getElementById("bookingResult");


checkBooking.addEventListener("click", function () {

    const reference = statusReference.value.trim().toUpperCase();

    fetch(`/bookings/status/${reference}`)
        .then(response => {

            if (!response.ok) {
                return response.json().then(error => {
                    throw new Error(error.message);
                });
            }

            return response.json();

        })

        .then(booking => {

            bookingResult.innerHTML = `
                <div class="booking-card">

                    <h3>${escapeHtml(booking.service)}</h3>

                    <p>Reference: ${escapeHtml(booking.reference)}</p>

                    <p>Date: ${escapeHtml(booking.date)}</p>

                    <p>Time: ${escapeHtml(booking.time)}</p>

                    <p>
                        Status:
                        <span class="booking-status ${escapeHtml(booking.status)}">
                            ${prettyStatus(booking.status)}
                        </span>
                    </p>

                    ${paymentInfoHtml(booking)}

                    ${booking.status === "completed" ? renderReviewForm(booking.reference) : ""}

                </div>
            `;


            if (booking.status === "completed") {
                wireUpReviewForm(booking.reference);
            }

        })

        .catch(error => {

            console.error("Error:", error);

            bookingResult.innerHTML = `
                <p>${escapeHtml(error.message || "Unable to check booking. Please try again.")}</p>
            `;

        });

});

// ---------- Leave a review (shown once a booking is completed) ----------

function renderReviewForm(reference) {
    return `
        <div class="review-form" id="reviewForm-${escapeHtml(reference)}">
            <p>How was your visit? Leave a review:</p>

            <div class="star-picker" data-reference="${escapeHtml(reference)}" data-rating="0">
                ${[1, 2, 3, 4, 5].map(n => `<i class="far fa-star" data-star="${n}"></i>`).join("")}
            </div>

            <textarea class="review-comment" placeholder="Tell us about your experience (optional)" rows="3"></textarea>

            <button class="submit-review-btn" data-reference="${escapeHtml(reference)}">Submit Review</button>

            <p class="review-message"></p>
        </div>
    `;
}

function wireUpReviewForm(reference) {

    const formEl = document.getElementById(`reviewForm-${reference}`);
    if (!formEl) return;

    const starPicker = formEl.querySelector(".star-picker");
    const stars = formEl.querySelectorAll(".star-picker i");
    const commentBox = formEl.querySelector(".review-comment");
    const submitBtn = formEl.querySelector(".submit-review-btn");
    const messageEl = formEl.querySelector(".review-message");

    stars.forEach(star => {
        star.addEventListener("click", function () {

            const rating = Number(star.dataset.star);
            starPicker.dataset.rating = rating;

            stars.forEach(s => {
                const filled = Number(s.dataset.star) <= rating;
                s.classList.toggle("fas", filled);
                s.classList.toggle("far", !filled);
            });

        });
    });

    submitBtn.addEventListener("click", function () {

        const rating = Number(starPicker.dataset.rating);

        if (!rating) {
            messageEl.textContent = "Please pick a star rating first.";
            return;
        }

        messageEl.textContent = "Submitting...";

        fetch("/reviews", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                reference,
                rating,
                comment: commentBox.value.trim()
            })
        })
            .then(response => response.json().then(data => ({ ok: response.ok, data })))
            .then(({ ok, data }) => {

                messageEl.textContent = data.message;

                if (ok) {
                    starPicker.style.pointerEvents = "none";
                    commentBox.disabled = true;
                    submitBtn.disabled = true;
                    submitBtn.style.display = "none";
                }

            })
            .catch(() => {
                messageEl.textContent = "Something went wrong. Please try again.";
            });

    });

}