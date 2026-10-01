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
const hideDone = document.getElementById("hideDone");
const refreshBookings = document.getElementById("refreshBookings");

const customersList = document.getElementById("customersList");

const totalBookings = document.getElementById("totalBookings");
const pendingBookings = document.getElementById("pendingBookings");
const confirmedBookings = document.getElementById("confirmedBookings");
const completedBookings = document.getElementById("completedBookings");
const cancelledBookings = document.getElementById("cancelledBookings");
const monthRevenue = document.getElementById("monthRevenue");
const totalRevenue = document.getElementById("totalRevenue");

// Holds every booking fetched from the server, so search/filter/hide can
// all be applied locally without hitting the network again each time.
let allBookings = [];

// Booking "price" is stored as free-form text (e.g. "50000"), so pull out
// just the digits before treating it as a number.
function priceToNumber(price) {
    const digitsOnly = String(price || "").replace(/[^\d]/g, "");
    return digitsOnly ? parseInt(digitsOnly, 10) : 0;
}

function formatUGX(amount) {
    return "UGX " + amount.toLocaleString("en-UG");
}



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
            ${booking.email ? `<p>Email: ${booking.email}</p>` : ""}
            ${booking.photo_url ? `<p>Reference photo: <a href="${booking.photo_url}" target="_blank" rel="noopener"><img src="${booking.photo_url}" alt="Customer's reference photo" class="booking-photo-thumb"></a></p>` : ""}

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

            allBookings = data;

            let pending = 0;
            let confirmed = 0;
            let cancelled = 0;
            let completed = 0;
            let monthTotal = 0;
            let allTimeTotal = 0;

            const now = new Date();
            const currentMonth = now.getMonth();
            const currentYear = now.getFullYear();

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

                    // Revenue only counts completed bookings -- pending or
                    // cancelled bookings were never actually paid for.
                    const amount = priceToNumber(booking.price);
                    allTimeTotal += amount;

                    // booking.date is the appointment date (YYYY-MM-DD),
                    // parsed as local time so "this month" matches what an
                    // admin in the same timezone expects.
                    const bookingDate = new Date(booking.date + "T00:00:00");

                    if (
                        bookingDate.getMonth() === currentMonth &&
                        bookingDate.getFullYear() === currentYear
                    ) {
                        monthTotal += amount;
                    }
                }

            });


            totalBookings.textContent = data.length;
            pendingBookings.textContent = pending;
            confirmedBookings.textContent = confirmed;
            cancelledBookings.textContent = cancelled;
            completedBookings.textContent = completed;
            monthRevenue.textContent = formatUGX(monthTotal);
            totalRevenue.textContent = formatUGX(allTimeTotal);


            // Re-apply whatever search/filter/hide-done state is currently
            // set, rather than always showing everything after a reload.
            renderFilteredBookings();

            showCustomers(data);

        });
}

// Applies the search box, status dropdown, and "hide completed &
// cancelled" checkbox together against the cached allBookings list, with
// no extra network request.
function renderFilteredBookings() {

    const searchText = bookingSearch.value.toLowerCase();
    const selectedStatus = statusFilter.value;

    let results = allBookings;

    if (searchText) {
        results = results.filter(booking =>
            booking.name.toLowerCase().includes(searchText) ||
            booking.reference.toLowerCase().includes(searchText)
        );
    }

    if (selectedStatus !== "all") {
        results = results.filter(booking =>
            (booking.status || "pending") === selectedStatus
        );
    }

    if (hideDone.checked) {
        results = results.filter(booking =>
            booking.status !== "completed" && booking.status !== "cancelled"
        );
    }

    showBookings(results);
}

// (Old commented-out search/filter code removed -- replaced by
// renderFilteredBookings(), which combines search, status, and
// hide-completed filtering against the cached allBookings list.)

function startAdminDashboard() {

    loadBookings();

    bookingSearch.addEventListener("input", renderFilteredBookings);

    statusFilter.addEventListener("change", renderFilteredBookings);

    hideDone.addEventListener("change", renderFilteredBookings);

    refreshBookings.addEventListener("click", function () {
        loadBookings();
    });

    const resetPasswordForm = document.getElementById("resetPasswordForm");
    const resetPasswordMessage = document.getElementById("resetPasswordMessage");

    resetPasswordForm.addEventListener("submit", function (event) {

        event.preventDefault();

        const username = document.getElementById("resetUsername").value.trim();
        const newPassword = document.getElementById("resetNewPassword").value;

        resetPasswordMessage.textContent = "Resetting...";

        fetch("/admin/reset-password", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ username, newPassword })
        })
            .then(response => response.json().then(data => ({ ok: response.ok, data })))
            .then(({ ok, data }) => {

                resetPasswordMessage.textContent = data.message;
                resetPasswordMessage.style.color = ok ? "#4caf50" : "#ff6b6b";

                if (ok) {
                    resetPasswordForm.reset();
                }

            })
            .catch(() => {
                resetPasswordMessage.textContent = "Something went wrong. Please try again.";
                resetPasswordMessage.style.color = "#ff6b6b";
            });

    });

    startProductManager();

}

// ---------- Product management ----------

function resolveProductImageSrc(image) {
    if (!image) return "images/image.jpg";
    // Old products (added before photo upload existed) stored just a
    // filename like "product1.jpg"; new ones store a full Supabase
    // Storage URL. Handle both.
    return image.startsWith("http") ? image : `images/${image}`;
}

function startProductManager() {

    const productForm = document.getElementById("productForm");
    const productFormSubmit = document.getElementById("productFormSubmit");
    const productFormCancel = document.getElementById("productFormCancel");
    const productMessage = document.getElementById("productMessage");
    const productsAdminList = document.getElementById("productsAdminList");

    const productId = document.getElementById("productId");
    const productName = document.getElementById("productName");
    const productDescription = document.getElementById("productDescription");
    const productPrice = document.getElementById("productPrice");
    const productImageFile = document.getElementById("productImageFile");
    const productImagePreview = document.getElementById("productImagePreview");
    const productInStock = document.getElementById("productInStock");

    function resetForm() {
        productForm.reset();
        productId.value = "";
        productInStock.checked = true;
        productImagePreview.style.display = "none";
        productFormSubmit.textContent = "Add Product";
        productFormCancel.style.display = "none";
    }

    function loadProducts() {

        fetch("/products")
            .then(response => response.json())
            .then(products => {

                if (products.length === 0) {
                    productsAdminList.innerHTML = '<p class="empty-message">No products added yet.</p>';
                    return;
                }

                productsAdminList.innerHTML = products.map(product => {

                    const imageSrc = resolveProductImageSrc(product.image);

                    return `
                        <div class="product-admin-card">
                            <img src="${imageSrc}" alt="${product.name}">
                            <div class="product-admin-info">
                                <h4>${product.name} -- UGX ${Number(product.price).toLocaleString("en-UG")}</h4>
                                <p>${product.in_stock ? "In stock" : "Out of stock"}</p>
                            </div>
                            <div class="product-admin-actions">
                                <button class="btn-edit" data-id="${product.id}">Edit</button>
                                <button class="btn-toggle" data-id="${product.id}" data-instock="${product.in_stock}">
                                    ${product.in_stock ? "Mark Out of Stock" : "Mark In Stock"}
                                </button>
                                <button class="btn-delete" data-id="${product.id}">Delete</button>
                            </div>
                        </div>
                    `;

                }).join("");

                // Wire up the buttons just rendered above.

                productsAdminList.querySelectorAll(".btn-edit").forEach(button => {
                    button.addEventListener("click", function () {

                        const product = products.find(p => p.id === button.dataset.id);
                        if (!product) return;

                        productId.value = product.id;
                        productName.value = product.name;
                        productDescription.value = product.description || "";
                        productPrice.value = product.price;
                        productImageFile.value = ""; // can't prefill a file input -- only a new upload replaces it
                        productInStock.checked = product.in_stock;

                        if (product.image) {
                            productImagePreview.src = resolveProductImageSrc(product.image);
                            productImagePreview.style.display = "inline-block";
                        } else {
                            productImagePreview.style.display = "none";
                        }

                        productFormSubmit.textContent = "Update Product";
                        productFormCancel.style.display = "inline-block";

                        productForm.scrollIntoView({ behavior: "smooth" });

                    });
                });

                productsAdminList.querySelectorAll(".btn-toggle").forEach(button => {
                    button.addEventListener("click", function () {

                        const newInStock = button.dataset.instock !== "true";

                        fetch(`/products/${button.dataset.id}`, {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            credentials: "include",
                            body: JSON.stringify({ in_stock: newInStock })
                        })
                            .then(() => loadProducts());

                    });
                });

                productsAdminList.querySelectorAll(".btn-delete").forEach(button => {
                    button.addEventListener("click", function () {

                        if (!confirm("Delete this product? This can't be undone.")) {
                            return;
                        }

                        fetch(`/products/${button.dataset.id}`, {
                            method: "DELETE",
                            credentials: "include"
                        })
                            .then(() => loadProducts());

                    });
                });

            });

    }

    productForm.addEventListener("submit", function (event) {

        event.preventDefault();

        const formData = new FormData();
        formData.append("name", productName.value.trim());
        formData.append("description", productDescription.value.trim());
        formData.append("price", productPrice.value);
        formData.append("in_stock", productInStock.checked);

        if (productImageFile.files[0]) {
            formData.append("image", productImageFile.files[0]);
        }

        const isEditing = Boolean(productId.value);

        const request = isEditing
            ? fetch(`/products/${productId.value}`, {
                method: "PATCH",
                credentials: "include",
                body: formData
            })
            : fetch("/products", {
                method: "POST",
                credentials: "include",
                body: formData
            });

        productMessage.textContent = isEditing ? "Updating..." : "Adding...";

        request
            .then(response => response.json().then(data => ({ ok: response.ok, data })))
            .then(({ ok, data }) => {

                if (!ok) {
                    productMessage.textContent = data.message || "Something went wrong.";
                    productMessage.style.color = "#ff6b6b";
                    return;
                }

                productMessage.textContent = isEditing ? "Product updated." : "Product added.";
                productMessage.style.color = "#4caf50";

                resetForm();
                loadProducts();

            })
            .catch(() => {
                productMessage.textContent = "Something went wrong. Please try again.";
                productMessage.style.color = "#ff6b6b";
            });

    });

    productFormCancel.addEventListener("click", resetForm);

    loadProducts();

}