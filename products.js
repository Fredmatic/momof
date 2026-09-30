const productsContainer = document.getElementById("productsContainer");

function formatUGX(amount) {
    return "UGX " + Number(amount).toLocaleString("en-UG");
}

function whatsappLink(productName) {
    const message = `Hello MOMO's PALOR, is "${productName}" in stock?`;
    return "https://wa.me/256766513833?text=" + encodeURIComponent(message);
}

function renderProducts(products) {

    if (products.length === 0) {
        productsContainer.innerHTML =
            '<p class="empty-message">No products listed yet -- check back soon, or ask us on WhatsApp.</p>';
        return;
    }

    productsContainer.innerHTML = products.map(product => {

        const imageSrc = product.image ? `images/${product.image}` : "images/image.jpg";

        const actionHtml = product.in_stock
            ? `<a class="wa-btn" href="${whatsappLink(product.name)}" target="_blank" rel="noopener">Ask on WhatsApp</a>`
            : `<span class="out-of-stock-badge">Out of Stock</span>`;

        return `
            <div class="service-card">
                <img src="${imageSrc}" alt="${product.name}">
                <h3>${product.name}</h3>
                <p>${product.description || ""}</p>
                <p class="product-price">${formatUGX(product.price)}</p>
                ${actionHtml}
            </div>
        `;

    }).join("");

}

fetch("/products")
    .then(response => response.json())
    .then(products => {
        renderProducts(products);
    })
    .catch(() => {
        productsContainer.innerHTML =
            '<p class="empty-message">Couldn\'t load products right now. Please refresh the page.</p>';
    });