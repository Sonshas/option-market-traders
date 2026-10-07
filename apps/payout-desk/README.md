# Real payout desk

React 19, TypeScript, Vite, and Tailwind. The wallet, fee order, and payout steps live in Supabase.

```bash
cd real-mpesa-withdraw
npm install
npm run dev
```

Open http://localhost:5174/

Copy `.env.example` to `.env.local` and fill in the Supabase URL and anon key. Apply `supabase/migrations/20261004140000_payout_desk.sql` in the Supabase SQL editor before signing in.

How this connects to the main site is in [INTEGRATION.md](INTEGRATION.md).
