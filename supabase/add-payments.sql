-- Run this ONCE in Supabase: dashboard -> SQL Editor -> New query -> paste -> Run.
-- It adds the online-payment columns to your existing "bookings" table.
-- Existing bookings are untouched; they simply show as unpaid.

alter table bookings
    add column if not exists total_amount numeric(12, 0),
    add column if not exists payment_percent integer,
    add column if not exists amount_due numeric(12, 0),
    add column if not exists amount_paid numeric(12, 0) not null default 0,
    add column if not exists payment_status text not null default 'unpaid',
    add column if not exists payment_tx_ref text,
    add column if not exists payment_transaction_id text;
