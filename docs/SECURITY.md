# Security

## Verification checklist (performed before release)

| Control | Status | Implementation / evidence |
|---|---|---|
| `.env` ignored | ✅ | `.gitignore`: `.env`, `.env.*`, `!.env.example`; `git check-ignore .env` |
| No secrets in git history | ✅ | `git log -p` scanned for key patterns and the local `AUTH_SECRET` value — none |
| No hard-coded API keys | ✅ | all keys via `src/lib/config/env.ts` (zod, server-only) |
| Credentials never logged | ✅ | `src/lib/security/logger.ts` redacts key/secret/token/password/email/phone/free-text fields and key-like values; tested |
| Sensitive input not logged | ✅ | logs carry ids and counts only; server logs of full E2E run contain no names or inputs |
| API keys server-side only | ✅ | `import "server-only"` in every module touching env/adapters; the browser talks only to `/api/*` |
| Admin functions require auth | ✅ | all pages/APIs require a signed session; admin APIs/pages require role `admin` (`api({access:"admin"})`, `requireAdmin`) |
| Source URLs handled safely | ✅ | only `http(s)` URLs rendered (`safeHref`), `rel="noopener noreferrer nofollow"`, `referrerPolicy=no-referrer`; demo URLs render locally |
| SSRF protection | ✅ | `src/lib/security/ssrf.ts`: scheme/port/userinfo checks, DNS resolution with all addresses checked against private/reserved v4/v6 ranges, **IP pinned for the connection** (no rebinding), redirects re-validated (max 3), size/time/content-type limits; tested |
| Rate limiting | ✅ | inbound per user/IP sliding window per route group (login 10/min, setup 5/min, search 20/min…); outbound per-provider token buckets |
| Input validation | ✅ | zod schemas on every API body; lock/add endpoints require literal `confirm: true` |
| CSRF | ✅ | `SameSite=Lax` HttpOnly cookie + same-origin check on mutating requests |
| Passwords | ✅ | scrypt (N=16384) with per-user salt, constant-time compare |
| Sessions | ✅ | HMAC-SHA256 signed, 12 h expiry, tamper/expiry tested |
| Security headers | ✅ | CSP (no third-party origins), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy` |
| Audit trail | ✅ | `audit_log`: logins, failed logins, searches (purpose), locks, verifications, scans, monitoring changes, provider toggles |

## Scope limits (by design)

Not implemented and not to be added: authentication/CAPTCHA bypass, credential collection, social-media passwords, private posts/messages/accounts, breach/credential data, financial or medical records, device tracking, live phone location, carrier/subscriber lookups. Login-walled platforms are covered only through public search-engine results (LIMITED). The direct fetcher identifies itself and honours robots.txt.

## Operational guidance

- Set a strong `AUTH_SECRET` and `APP_ENV=production` in production (startup refuses to sign sessions without it).
- Put the app behind HTTPS; cookies are `Secure` when `NODE_ENV=production`.
- For multi-instance deployments add edge rate limiting (in-memory limits are per instance).
- Keep SearXNG, the Maigret sidecar and changedetection.io on a private network (compose binds them to `127.0.0.1`).
- Review the audit log periodically; remove incorrect attributes/identifiers from the person view (soft delete with timeline entry).
