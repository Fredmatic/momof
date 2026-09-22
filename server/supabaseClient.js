// Sets up one shared Supabase client for the whole server to use.
//
// SUPABASE_SERVICE_ROLE_KEY bypasses Row Level Security, which is what we
// want here: this key is only ever used on the server (never sent to the
// browser), and our own routes already decide who's allowed to do what
// (requireLogin / requireAdmin below in index.js).

const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error(
        "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. " +
        "Copy .env.example to .env and fill in your Supabase project's values."
    );
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
        // We're not using Supabase Auth sessions here, just the database.
        persistSession: false
    }
});

module.exports = supabase;
