# Triple Z POS

A small point-of-sale and order tracker for **Triple Z Printing**. It runs as one Node.js app that serves simple pages.
There is no separate front-end project.

- **Orders:** customer, job description, line items, deadline, rush flag, status (Pending → In progress → Ready for pickup → Released, or Cancelled).
- **Deadline reminders and urgency:** each order is tagged *Overdue*, *Urgent* (due within 24 h, or a rush job due within 48 h), *Due soon* (within 3 days) or *On track*.
  The dashboard shows an alert banner. A bell in the header updates every minute. Click **Enable alerts** to also get desktop notifications.
- **Sales:** record full or partial payments (Cash, GCash, Bank transfer, Other) against an order. A sale counts on the day the money is received.
- **Sales history:** today, the last 7 days, this month or custom dates. Shows totals per day and per payment method, and can be downloaded as a CSV file.
- **Animated dashboard:** today's sales, open orders, orders due today, overdue orders, a 7-day sales chart, upcoming deadlines and recent payments.
  Animations are turned off for people who set "reduce motion" in their operating system.
- **Print invoice:** each order has a printable invoice (*Print invoice* button → your browser's print dialog, or *Save as PDF*).

Amounts are in Philippine pesos (₱). Times are shown in Asia/Manila time.

## Run it

Requires Node.js 20 or newer.

```bash
npm install
cp .env.example .env      # then edit SESSION_SECRET (see below)
npm run seed              # creates the Razel and Joshua accounts
npm start                 # http://127.0.0.1:3000
```

Generate a session secret and paste it into `.env`:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

For local testing over plain `http://` with `NODE_ENV=production`, set `COOKIE_SECURE=0`. If you don't, the browser won't keep the login cookie.

### Logins

| User   | Username | Temporary password |
|--------|----------|--------------------|
| Razel  | `razel`  | `TripleZ1!`        |
| Joshua | `joshua` | `TripleZ1!`        |

On first login each person must choose a new password. It needs 10+ characters with uppercase, lowercase, a number and a symbol.
It can't contain the username or be the temporary password.

If someone forgets their password or gets locked out, run this to reset both accounts to the temporary password. They then have to change it again.

```bash
npm run seed -- --reset
```

## Security

All of these are on by default:

- **Passwords** are hashed with Argon2id. Login errors are generic, and a missing username takes the same time to check as a wrong password.
- **Brute-force protection:** after 5 wrong passwords an account locks for 15 minutes. Failed logins are also limited per IP address (10 per 15 minutes), and all requests have a general rate limit.
- **Sessions** are stored in the server's database. The cookie is `HttpOnly` and `SameSite=Strict`, and `Secure` in production. A new session ID is issued at login and at password change.
  Sessions log out after 30 minutes idle (background alert checks don't count as activity) and after 8 hours in total.
  Changing a password signs out that user's other sessions.
- **Forced password change** before anything else can be used.
- **CSRF tokens** protect every form.
- **Security headers** via Helmet:
  - Strict Content-Security-Policy with no inline scripts or styles and `frame-ancestors 'none'`
  - HSTS, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`
  - Cross-origin isolation headers and a Permissions-Policy
  - The `X-Powered-By` header is turned off
- **Input validation** checks every field's type, length, allowed values, amounts and dates. All SQL queries are parameterized, and the search box escapes `%` and `_` wildcards.
- **Output escaping** in every template protects against XSS. CSV exports also neutralize spreadsheet formulas (`=`, `+`, `-`, `@`).
- **Request limits:** request body capped at 20 KB, server timeouts set, and visitors never see stack traces.
- **Logged-in pages** send `Cache-Control: no-store` and `noindex`.
- **Audit log** (`audit_log` table) records logins, failed logins, lockouts, password changes, order changes, status changes and payments.
- **Production safeguards:** the app refuses to start in production without a strong `SESSION_SECRET`. It listens on `127.0.0.1` by default.

### Deploying

Put the app behind an HTTPS reverse proxy (for example Caddy or nginx) and set:

```
NODE_ENV=production
SESSION_SECRET=<random 96-char hex>
TRUST_PROXY=1
HOST=127.0.0.1
```

All data is in one SQLite file (`DB_FILE`, default `data/triplez.db`). Back it up regularly, e.g. copy the file once a day.

## Tests

```bash
npm test
```

The tests cover:

- login, lockout, rate limiting, CSRF, the forced password change, cookie flags and security headers
- urgency rules, order validation, XSS escaping, payments and balance checks
- sales history, the CSV export and the invoice

## Project layout

```
src/server.js          start-up, env checks
src/app.js             Express app + security middleware
src/db.js, schema.sql  SQLite database
src/security/          passwords, sessions store, CSRF, login/session checks, rate limits
src/routes/            auth, dashboard, orders (incl. payments + invoice), sales, api/alerts
src/services/          order logic, urgency rules, sales reports
src/views/             EJS pages
public/                CSS and small browser scripts (dashboard animation, alerts, invoice print)
scripts/seed-users.js  creates/resets staff accounts
test/                  automated tests
```
