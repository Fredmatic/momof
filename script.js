const loginForm = document.getElementById("loginForm");

if (loginForm) {

    const userNameInput = document.getElementById("userNameInput");
    const passwordInput = document.getElementById("passwordInput");
    const message = document.getElementById("message");

    loginForm.addEventListener("submit", function (event) {

        event.preventDefault();

        const username = userNameInput.value.trim();
        const password = passwordInput.value;

        fetch("/login", {
            method: "POST",
            credentials: "include",

            headers: {
                "Content-Type": "application/json"
            },

            body: JSON.stringify({
                username: username,
                password: password
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

                message.textContent = data.message;

                loginForm.reset();

                setTimeout(() => {

                    if (data.role === "admin") {
                        window.location.href = "admin.html";
                    } else {
                        window.location.href = "home.html";
                    }

                }, 1000);

            })
            .catch(error => {

                message.textContent = error.message;

            });

    });

}


const currentPage = window.location.pathname;

if (
    currentPage.includes("home.html") ||
    currentPage.includes("services.html") ||
    currentPage.includes("products.html") ||
    currentPage.includes("my-bookings.html") ||
    currentPage.includes("contact.html")
) {

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

            if (!data) return;

            console.log("Logged in as:", data.username);

        });

}

const registerForm = document.getElementById("registerForm");

if (registerForm) {

    const registerUsername =
        document.getElementById("registerUsername");

    const registerPassword =
        document.getElementById("registerPassword");

    const registerMessage =
        document.getElementById("registerMessage");

    registerForm.addEventListener("submit", function (event) {

        event.preventDefault();

        fetch("/register", {
            method: "POST",

            headers: {
                "Content-Type": "application/json"
            },

            body: JSON.stringify({
                username: registerUsername.value.trim(),
                password: registerPassword.value
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

                registerMessage.textContent = data.message;

                registerForm.reset();

                setTimeout(() => {
                    window.location.href = "home.html";
                }, 1000);

            })
            .catch(error => {

                registerMessage.textContent = error.message;

            });

    });

}

// Show/hide password: works on any page for any <button class="toggle-password"
// data-target="idOfThePasswordInput"> next to a password field. One handler
// covers login, register, and any future password field, so nothing extra
// is needed when a new one is added elsewhere.
document.querySelectorAll(".toggle-password").forEach(function (button) {

    const input = document.getElementById(button.dataset.target);
    const icon = button.querySelector("i");

    button.addEventListener("click", function () {

        const showing = input.type === "text";

        input.type = showing ? "password" : "text";
        icon.classList.toggle("fa-eye", showing);
        icon.classList.toggle("fa-eye-slash", !showing);
        button.setAttribute("aria-label", showing ? "Show password" : "Hide password");

    });

});