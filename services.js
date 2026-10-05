let selectedServiceName = ""
let selectedServicePrice = ""
const bookingModal = document.getElementById("bookingModal");
const closeBooking = document.getElementById("closeBooking")
const selectedService = document.getElementById("selectedService")
const serviceButtons = document.querySelectorAll(".service-card button")

// ---------- Online payment options ----------
// The server says whether payments are switched on. If not, the booking
// form works exactly as it always did.
let paymentsEnabled = false;
const paymentOptions = document.getElementById("paymentOptions");
const bookingSubmit = document.getElementById("bookingSubmit");
const customerEmailInput = document.getElementById("customerEmail");

fetch("/api/payments/config")
    .then(response => response.json())
    .then(config => {
        paymentsEnabled = Boolean(config.enabled);

        if (paymentsEnabled) {
            paymentOptions.style.display = "block";
            bookingSubmit.textContent = "Continue to Payment";
            customerEmailInput.required = true;
            customerEmailInput.placeholder = "Email (for your payment receipt)";
        }
    })
    .catch(() => { /* leave payments off if the server can't say */ });

// Shows what each choice costs for the service that was clicked.
function updatePaymentAmounts() {
    [50, 75, 100].forEach(percent => {
        const el = document.getElementById("payAmount" + percent);
        el.textContent = "Pay UGX " + Math.round(Number(selectedServicePrice) * percent / 100).toLocaleString("en-US") + " now";
    });
}

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

    const bookingReference =
        "MP-" + Math.floor(10000 + Math.random() * 90000);

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
        const chosen = document.querySelector('input[name="payPercent"]:checked');
        formData.append("payment_percent", chosen ? chosen.value : "50");
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

            // Payments on: the slot is now held, so go and pay.
            if (data.paymentLink) {
                window.location.href = data.paymentLink;
                return;
            }

            bookingConfirmation.style.display = "block";
            bookingForm.style.display = "none";

            confirmationDetails.innerHTML =
                "Booking Reference: <strong>" + bookingReference + "</strong><br>" +
                "Service: " + selectedServiceName + "<br>" +
                "Price: UGX " + selectedServicePrice + "<br>" +
                "Date: " + bookingDate + "<br>" +
                "Time: " + bookingTime + "<br>" +
                "Name: " + customerName + "<br>" +
                "Phone: " + customerPhone +
                (customerEmail ? "<br>Email: " + customerEmail : "");

        }).catch(error => {
            console.error("Booking failed:", error);
            alert(error.message);
            loadTimeSlots(); // someone may have just taken that slot

            if (paymentsEnabled) {
                bookingSubmit.disabled = false;
                bookingSubmit.textContent = "Continue to Payment";
            }
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

                    <h3>${booking.service}</h3>

                    <p>Reference: ${booking.reference}</p>

                    <p>Date: ${booking.date}</p>

                    <p>Time: ${booking.time}</p>

                    <p>Customer: ${booking.name}</p>

                    <p>
                        Status:
                        <span class="booking-status ${booking.status}">
                            ${prettyStatus(booking.status)}
                        </span>
                    </p>

                    ${paymentInfoHtml(booking)}

                    ${booking.status === "awaiting_payment" ? payNowHtml(booking.total_amount) : ""}

                    ${booking.status === "completed" ? renderReviewForm(booking.reference) : ""}

                </div>
            `;

            if (booking.status === "awaiting_payment") {
                wirePayNow(bookingResult, booking.reference);
            }

            if (booking.status === "completed") {
                wireUpReviewForm(booking.reference);
            }

        })

        .catch(error => {

            console.error("Error:", error);

            bookingResult.innerHTML = `
                <p>${error.message || "Unable to check booking. Please try again."}</p>
            `;

        });

});

// ---------- Leave a review (shown once a booking is completed) ----------

function renderReviewForm(reference) {
    return `
        <div class="review-form" id="reviewForm-${reference}">
            <p>How was your visit? Leave a review:</p>

            <div class="star-picker" data-reference="${reference}" data-rating="0">
                ${[1, 2, 3, 4, 5].map(n => `<i class="far fa-star" data-star="${n}"></i>`).join("")}
            </div>

            <textarea class="review-comment" placeholder="Tell us about your experience (optional)" rows="3"></textarea>

            <button class="submit-review-btn" data-reference="${reference}">Submit Review</button>

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