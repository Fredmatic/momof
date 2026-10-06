// Makes text safe to place inside HTML built with template strings.
// Anything a visitor can type (names, phone numbers, review comments...)
// must go through this before it is put into innerHTML, otherwise a
// visitor could inject their own script into your pages.
// Also safe inside quoted attributes, e.g. alt="..." or href="...".
function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}
