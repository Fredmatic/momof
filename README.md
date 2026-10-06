# MOMO'S PALOR

A beauty salon website with account login/registration, a service-booking
form, and an admin dashboard for managing bookings.

- **Frontend:** plain HTML, CSS, and JavaScript (`index.html`, `home.html`,
  `services.html`, `admin.html`, `register.html`, plus their matching
  `.js`/`.css` files and the `images/` folder).
- **Backend:** a Node.js + Express API in `server/index.js`.
- **Database:** [Supabase](https://supabase.com) (hosted Postgres) stores
  users and bookings, so data survives server restarts and deploys.

## 1. Install prerequisites

You need [Node.js](https://nodejs.org) (includes npm) installed on your
computer. Check with:

```bash
node -v
npm -v
```

## 2. Create your Supabase project

1. Go to [supabase.com](https://supabase.com), sign up (free), and click
   **New project**. Pick any name/region and a database password (save it
   somewhere — you likely won't need it again for this app, but keep it).
2. Once the project is ready, open **SQL Editor** in the left sidebar,
   click **New query**, paste in the contents of `supabase/schema.sql`
   (in this repo), and click **Run**. This creates the `users` and
   `bookings` tables.
3. Open **Project Settings -> API**. You'll need two values from there:
   - **Project URL** (looks like `https://xxxxxxxxxxxx.supabase.co`)
   - **service_role** secret key (under "Project API keys" — NOT the
     `anon` public key). This key has full database access, so it's only
     ever used on the server, never in the frontend.

## 3. Install project dependencies

From the project folder, run:

```bash
npm install
```

## 4. Configure environment variables

Copy the example file:

```bash
cp .env.example .env
```

Open `.env` and fill in `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` with
the values from step 2, and set `SESSION_SECRET` to any long random string.
`.env` is git-ignored, so these stay on your machine only.

## 5. Run the site locally

```bash
npm run dev        # auto-restarts on file changes, good while developing
# or
npm start          # plain run
```

You'll see `Server is running on http://localhost:3000` — open that URL in
your browser. The whole site (login, registration, booking, admin
dashboard) is served from there.

### Create your first admin account

There's no admin account by default. Create one once, e.g. with curl:

```bash
curl -X POST http://localhost:3000/create-admin \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"choose-a-strong-password"}'
```

This only works once — the endpoint refuses to create a second admin.

## 6. Commit and push to GitHub

Since your repo already exists on GitHub, from inside the project folder:

```bash
git add .
git commit -m "Add Supabase database and prepare for Render deployment"
git push
```

(If `git push` asks for a remote/branch you don't recognize, run
`git status` first to see what's staged and `git remote -v` to confirm
you're pointing at the right GitHub repo.)

## 7. Deploy for free on Render

1. Go to [render.com](https://render.com), sign up (free), and click
   **New -> Web Service**.
2. Connect your GitHub account and pick this repository.
3. Render should detect Node automatically. Set:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free
4. Under **Environment**, add these environment variables (same
   names/values as your local `.env`, except `NODE_ENV`):
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `SESSION_SECRET`
   - `NODE_ENV` = `production`
   - `CLIENT_ORIGIN` — you can leave this as-is; it's only used if you ever
     serve the frontend from a separate domain than the API.
5. Click **Create Web Service**. Render will build and deploy; when it's
   done you'll get a URL like `https://your-app-name.onrender.com` — that's
   your live site.

A `render.yaml` file is included in the repo if you'd rather use Render's
"Blueprint" flow (New -> Blueprint) — it pre-fills the build/start commands
and lists which environment variables to fill in.

## 8. Updating the site

- Edit any `.html`, `.css`, or `.js` file and refresh your browser to see
  the change locally.
- Backend/API logic lives in `server/index.js`; database access is
  centralized in `server/supabaseClient.js`.
- After making changes: commit and push to GitHub (step 6) — Render
  automatically redeploys on every push to your connected branch.

## Deposits (mobile money)

Customers pay a **deposit of 50% or more** (50%, 75%) or the **full price** when they book. This is optional: with no payment numbers set, bookings work exactly as before.

**How it works:** the booking page shows your MTN / Airtel number and the amount to send. The customer sends the money, then enters the **transaction ID** from their confirmation SMS. The booking appears in your admin page with a **"Deposit to check"** box showing the amount, the network and the transaction ID. You look for that transaction in your own mobile money messages (or statement) and press:

- **Payment received**: you type the amount that actually arrived (it's pre-filled with what the customer claimed). The customer gets a "Deposit received" email, and the card shows the balance to collect at the salon.
- **Not received**: the booking is cancelled and the customer is emailed, asking them to get in touch if they really did pay.

Nothing is automatic, so please check the messages for every booking before you press the green button. Each transaction ID can only be used for one booking, and one visitor can create at most 30 bookings an hour.

### One-time setup

1. **Database:** in Supabase -> SQL Editor, run the contents of `supabase/add-payments.sql` once.
2. **Your numbers** (in `.env` locally, and in Render -> Environment):
   - `PAYMENT_MTN_NUMBER` and/or `PAYMENT_AIRTEL_NUMBER`: the numbers customers send money to
   - `PAYMENT_ACCOUNT_NAME`: the name registered on those numbers
3. Restart the server, make a test booking, and check that it appears in the admin page with the deposit box.

### Things to know

- **Prices live in two places.** The booking page shows prices from `services.html`, but the server uses its own list (`SERVICE_PRICES` near the top of the deposit section in `server/index.js`) so customers can't change what they owe. If you add a service or change a price, update both.
- The minimum upfront share (50%) is `MIN_PERCENT` in `server/payments.js`. To offer other choices (e.g. 60%), add them to the radio buttons in `services.html`.
- Emails (receipts, "deposit received") only go out if the email settings above are filled in and the customer gave an email address.
- Refunds are done from your mobile money account; cancelling a booking in the admin page does not send money back.
- **Adding Pesapal later** (automatic payments): the deposit amounts, the 50% rule, the admin payment lines and the emails all stay; only the "customer types a transaction ID" step is replaced by Pesapal's checkout page, which confirms payments automatically.

## Notes / things to know

- **Render's free tier spins the service down after periods of no
  traffic** and takes a few seconds to wake back up on the next request —
  normal for free hosting, no action needed.
- **Sessions still use `express-session`'s in-memory store.** That's fine
  for a small site, but it means logged-in sessions reset whenever Render
  restarts the service (e.g. after it spins down from inactivity) — users
  just have to log in again, no data is lost since that now lives in
  Supabase. If this becomes annoying, a next step would be a persistent
  session store (e.g. `connect-pg-simple` against the same Supabase
  database) — ask if you'd like help adding that.
- Do not commit your real `.env` file or `node_modules/` — both are
  already excluded via `.gitignore`.
- **Adding new pages or features? Escape what customers type.** Names, phone numbers, review comments and so on must be wrapped in `escapeHtml(...)` (from `escape.js`) whenever they're placed into `innerHTML` or a template string; otherwise a visitor could inject their own script into your pages. Using `element.textContent = value` is also safe. Emails do the same with `esc(...)` in `server/mailer.js`.
- Booking references look like `MP-K7Q3XD9H`. The public "Check your booking" lookup only shows the service, date, time, status and payment summary (never names, phone numbers or emails) and is rate-limited.
