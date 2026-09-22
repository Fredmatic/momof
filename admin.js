fetch("/check-login", {
    credentials: "include"
})
    .then(response => {

        if (!response.ok) {
            window.location.href = "index.html";
            return;
        }

        return response.json();

    })
    .then(data => {

        if (data.role !== "admin") {
            window.location.href = "home.html";
            return;
        }

        console.log("Logged in as:", data.username);
        startAdminDashboard();

    });
const bookingsList = document.getElementById("bookingsList");
const bookingSearch = document.getElementById("bookingSearch");
const statusFilter = document.getElementById("statusFilter");
const refreshBookings = document.getElementById("refreshBookings");

const customersList = document.getElementById("customersList");

const totalBookings = document.getElementById("totalBookings");
const pendingBookings = document.getElementById("pendingBookings");
const confirmedBookings = document.getElementById("confirmedBookings");
const completedBookings = document.getElementById("completedBookings");
const cancelledBookings = document.getElementById("cancelledBookings");


function showBookings(bookings) {

    bookingsList.innerHTML = "";

    bookings.forEach(booking => {

        const bookingCard = document.createElement("div");

        bookingCard.classList.add("booking-card");

        bookingCard.innerHTML = `
            <h3>${booking.service}</h3>
            <p>Reference: ${booking.reference}</p>
            <p>Price: UGX ${booking.price}</p>
            <p>Date: ${booking.date}</p>
            <p>Time: ${booking.time}</p>
            <p>Customer: ${booking.name}</p>
            <p>Phone: ${booking.phone}</p>

            <p>
                Status:
                <span class="booking-status ${booking.status || "pending"}">
                    ${booking.status || "pending"}
                </span>
            </p>

            <div class="booking-actions">
            <button class="confirm-btn">Confirm</button>
            <button class="complete-btn">Complete</button>
            <button class="cancel-btn">Cancel</button>
            </div>
        `;

        // Find the buttons and status inside this booking card
        const confirmButton = bookingCard.querySelector(".confirm-btn");
        const completeButton = bookingCard.querySelector(".complete-btn");
        const cancelButton = bookingCard.querySelector(".cancel-btn");
        const bookingStatus = bookingCard.querySelector(".booking-status");


        // Disable buttons if booking is already processed
        if (booking.status === "pending") {
            completeButton.disabled = true;
        }

        if (booking.status === "confirmed") {
            confirmButton.disabled = true;
            cancelButton.disabled = true;
        }

        if (booking.status === "completed" || booking.status === "cancelled") {
            confirmButton.disabled = true;
            completeButton.disabled = true;
            cancelButton.disabled = true;
        }


        // CONFIRM BOOKING
        confirmButton.addEventListener("click", function () {

            fetch(`/bookings/${booking.reference}`, {
                method: "PATCH",
                credentials: "include",

                headers: {
                    "Content-Type": "application/json"
                },

                body: JSON.stringify({
                    status: "confirmed"
                })
            })

                .then(response => response.json())

                .then(data => {

                    console.log(data);

                    bookingStatus.textContent = "confirmed";

                    bookingStatus.classList.remove("pending", "cancelled");
                    bookingStatus.classList.add("confirmed");

                    confirmButton.disabled = true;
                    cancelButton.disabled = true;

                    loadBookings();
                });

        });
        // COMPLETE BOOKING
        completeButton.addEventListener("click", function () {

            fetch(`/bookings/${booking.reference}`, {
                method: "PATCH",
                credentials: "include",

                headers: {
                    "Content-Type": "application/json"
                },

                body: JSON.stringify({
                    status: "completed"
                })
            })

                .then(response => response.json())

                .then(data => {

                    console.log(data);

                    bookingStatus.textContent = "completed";

                    bookingStatus.classList.remove("pending", "confirmed", "cancelled");
                    bookingStatus.classList.add("completed");

                    confirmButton.disabled = true;
                    completeButton.disabled = true;
                    cancelButton.disabled = true;

                    loadBookings();
                });

        });


        // CANCEL BOOKING
        cancelButton.addEventListener("click", function () {

            fetch(`/bookings/${booking.reference}`, {
                method: "PATCH",
                credentials: "include",

                headers: {
                    "Content-Type": "application/json"
                },

                body: JSON.stringify({
                    status: "cancelled"
                })
            })

                .then(response => response.json())

                .then(data => {

                    console.log(data);

                    bookingStatus.textContent = "cancelled";

                    bookingStatus.classList.remove("pending", "confirmed");
                    bookingStatus.classList.add("cancelled");

                    confirmButton.disabled = true;
                    cancelButton.disabled = true;

                    loadBookings();
                });

        });


        bookingsList.appendChild(bookingCard);

    });
}

function showCustomers(bookings) {

    customersList.innerHTML = "";

    const customers = [];

    bookings.forEach(booking => {

        const existingCustomer = customers.find(
            customer => customer.phone === booking.phone
        );

        if (!existingCustomer) {

            customers.push({
                name: booking.name,
                phone: booking.phone,
                bookings: 1
            });

        }
        else {
            existingCustomer.bookings++;
        }
    });

    customers.forEach(customer => {

        const customerCard = document.createElement("div");

        customerCard.classList.add("customer-card");

        customerCard.innerHTML = `
        <h3>${customer.name}</h3>
        <p>Phone: ${customer.phone}</p>
        <p>Bookings: ${customer.bookings}</p>
        <button class="view-history-btn">View History</button>
        `;

        const historyButton = customerCard.querySelector(".view-history-btn");

        historyButton.addEventListener("click", function () {

            const customerBookings = bookings.filter(
                booking => booking.phone === customer.phone
            );

            showCustomerHistory(customerBookings);

        });

        customersList.appendChild(customerCard);

    });
}

function showCustomerHistory(bookings) {

    const customerHistoryList =
        document.getElementById("customerHistoryList");

    customerHistoryList.innerHTML = "";

    if (bookings.length === 0) {

        customerHistoryList.innerHTML = `
            <p class="history-empty">
                No booking history found.
            </p>
        `;

        return;
    }

    bookings.forEach(booking => {

        const historyCard = document.createElement("div");

        historyCard.classList.add("booking-card");

        historyCard.innerHTML = `
            <h3>${booking.service}</h3>

            <p>Reference: ${booking.reference}</p>
            <p>Date: ${booking.date}</p>
            <p>Time: ${booking.time}</p>
            <p>Price: UGX ${booking.price}</p>

            <p>
                Status:
                <span class="booking-status ${booking.status || "pending"}">
                    ${booking.status || "pending"}
                </span>
            </p>
        `;

        customerHistoryList.appendChild(historyCard);

    });
}

function loadBookings() {

    fetch("/bookings", {
        credentials: "include"
    })

        .then(response => response.json())

        .then(data => {

            let pending = 0;
            let confirmed = 0;
            let cancelled = 0;
            let completed = 0;


            data.forEach(booking => {

                if (!booking.status || booking.status === "pending") {
                    pending++;
                }

                if (booking.status === "confirmed") {
                    confirmed++;
                }

                if (booking.status === "cancelled") {
                    cancelled++;
                }
                if (booking.status === "completed") {
                    completed++;
                }

            });


            totalBookings.textContent = data.length;
            pendingBookings.textContent = pending;
            confirmedBookings.textContent = confirmed;
            cancelledBookings.textContent = cancelled;
            completedBookings.textContent = completed;


            // Show all bookings
            showBookings(data);

            showCustomers(data);

        });
}

// bookingSearch.addEventListener("input", function () {

//     const searchText = bookingSearch.value.toLowerCase();

//     fetch("/bookings")
//         .then(response => response.json())
//         .then(data => {

//             const results = data.filter(booking =>
//                 booking.name.toLowerCase().includes(searchText) ||
//                 booking.reference.toLowerCase().includes(searchText)
//             );

//             showBookings(results);

//         });

// });
// statusFilter.addEventListener("change", function () {

//     const selectedStatus = statusFilter.value;

//     fetch("/bookings")
//         .then(response => response.json())
//         .then(data => {

//             let results = data;

//             if (selectedStatus !== "all") {

//                 results = data.filter(booking =>
//                     (booking.status || "pending") === selectedStatus
//                 );

//             }

//             showBookings(results);

//         });

// });
function startAdminDashboard() {

    loadBookings();

    bookingSearch.addEventListener("input", function () {

        const searchText = bookingSearch.value.toLowerCase();

        fetch("/bookings", {
            credentials: "include"
        })
            .then(response => response.json())
            .then(data => {

                const results = data.filter(booking =>
                    booking.name.toLowerCase().includes(searchText) ||
                    booking.reference.toLowerCase().includes(searchText)
                );

                showBookings(results);

            });

    });

    statusFilter.addEventListener("change", function () {

        const selectedStatus = statusFilter.value;

        fetch("/bookings", {
            credentials: "include"
        })
            .then(response => response.json())
            .then(data => {

                let results = data;

                if (selectedStatus !== "all") {

                    results = data.filter(booking =>
                        (booking.status || "pending") === selectedStatus
                    );

                }

                showBookings(results);

            });

    });

    refreshBookings.addEventListener("click", function () {
        loadBookings();
    });

}


