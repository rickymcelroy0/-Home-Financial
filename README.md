# Home Financial Center - Windowed Rewrite

This package rewrites the original dashboard into a fuller Firebase Realtime Database app where each tile opens into its own dedicated account window.

## Files

- `index_windowed_rewrite.html` - main login/dashboard app
- `script_windowed_rewrite.js` - main app logic
- `account_window.html` - popup account window UI
- `account_window.js` - popup account logic

## Firebase configuration used

The database URL you supplied has already been applied:

- `https://homefund-3b81a-default-rtdb.firebaseio.com/`

The code also infers these project fields from that URL:

- `projectId: homefund-3b81a`
- `authDomain: homefund-3b81a.firebaseapp.com`
- `storageBucket: homefund-3b81a.appspot.com`

## Important

Because you only supplied the database URL, this rewrite does **not** include values for:

- `apiKey`
- `appId`
- `messagingSenderId`

For Realtime Database-only usage this can still work depending on your Firebase setup and rules, but if your project requires the full web app config, paste the full Firebase Web SDK config into both JS files.

## Current features

- admin and client login flow
- default admin bootstrap (`admin / 0000`)
- session restore with localStorage
- create client
- record bill
- admin deposit to checking
- checking/staging transfers
- real-time dashboards
- account tiles open in separate windows
- admin aggregate windows
- client overview window
- live activity feeds from the `ledger` path

## Expected database paths

- `users/`
- `bills/`
- `ledger/`

## Deploy

If you want to use these as your live files, rename:

- `index_windowed_rewrite.html` -> `index.html`
- `script_windowed_rewrite.js` -> `script.js`
- keep `account_window.html` and `account_window.js` in the same folder

