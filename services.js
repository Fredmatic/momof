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

const today = new Date().toISOString().split("T")[0];

bookingDateInput.min = today;


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

    const bookingReference =
        "MP-" + Math.floor(10000 + Math.random() * 90000);

    fetch("http://localhost:3000/bookings", {
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
                "Phone: " + customerPhone;

        }).catch(error => {
            console.error("Booking failed:", error);
            alert(error.message);
        });
});




newBooking.addEventListener("click", function () {
    bookingConfirmation.style.display = "none"
    bookingForm.style.display = "flex"
    bookingForm.reset();
})
const statusReference = document.getElementById("statusReference");
const checkBooking = document.getElementById("checkBooking");
const bookingResult = document.getElementById("bookingResult");


checkBooking.addEventListener("click", function () {

    const reference = statusReference.value.trim().toUpperCase();

    fetch("http://localhost:3000/bookings")
        .then(response => response.json())

        .then(data => {

            const booking = data.find(
                booking => booking.reference === reference
            );

            if (!booking) {

                bookingResult.innerHTML = `
                    <p>Booking not found. Please check your reference.</p>
                `;

                return;
            }

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
                <p>Unable to check booking. Please try again.</p>
            `;

        });

});

