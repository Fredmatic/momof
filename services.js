let selectedServiceName = ""
let selectedServicePrice = ""
const bookingModal = document.getElementById("bookingModal");
const closeBooking = document.getElementById("closeBooking")
const selectedService = document.getElementById("selectedService")
const serviceButtons = document.querySelectorAll(".service-card button")
serviceButtons.forEach(button => {
    button.addEventListener("click", function () {
        selectedServiceName = button.dataset.service;
        selectedServicePrice = button.dataset.price;

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
const CLOSING_HOUR = 18;
const CLOSED_DAY = 4; // Thursday (Sunday = 0 ... Saturday = 6)

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

    if (new Date(date + "T00:00:00").getDay() === CLOSED_DAY) {
        setTimeMessage("Closed on Thursdays");
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

    const bookingReference =
        "MP-" + Math.floor(10000 + Math.random() * 90000);

    fetch("/bookings", {
        method: "POST",

        headers: {
            "Content-Type": "application/json"
        },

        body: JSON.stringify({
            service: selectedServiceName,
            price: selectedServicePrice,
            date: bookingDate,
            time: bookingTime,
            name: customerName,
            phone: customerPhone,
            email: customerEmail,
            reference: bookingReference,
            status: "pending"
        })
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
                            ${booking.status}
                        </span>
                    </p>

                </div>
            `;

        })

        .catch(error => {

            console.error("Error:", error);

            bookingResult.innerHTML = `
                <p>${error.message || "Unable to check booking. Please try again."}</p>
            `;

        });

});