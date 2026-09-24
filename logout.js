// Shared logout handler. Include this on every page that has a
// <button id="logout"> (home.html, services.html, ...).
(function () {
    const logoutButton = document.getElementById("logout");

    if (!logoutButton) return;

    logoutButton.addEventListener("click", async function () {
        try {
            const response = await fetch("/logout", {
                method: "POST",
                credentials: "include"
            });

            if (!response.ok) {
                throw new Error("Server responded with status " + response.status);
            }

            // replace() so the Back button can't return to a protected page
            window.location.replace("index.html");

        } catch (error) {
            console.error("Logout failed:", error);
            alert("Could not log out. Make sure the server is running and " +
                "you opened the site through it (e.g. http://localhost:3000).");
        }
    });
})();