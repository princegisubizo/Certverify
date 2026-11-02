# Certificate Verification System

Upload existing certificate PDFs, register their details, and automatically create a printable copy with a unique verification QR code embedded. Scanning the printed code opens the live official record.

```
server/   Node + Express + MongoDB (Mongoose) API, PDF storage, QR generation
client/   React + Vite single-page app (public verification pages + admin dashboard)
```

## How it works

1. An admin uploads a PDF plus details (name, course, institution, issue date…).
2. The server validates and parses the PDF, computes its SHA-256, and preserves the exact original upload in private storage.
3. The certificate gets a permanent ID (your own number if supplied and unique, otherwise `CERT-YYYY-XXXXXXXX`, random) and a separate 256-bit random public verification token.
4. The server renders the configured PDF page to locate a clear square in the selected corner, then embeds a QR code for `PUBLIC_APP_URL/verify/<token>` in that space. The placement follows the actual page artwork and keeps clear of text, borders, and other printed content. The QR is reduced from the configured maximum size only as needed and is at least 18 mm; registration fails with a clear error if there is no safe area. The untouched original and QR-embedded printable PDF are stored separately.
5. Scanning opens `/verify/<token>`. The page checks the live record and shows **Verified**, **Revoked**, **Not Found**, or **Unavailable**. The public PDF route streams the printable PDF through the API; the unmodified original is available only through the authenticated admin interface.

On an administrator's certificate detail page, **Preview printable PDF** and **Download printable PDF** open the QR-embedded copy. **Regenerate printable PDF** reprocesses the preserved original with the same verification URL and certificate record; it does not create a duplicate or replace the original upload.

## Quick start (development)

Requirements: Node 20.16+ (or 22.3+), a MongoDB (Atlas free tier or local).

```bash
# 1. API
cd server
cp .env.example .env            # set MONGO_URI and JWT_SECRET (openssl rand -hex 48)
npm install
ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='a-long-passphrase' ADMIN_NAME='Your Name' npm run seed-admin
npm run dev                     # http://localhost:4000

# 2. Front end (second terminal)
cd client
npm install
npm run dev                     # http://localhost:5173  (proxies /api to :4000)
```

Open http://localhost:5173/admin/login. There is **no public registration**; admins exist only via `npm run seed-admin` (re-run it to reset a password).

### Windows PowerShell

If PowerShell reports that `npm.ps1` cannot be loaded because script execution is disabled, use `npm.cmd` instead. This runs npm without changing your system execution policy.

In the API terminal:

```powershell
cd server
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
npm.cmd install
# Set MONGO_URI and JWT_SECRET in .env before starting the API.
$env:ADMIN_EMAIL = "you@example.com"
$env:ADMIN_PASSWORD = "a-long-passphrase"
$env:ADMIN_NAME = "Your Name"
npm.cmd run seed-admin
npm.cmd run dev
```

In a second terminal:

```powershell
cd client
npm.cmd install
npm.cmd run dev
```

Open http://localhost:5173/admin/login and sign in with the email and password used when seeding the admin.

If login reports that the API is unavailable, keep the server running in its own terminal (`cd server` then `npm run dev`, or `npm.cmd run dev` in PowerShell) and confirm `http://127.0.0.1:4000/api/health` returns `{"ok":true}`. The Vite development proxy targets `127.0.0.1:4000` by default; override it with `VITE_DEV_API` if your API runs elsewhere. Leave `VITE_API_BASE_URL` empty for local development so requests use that proxy.

In development, PDFs are stored in `server/storage/` (`STORAGE_DRIVER=local`).

## Environment variables (server/.env)

| Variable | Purpose |
|---|---|
| `MONGO_URI` | MongoDB Atlas connection string (required) |
| `JWT_SECRET` | ≥32 random chars (required) |
| `PUBLIC_APP_URL` | Base of the permanent QR/verification URLs. **Production must be `https://` and not localhost** – the server refuses to start otherwise |
| `CLIENT_URL` | Origin of the React app (CORS + iframe allow-list) |
| `API_BASE_URL` | Only if the API is on a different domain than the app |
| `SERVE_CLIENT` | `true` = the API serves `client/dist` (one domain, recommended) |
| `MAX_UPLOAD_MB` | Upload size limit (default 10) |
| `ALLOW_PUBLIC_DOWNLOAD` | Show/allow "Download PDF" publicly (default true) |
| `ALLOW_PUBLIC_PDF_WHEN_REVOKED` | Keep the PDF viewable (reference only) after revocation |
| `QR_ERROR_CORRECTION` | `L`/`M`/`Q`/`H` (default `Q`) |
| `PDF_QR_PAGE` | One-based page for QR placement (default `1`) |
| `PDF_QR_SIZE_MM` | Maximum QR image side length in millimetres; actual size adapts to the clear area (default `28`, minimum `18`) |
| `PDF_QR_MARGIN_MM` | Minimum distance from the page edge in millimetres (default `10`); the QR also has a clear outer margin |
| `PDF_QR_CORNER` | Corner area to search: `bottom-right` by default, or `bottom-left`, `top-right`, `top-left` |
| `STORAGE_DRIVER` | `local` or `s3` |
| `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | S3-compatible storage (AWS S3, Cloudflare R2, Backblaze B2, MinIO) |
| `TRUST_PROXY` | Number of reverse proxies in front of the API (defaults to 1 in production) |

The server uses `pdfjs-dist` and `@napi-rs/canvas` to inspect rendered page content before placement. Client (`client/.env`, build-time): `VITE_API_BASE_URL` (blank for same-origin), `VITE_INSTITUTION_NAME`.

The database is schemaless MongoDB with Mongoose-managed optional fields; no migration is required. Existing records keep working through their legacy certificate-ID verification URLs, and new registrations save the original/final PDF metadata and verification token.

## Deployment (recommended: one domain)

Serving the API and the built app from one domain keeps QR URLs, cookies and PDF embedding simple.

1. **MongoDB Atlas**: create a cluster, a database user with `readWrite` on the app database only, and restrict network access to your host's egress IPs. Turn on continuous/cloud backups.
2. **PDF storage**: create a **private** S3-compatible bucket (block all public access, enable encryption and versioning). Create an access key limited to that bucket (`s3:PutObject`, `s3:GetObject`, `s3:DeleteObject`). PDFs are only ever served through the API, so the bucket never needs to be public.
3. **Build the front end**: `cd client && npm ci && npm run build` (creates `client/dist`).
4. **Run the API** on a host with Node 20+ (Render, Railway, Fly.io, a VPS…): `cd server && npm ci --omit=dev && NODE_ENV=production npm start`. Set the variables above. `PUBLIC_APP_URL` must be explicitly set to the permanent HTTPS front-end origin; production startup rejects missing, localhost, loopback, and private-IP URLs. Example:
   ```
   NODE_ENV=production
   PUBLIC_APP_URL=https://certificates.your-domain.com
   CLIENT_URL=https://certificates.your-domain.com
   STORAGE_DRIVER=s3
   ```
5. **Domain + HTTPS**: point `certificates.your-domain.com` at the host and terminate TLS (platform-managed certificate or Caddy/nginx). The server serves `index.html` for any non-API URL, so refreshing `/verify/CERT-…` works.
6. Create the first admin with `npm run seed-admin` against the production database.

**Separate front-end/API domains** (e.g. Vercel + Render): set `SERVE_CLIENT=false`, `VITE_API_BASE_URL=https://api…` at build time, `CLIENT_URL`/`PUBLIC_APP_URL` to the front-end origin, `API_BASE_URL` to the API origin, and configure an SPA rewrite to `/index.html` on the front-end host. Cookie auth across sites needs `COOKIE_SAMESITE=none` (and HTTPS); same-site subdomains work with the default.

**Backups**: Atlas backups for MongoDB; bucket versioning and cross-region replication (or scheduled `rclone sync`) for PDFs. Test a restore. If you use `STORAGE_DRIVER=local`, the directory must be on a persistent volume that is backed up.

## Security notes

- bcrypt (cost 12) password hashes; login rate limit (10/15 min) and per-account lockout; generic error on bad credentials.
- JWT in an `HttpOnly`, `Secure` (production), `SameSite=Lax` cookie; Origin check on state-changing requests.
- Every admin route sits behind `requireAdmin`; public routes expose only name, number, course, institution, dates, status. No public listing/search, no public write endpoints.
- New QR URLs use independent 256-bit verification tokens. Legacy records without tokens continue to verify by their existing certificate IDs.
- Uploads: size cap, `.pdf` name **and** real-content check, random server-generated storage keys (no path traversal), always served as `application/pdf` with `nosniff`.
- Existing cryptographic PDF signatures cannot remain valid after PDF modification, so signed PDFs with a `/ByteRange` signature are rejected. Add the QR before applying the digital signature; visually printed/scanned signature artwork is retained.
- Zod validation on all inputs; consistent `{ "error": { code, message, details } }` responses without stack traces.
- Audit log for create, edit, revoke/restore, PDF replacement, archive, login.
- Records are **archived**, not hard-deleted (the PDF is retained); archived IDs show "Not Found".

## Tests

```bash
cd server && npm test        # unit tests + API integration tests
cd client && npm test        # verification-page behaviour tests
```

- `server/tests/units.test.js` needs no database: PDF content validation, QR image decoding, PDF embedding and page placement, different page sizes/orientations, multi-page preservation, path-traversal protection, and ID generation.
- `server/tests/api.test.js` covers login, authorization, registration, QR-to-verification association, final-PDF delivery, unchanged administrator-only original downloads, replacement, revocation, not-found, and existing management APIs. It starts an in-memory MongoDB (downloads a `mongod` binary on first run, so it needs internet access). To use an existing disposable database instead: `TEST_MONGO_URI=mongodb://localhost:27017/certtest npm test` (**this test wipes the admin and certificate collections**).
- `client/src/pages/Verify.test.jsx` proves the public page shows Verified only for an explicit `valid` response, and shows "Verification Unavailable" for network errors, 5xx, HTML error pages, malformed bodies and unknown statuses.

### Manual checks that can't be automated (do these before launch)

1. Register a certificate with a real PDF and download the generated **printable PDF** from the success screen.
2. Confirm the original remains available in the admin record and differs from the printable copy.
3. Print the printable PDF and scan its embedded QR with an iPhone **and** an Android phone on mobile data.
4. Confirm the right record appears and its status is checked live.
5. Revoke it, rescan, and confirm "Certificate Revoked" appears; restore it.
6. Open the public verification URL shown after registration directly and refresh on the deployed site.
7. Check `https://…/verify/CERT-DOES-NOT-EXIST` shows "Certificate Not Found".

The QR position is configurable, but the system cannot infer which areas contain important certificate artwork. Check the printed layout before issuance; if the default bottom-right area overlaps content, select another `PDF_QR_CORNER` or adjust `PDF_QR_PAGE`, size, or margins before registering certificates.

## API summary

Auth: `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`
Admin: `POST /api/certificates`, `GET /api/certificates`, `GET /api/certificates/stats`, `GET|PATCH|DELETE /api/certificates/:id`, `PATCH /api/certificates/:id/status`, `POST /api/certificates/:id/pdf` (replace), `GET /api/certificates/:id/qr?format=png|svg`, `GET /api/certificates/:id/pdf` (printable), `GET /api/certificates/:id/original-pdf` (preserved source), `GET /api/certificates/:id/audit`
Public: `GET /api/verify/:token-or-legacy-id`, `GET /api/verify/:token-or-legacy-id/pdf[?download=1]` (printable PDF; the original upload is not public)
