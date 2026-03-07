# HFC Admin Backend

This folder is ready to put into a GitHub repository.

## What this backend is for

This is the private admin/database backend for your HFC system. It connects to Firebase Realtime Database with the Firebase Admin SDK so the browser does not need direct database admin access.

## What to commit to GitHub

Commit these files:

- `server.js`
- `package.json`
- `public/admin-db.html`
- `public/admin-db.js`
- `.env.example`
- `.gitignore`
- `README.md`

Do **not** commit:

- `.env`
- your Firebase service account JSON
- any real secrets or production PINs

## Local setup

1. Copy `.env.example` to `.env`
2. Fill in your real values
3. Install dependencies
4. Start the server

```bash
npm install
npm run dev
```

Then open:

```bash
http://localhost:3000/backend
```

## Environment variables

- `PORT` - backend port
- `BACKEND_ADMIN_PIN` - login PIN for the backend console
- `SESSION_SECRET` - session secret for cookies/sessions
- `FIREBASE_DATABASE_URL` - your Firebase RTDB URL
- `FIREBASE_SERVICE_ACCOUNT_BASE64` - base64 of the Firebase service account JSON

## GitHub workflow

Typical flow:

```bash
git init
git add .
git commit -m "Add HFC admin backend"
git branch -M main
git remote add origin YOUR_GITHUB_REPO_URL
git push -u origin main
```

## Important

This backend is the right place for:

- treasury actions
- admin-only balance adjustments
- user open/close/delete
- account number generation
- audit logging
- database-only tools

Your public frontend should eventually call this backend for privileged admin actions instead of writing those paths directly from the browser.
