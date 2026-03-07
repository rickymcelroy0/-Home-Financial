# Home Financial Center — Fixed Glass Rewrite

This package fully rewrites the uploaded HFC app and fixes the structural issues in the previous version.

## What was fixed

- unified the data model around top-level `balances/`
- removed broken placeholder logic
- fixed tile clicks so every tile opens its own dedicated account window
- added session restore
- added admin bootstrap (`admin / 0000`)
- added client creation
- added admin deposits
- added bill creation
- added client transfers between checking and staging
- added bill payment from staging
- added live ledger feeds in both the dashboard and popup windows
- rebuilt the UI with a stronger iPhone-style glass look

## Files

- `index_fixed_glass.html` — main dashboard UI
- `script_fixed_glass.js` — main dashboard logic
- `account_fixed_glass.html` — popup account window UI
- `account_fixed_glass.js` — popup account window logic

## Firebase paths used

- `users/`
- `balances/`
- `bills/`
- `ledger/`

## Firebase config currently included

```js
{
  databaseURL: 'https://homefund-3b81a-default-rtdb.firebaseio.com/',
  projectId: 'homefund-3b81a',
  authDomain: 'homefund-3b81a.firebaseapp.com',
  storageBucket: 'homefund-3b81a.appspot.com'
}
```

If your project also requires `apiKey`, `appId`, or `messagingSenderId`, add them to both JS files.

## Deploy

Rename these files for live use:

- `index_fixed_glass.html` → `index.html`
- `script_fixed_glass.js` → `script.js`
- `account_fixed_glass.html` → `account.html`
- `account_fixed_glass.js` → `account.js`
