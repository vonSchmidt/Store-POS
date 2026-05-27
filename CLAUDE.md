# Store-POS — Claude Context

## What this is
Electron desktop app (POS system). No build step for development — just `npm run electron`.

## Architecture

```
start.js          Electron main process — creates BrowserWindow, wires ipcMain handlers
server.js         Express server embedded in the Electron process (port 8001)
index.html        Single-page UI — all views are divs toggled with show/hide
renderer.js       Requires pos.js, product-filter.js, print-js — runs in Electron renderer
assets/js/pos.js  All UI logic (~2400 lines) — jQuery + $.fn plugin pattern
assets/js/product-filter.js  Search/filter for the product grid, payment change calc
api/
  inventory.js    CRUD + barcode lookup for products; handles image upload (multer)
  categories.js   CRUD for product categories
  transactions.js POS orders, hold orders, customer orders, date-filtered reports
  customers.js    Customer records
  users.js        User auth (base64 passwords — not secure, by design for simplicity)
  settings.js     Store settings (name, address, tax, logo, currency)
```

## Data layer
- **NeDB** (embedded NoSQL, file-based). DB files live in `%APPDATA%/POS/server/databases/`.
- Uploads go to `%APPDATA%/POS/uploads/`.
- `electron-store` (key/value) holds the logged-in session: `auth`, `user`, `settings` (local platform config).

## Key conventions
- `platform` = `electron-store` local settings (app mode, till number, mac address). Can be `undefined` before first save — always guard with `platform ?`.
- `settings` = server-side store settings fetched from `api/settings/get`. Also can be `undefined` briefly on load.
- `stock` field on products: `1` = track stock, `0` = stock check disabled (unlimited).
- `status` on transactions: `0` = on hold / unpaid, `1` = paid.
- Payment type stored as string `"Cash"` or `"Card"` — do not compare to numbers.

## Known design choices (not bugs)
- Passwords stored/transmitted as base64 — intentional simplicity, not a security product.
- `ipcRenderer.send('app-reload')` used for soft reloads (re-login, settings change).
- Till `1` is reserved for standalone mode. Network terminals must use till > 1.

## Bugs fixed (2026-05-26)
1. `index.html` — `<sapn>` typo → `<span>`
2. `index.html` — unclosed `<span>` in payment price addon
3. `inventory.js:decrementInventory` — now skips products with `stock !== 1`
4. `transactions.js PUT /new` — now calls `decrementInventory` when held order is paid
5. `pos.js` — removed duplicate `'This Month'` daterangepicker range key
6. `pos.js` barcode search — products with `stock == 0` no longer blocked by quantity check
7. `pos.js submitDueOrder` — `platform` guarded against undefined (pre-settings-save crash)
8. `pos.js` — `swal()` → `Swal.fire()` (wrong sweetalert API version)
9. `pos.js net_settings_form` — `isNumeric` → `$.isNumeric`
10. `pos.js loadTransactions` — payment_type column now uses stored string directly
11. `pos.js loadSoldProducts` — null-safe product lookup (deleted products no longer crash)
12. `pos.js viewTransaction` — payment_type switch now matches string `"Card"` not number `2`
