// Page-loading overlay: visible by default (see the HTML), this hides it
// once the page has finished loading, and shows it again for a moment when
// the visitor clicks a link to another page on this site -- so moving
// between pages feels like one smooth transition instead of a blank flash.
(function () {
    const overlay = document.getElementById("pageLoader");
    if (!overlay) return;

    window.addEventListener("load", function () {
        setTimeout(function () {
            overlay.classList.add("hide");
        }, 2000);
    });

    document.addEventListener("click", function (event) {
        const link = event.target.closest("a[href]");
        if (!link) return;

        const href = link.getAttribute("href");

        // Only re-show it for a normal link to another page on this site --
        // not for "#" links, external links, mailto/tel/wa.me, or links
        // that open in a new tab.
        const isSameSitePage =
            href &&
            href !== "#" &&
            !href.startsWith("#") &&
            !href.startsWith("http") &&
            !href.startsWith("mailto:") &&
            !href.startsWith("tel:") &&
            link.target !== "_blank";

        if (isSameSitePage) {
            overlay.classList.remove("hide");
        }
    });
})();