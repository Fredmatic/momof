-- Run this once in your Supabase project's SQL Editor
-- (Supabase dashboard -> SQL Editor -> New query -> paste -> Run).
-- It creates the two tables the app needs.

create extension if not exists pgcrypto;

create table if not exists users (
    id uuid primary key default gen_random_uuid(),
    username text unique not null,
    password text not null, -- bcrypt hash, never a plain password
    role text not null default 'customer',
    created_at timestamptz not null default now()
);

create table if not exists bookings (
    id uuid primary key default gen_random_uuid(),
    reference text unique not null,
    service text not null,
    price text,
    date date not null,
    time text not null,
    name text not null,
    phone text not null,
    status text not null default 'pending',
    created_at timestamptz not null default now()
);

-- The server connects with the "service role" key, which bypasses Row
-- Level Security entirely, so RLS being on or off doesn't matter for this
-- app. We enable it anyway as a safety net in case the anon/public key is
-- ever used against this database by mistake — with RLS on and no policies,
-- that key can't read or write anything.
alter table users enable row level security;
alter table bookings enable row level security;
