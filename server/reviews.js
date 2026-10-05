const reviewsContainer = document.getElementById("reviewsContainer");

function starsHtml(rating) {
    return Array.from({ length: 5 }, (_, i) =>
        `<i class="${i < rating ? "fas" : "far"} fa-star"></i>`
    ).join("");
}

fetch("/reviews/approved")
    .then(response => response.json())
    .then(reviews => {

        if (reviews.length === 0) {
            reviewsContainer.innerHTML =
                '<p class="empty-message">No reviews yet -- be the first to leave one after your visit!</p>';
            return;
        }

        reviewsContainer.innerHTML = reviews.map(review => `
            <div class="review-card">
                <div class="review-stars">${starsHtml(review.rating)}</div>
                ${review.comment ? `<p class="review-comment-text">"${review.comment}"</p>` : ""}
                <p class="review-author">-- ${review.customer_name}</p>
            </div>
        `).join("");

    })
    .catch(() => {
        reviewsContainer.innerHTML =
            '<p class="empty-message">Couldn\'t load reviews right now.</p>';
    });