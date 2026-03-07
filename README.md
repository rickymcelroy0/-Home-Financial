# Home Financial Center

This version keeps the exact filenames:

- `index.html`
- `script.js`
- `account.html`
- `account.js`

## What was added

- stronger glass / iPhone-style visual treatment
- more hover, rise, shimmer, and ambient background animation
- admin treasury reserve that can fund any user checking or bill-vault balance
- system-generated account numbers for clients
- user bill vault for money set aside to pay bills
- user private bill planner under `privateBills/{userId}`
- automatic totals for shared bills, private bills, and bill-vault coverage
- paying shared bills from the bill vault
- paying private bills from the bill vault
- account windows for:
  - checking
  - bill vault
  - shared bills
  - private bills
  - admin treasury
  - admin totals
  - client overview

## Database paths

- `users/`
- `balances/`
- `bills/` for shared bills visible to treasury
- `privateBills/{userId}/` for user planner bills
- `ledger/`
- `system/treasury/reserve`

## Important note about privacy

Private bills are separated in the app and not shown in admin windows, but this is still a client-side Firebase app. Real privacy requires Firebase Database Rules or server-side enforcement.

## Current admin login

- username: `admin`
- pin: `0000`
