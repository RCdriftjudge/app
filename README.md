# RC Drift Judge — Live Test

This repository contains the live-test web app for the RC drift competition judging system.

## Stack
- Vite
- Supabase Auth / Postgres / RLS / Realtime
- Mobile-first PWA-style web app

## Security
- `.env.local` is intentionally excluded from Git.
- Put the Supabase URL and publishable key in local/deployment environment variables.
- Never commit a Supabase secret/service-role key.

## Current scope
- Director / Judge / Live Display roles
- Shared competition state foundation
- Judge decisions and special-situation calls
- Offline event queue with idempotency keys
- Supabase RLS policies
- SDC 2026 Rev. 10.4 rules foundation
