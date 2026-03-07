# HFC Admin Backend

This is a GitHub-ready backend rewrite for your Home Financial Center project.

## What it includes

- `server.js` — Express backend using the Firebase Admin SDK
- `package.json` — Node dependencies and start scripts
- `.env.example` — environment template
- `.gitignore` — keeps secrets and dependencies out of GitHub
- `public/admin-db.html` — private backend admin console
- `public/admin-db.js` — browser logic for the private backend console

## What this backend does

- private admin PIN login with session cookie
- direct database inspection and path-level read/write/delete
- treasury transfers to any user checking or vault balance
- user create / open / close / delete
- automatic account number generation
- shared and private bill creation
- bill payment from vault funds
- ledger entries for backend actions

## Environment setup

1. Copy `.env.example` to `.env`
2. Fill in your values:

- `BACKEND_ADMIN_PIN`
- `SESSION_SECRET`
- `FIREBASE_DATABASE_URL`
- either `FIREBASE_SERVICE_ACCOUNT_BASE64` or `FIREBASE_SERVICE_ACCOUNT_FILE`

## Install and run

```bash
npm install
npm start
```

Then open:

```bash
http://localhost:3000/admin/admin-db.html
```

## GitHub upload

Upload the contents of this folder to your repo. Do not upload `.env` or your service account JSON.

## Recommended database paths

- `users/`
- `balances/`
- `bills/`
- `privateBills/`
- `ledger/`

## Notes

- This backend is the place for high-privilege admin actions.
- Your public browser app should gradually stop doing treasury-grade writes directly to Firebase.
- For production, turn on HTTPS and set `COOKIE_SECURE=true`.
