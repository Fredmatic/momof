// "My Bookings" page: shows the logged-in customer's own bookings.
(function () {

    const list = document.getElementById("bookingsList");
    const empty = document.getElementById("bookingsEmpty");
    const errorMessage = document.getElementById("bookingsError");

    fetch("/bookings/mine", { credentials: "include" })
        .then(response => {

            if (!response.ok) {
                return response.json().then(error => {
                    throw new Error(error.message);
                });
            }

            return response.json();

        })
        .then(bookings => {

            if (bookings.length === 0) {
                empty.style.display = "block";
                return;
            }

            list.innerHTML = bookings.map(booking => `
                <div class="booking-card">

                    <h3>${booking.service}</h3>

                    <p>Reference: ${booking.reference}</p>

                    <p>Date: ${booking.date}</p>

                    <p>Time: ${booking.time}</p>

                    <p>
                        Status:
                        <span class="booking-status ${booking.status}">
                            ${booking.status}
                        </span>
                    </p>

                </div>
            `).join("");

        })
        .catch(error => {
            console.error("Could not load bookings:", error);
            errorMessage.textContent = "We couldn't load your bookings. Please try again.";
            errorMessage.style.display = "block";
        });

})();