-- Run this ONCE in Supabase: dashboard -> SQL Editor -> New query -> paste -> Run.
-- It adds the deposit columns to your existing "bookings" table.
-- Existing bookings are untouched; they simply have no deposit information.
-- It is safe to run more than once.

alter table bookings
    add column if not exists total_amount numeric(12, 0), -- full price (set by the server)
    add column if not exists payment_percent integer, -- share the customer chose to pay now (50-100)
    add column if not exists amount_due numeric(12, 0), -- deposit the customer says they sent
    add column if not exists amount_paid numeric(12, 0) not null default 0, -- what you confirmed you received
    add column if not exists payment_status text not null default 'unpaid', -- unpaid | claimed | partial | paid | rejected
    add column if not exists payment_method text, -- MTN or AIRTEL
    add column if not exists payment_transaction_id text; -- mobile money transaction ID from the customer's SMS

-- A transaction ID can only ever pay for one booking.
create unique index if not exists bookings_payment_txn_unique
    on bookings (payment_transaction_id)
    where payment_transaction_id is not null;
