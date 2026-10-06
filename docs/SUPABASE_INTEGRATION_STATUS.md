# Supabase integration status

**Date:** 2026-09-20  
**Phase:** End-to-end finish — DEMO preserved + REAL Auth on Smart Base Binary  
**Project used:** Smart Base Binary  
**Ref:** `wkfyavcjjuyzvyeprklz`  
**URL:** `https://wkfyavcjjuyzvyeprklz.supabase.co`  
**Secrets:** none in this file

### Project selection

| Project | Ref | Used? |
|---|---|---|
| **Smart Base Binary** | `wkfyavcjjuyzvyeprklz` | **Yes** |
| Poa Match | `ddbqjoqkvvgzkoahnoye` | No |
| VAST DERIV TRADERS | `ipczhtendvxlwljeyiyo` | **No** |

---

## Behaviour

| Area | Status |
|---|---|
| Auth (signup/login/logout/session/reset) | Connected to Supabase Auth |
| Post-login mode | Enters **REAL ACCOUNT** (`enterRealAfterAuth`) |
| Auth pages when signed in | Redirect to `/app` |
| Protected `/app/*` | `RequireAuth` |
| Profile | `auth.users` → `public.users` / `profiles` |
| REAL Status | **CONNECTED** when authenticated |
| REAL wallet | RLS read only; else Balance unavailable / Not available |
| REAL trading execution | **Disabled** |
| REAL payments | **Disabled** |
| DEMO engine | Unchanged — Even/Odd, Match/Differ, Over/Under local simulation |
| Schema changes | **None** |

---

## Remaining limitations

- REAL placeTrade / settlement not enabled
- Payment provider not connected
- KYC upload UI / TOTP 2FA not enabled
- DEMO trades stay local (not written to Supabase financial tables)

**No production data modified. No destructive migrations. No deploy.**
