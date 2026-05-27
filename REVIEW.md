# Store-POS Code Review

**Reviewed:** 2026-05-27  
**Files reviewed:** api/inventory.js, api/categories.js, api/transactions.js, api/users.js, api/settings.js, assets/js/pos.js, assets/js/product-filter.js, start.js, server.js

---

## HIGH severity

---

### H-01: Inventory double-decrement on hold-order payment

**File:** `api/transactions.js:117-133`

`PUT /new` is used to pay off a held order. The route calls `decrementInventory` whenever `paid >= total`, but it does not check whether stock was **already decremented** when the hold was first saved. If the original `POST /new` was submitted with a `paid` amount equal to or greater than `total` (i.e. it was paid immediately and later re-PUT), stock is decremented twice for the same sale.

The root issue is that the `status` field — which distinguishes a held (`0`) from a paid (`1`) order — is present in the body but never consulted before decrementing.

**Fix:** Only decrement when the **incoming** `status` is `1` and the **stored** record's `status` is `0` (i.e. the order is transitioning from held to paid):

```js
app.put("/new", function(req, res) {
  let orderId = req.body._id;
  transactionsDB.findOne({ _id: orderId }, function(err, existing) {
    transactionsDB.update({ _id: orderId }, req.body, {}, function(err, numReplaced) {
      if (err) return res.status(500).send(err);
      res.sendStatus(200);
      // Only decrement if transitioning held -> paid
      if (existing && existing.status === 0 && req.body.paid >= req.body.total) {
        Inventory.decrementInventory(req.body.items);
      }
    });
  });
});
```

---

### H-02: `paid >= total` string comparison causes wrong branch on held orders

**File:** `api/transactions.js:107,129`

`newTransaction.paid` is an empty string `""` for held orders (status 0). The comparison `"" >= newTransaction.total` evaluates to `true` in JavaScript when `total` is `0`, and is unreliable for all numeric values because both operands arrive as strings from JSON. When `paid` is `"100"` and `total` is `"20"`, the **string** comparison `"100" >= "20"` is `false` (lexicographic), so stock is **not decremented** for valid sales where the paid amount starts with a lower digit.

**Fix:** Cast both to numbers before comparing:

```js
if (parseFloat(newTransaction.paid) >= parseFloat(newTransaction.total)) {
    Inventory.decrementInventory(newTransaction.items);
}
```

Apply the same fix on line 129.

---

### H-03: `GET /by-date` hangs / sends no response when both filters are non-zero simultaneously with user-only or till-only

**File:** `api/transactions.js:55-96`

The four `if` branches are all independent — they are not `else if`. When `user != 0` and `till != 0`, **all four branches execute**: the first two fire their own DB queries and call `res.send()` before the fourth does, so the response is sent multiple times (Express will throw `"Cannot set headers after they are sent"`). If the first `res.send()` wins, the fourth branch's result is silently dropped. If the request never satisfies exactly one branch (edge case: `user` and `till` are both `0` after `parseInt` coercion of unexpected input), the route never sends a response at all, hanging the client.

**Fix:** Convert to `else if` chains, or use a single query built conditionally:

```js
app.get("/by-date", function(req, res) {
  let startDate = new Date(req.query.start);
  let endDate   = new Date(req.query.end);
  let filter = {
    date:   { $gte: startDate.toJSON(), $lte: endDate.toJSON() },
    status: parseInt(req.query.status)
  };
  if (req.query.user != 0) filter.user_id = parseInt(req.query.user);
  if (req.query.till != 0) filter.till    = parseInt(req.query.till);

  transactionsDB.find({ $and: Object.entries(filter).map(([k,v]) => ({[k]:v})) },
    function(err, docs) {
      if (err) return res.status(500).send(err);
      res.send(docs || []);
    });
});
```

---

### H-04: `GET /on-hold` and `GET /customer-orders` swallow DB errors and hang

**File:** `api/transactions.js:33-51`

Both routes guard with `if (docs)` but never handle the `err` case. If NeDB returns an error, `err` is non-null and `docs` is `null` — the condition is false, `res` is never called, and the client hangs indefinitely.

```js
// current:
function(err, docs) {
  if (docs) res.send(docs);
}

// fix:
function(err, docs) {
  if (err) return res.status(500).send(err);
  res.send(docs || []);
}
```

Same pattern exists in `GET /:transactionId` (line 150-153).

---

### H-05: Route ordering conflict — `POST /product/sku` is shadowed by `POST /product`

**File:** `api/inventory.js:64,139`

Express registers `POST /product` (with `upload.single` middleware) at line 64, **before** `POST /product/sku` at line 139. Express matches `/product/sku` literally only after failing the `/product` pattern. However, because `upload.single` is registered as middleware for the `/product` route and not as a sub-router, Express will actually **not** shadow it — but this is fragile and order-dependent. More critically: `POST /product/sku` sends `skuCode` in a JSON body, but `POST /product` uses `multer` which does not parse JSON. If a future refactor moves the routes or middleware is applied globally, this breaks. The real bug here is that `POST /product` has no guard ensuring the path is exactly `/product` and not `/product/sku`, relying entirely on the router's internal matching. Audit and add explicit path matching or restructure to `/products/lookup`.

---

### H-06: `platform` is accessed without null-guard in two click handlers

**File:** `assets/js/pos.js:1810, 1823`

```js
$('#add-user').click(function () {
    if (platform.app != 'Network Point of Sale Terminal') {  // line 1810 — crashes if platform undefined
```

```js
$('#settings').click(function () {
    if (platform.app == 'Network Point of Sale Terminal') {  // line 1823 — same
```

On a fresh install, `platform` is `undefined` until the user saves settings. Clicking either button before that point throws `TypeError: Cannot read properties of undefined (reading 'app')` and crashes the renderer. The CLAUDE.md notes this guard was added for `submitDueOrder` but these two handlers were missed.

**Fix:**
```js
if (platform && platform.app != 'Network Point of Sale Terminal') { ... }
if (platform && platform.app == 'Network Point of Sale Terminal') { ... }
```

---

### H-07: New customer option value breaks JSON.parse on checkout

**File:** `assets/js/pos.js:1077,1080`

After adding a customer via the "New Customer" form, the `<option>` value is set to:
```js
`{"id": ${custData._id}, "name": ${custData.name}}`
```

`custData.name` is an unquoted string, so if the name is "John Smith" the value becomes `{"id": 123, "name": John Smith}` — invalid JSON. Line 648 does `JSON.parse($("#customer").val())`, which throws a `SyntaxError` at checkout, preventing any sale from being completed for that customer.

The `loadCustomers()` function (line 271) correctly quotes the name with `"${cust.name}"`, but the inline add does not.

**Fix:**
```js
value: `{"id": ${custData._id}, "name": "${custData.name}"}`, 
// and
$('#customer').val(`{"id": ${custData._id}, "name": "${custData.name}"}`).trigger('chosen:updated');
```

---

### H-08: `viewTransaction` uses `.customer.username` instead of `.customer.name`

**File:** `assets/js/pos.js:2250`

```js
let customer = allTransactions[index].customer == 0 ? 'Walk in Customer' : allTransactions[index].customer.username;
```

Customer objects stored in transactions have a `.name` field (set from the `<option>` JSON), not `.username`. This causes the customer line in reprinted receipts to always show `undefined`. The receipt template 17 lines later (line 2318) correctly uses `.customer.name` — so the local `customer` variable (which is never actually rendered in the template) is wrong, but since it isn't used in the HTML template it only causes silent confusion rather than a visible crash. However, if that variable is ever used in a future code path it will silently show `undefined`.

**Fix:** Change line 2250 to `.customer.name`.

---

### H-09: CSV header line is parsed with a naive `split(',')` — breaks if any header is quoted

**File:** `assets/js/pos.js:1936`

```js
var headers = lines[0].split(',').map(function (h) { return h.trim().toLowerCase(); });
```

The data rows are correctly parsed with `_parseCsvLine()`, which handles quoted fields, but the header line uses a plain `split(',')`. If a CSV editor adds quotes around a header (e.g. `"category","name",...`), the resulting header key is `"category"` (with literal quote chars), which never matches `obj["category"]`, so every imported product silently gets `catId = 0` and an empty name — filtered out by the `.filter(r => r.name)` check. The entire import silently succeeds with 0 products.

**Fix:**
```js
var headers = _parseCsvLine(lines[0]).map(function (h) { return h.trim().toLowerCase(); });
```

---

## MEDIUM severity

---

### M-01: Cart quantity input stored as string — corrupts total calculation

**File:** `assets/js/pos.js:562-566`

```js
$.fn.qtInput = function (i) {
    item = cart[i];
    item.quantity = $(this).val();   // string, not number
    $(this).renderTable(cart);
}
```

`$(this).val()` returns a string. `calculateCart` does `data.quantity * data.price` — JavaScript will coerce the string to a number for multiplication, but if the user enters `""` or a non-numeric value, `total` becomes `NaN`, propagating silently through all price displays and the saved transaction's `total` field. The stock-check in `qtIncrement` also does `item.quantity < product[0].quantity`, which becomes a string-vs-number comparison with unreliable results.

**Fix:**
```js
item.quantity = parseInt($(this).val(), 10) || 1;
```

---

### M-02: `loadTransactions` DataTable re-initialisation when result is empty

**File:** `assets/js/pos.js:2058-2166`

When `transactions.length === 0`, the function shows a Swal alert but does **not** call `$('#transactionList').DataTable().destroy()` before returning. The next time `loadTransactions()` is called (e.g., changing the date range produces results), `$('#transactionList').DataTable()` is initialised on an already-initialised table, throwing a DataTables warning and potentially rendering duplicate controls. The non-empty path correctly calls `.destroy()` at the top.

**Fix:** Call `$('#transactionList').DataTable().destroy()` at the start of `loadTransactions()` unconditionally, before the `$.get`.

---

### M-03: `userFilter` crashes when a transaction references a deleted user

**File:** `assets/js/pos.js:2228`

```js
$('#users').append(`<option value="${user}">${u[0].fullname}</option>`);
```

`u` is the result of `allUsers.filter(...)`. If the user who made the transaction has been deleted, `u` is an empty array and `u[0]` throws `TypeError: Cannot read properties of undefined`. This crashes `loadTransactions()` for any date range containing transactions by deleted users.

**Fix:**
```js
$('#users').append(`<option value="${user}">${u.length > 0 ? u[0].fullname : '(deleted user ' + user + ')'}</option>`);
```

---

### M-04: `payment` variable in `viewTransaction` is module-scoped and not reset

**File:** `assets/js/pos.js:2275`

Inside `viewTransaction`, the variable `payment` is assigned without a `let`/`const`/`var` declaration. It therefore writes to the global `payment` variable — or, depending on strict mode, creates an implicit global. More concretely, if the transaction has `paid == ""` (a held order), the `payment` assignment is skipped entirely, but `${payment == 0 ? '' : payment}` on line 2356 then uses the value set by the **previous** call to `viewTransaction` or `submitDueOrder`, showing stale payment information from a different transaction.

**Fix:** Declare `let payment = ''` at the top of the `viewTransaction` function.

---

### M-05: `calculateCart` discount allows negative totals

**File:** `assets/js/pos.js:441-448`

```js
total = total - $("#inputDiscount").val();
```

`total` is a number but `$("#inputDiscount").val()` is a string — the subtraction coerces the string, so it works numerically, but there is no upper bound enforced here. A cashier can type a discount larger than the cart total, producing a negative `total`. The subsequent check `if ($("#inputDiscount").val() >= total)` compares a **string** against a number (unreliable coercion) and resets discount to 0, but `total` has already been set to a negative value and displayed.

**Fix:** Parse both sides and clamp the discount:
```js
let discount = Math.min(parseFloat($("#inputDiscount").val()) || 0, total);
total = total - discount;
```

---

### M-06: CSV import header-detection uses split(',') for the entire header parse — same as H-09 but also affects column ordering

**File:** `assets/js/pos.js:1936`  
(Tracked as part of H-09 fix, but separately: even after fixing H-09, if the CSV has Windows line endings `\r\n`, the `trim()` on each line handles `\r` — this is fine. However the `lines[0].split(',')` and the body's `_parseCsvLine` behave differently on BOM-prefixed UTF-8 files common from Excel. The BOM `﻿` would prepend to `"category"` making the first column key `"﻿category"`, silently making all category imports fail.)

**Fix:** Strip BOM before processing:
```js
var text = content.replace(/^﻿/, '');
```

---

### M-07: `loadProductList` and `loadUserList` counters are broken when list is empty

**File:** `assets/js/pos.js:1500-1548, 1444-1497`

Both functions render the DataTable inside the `forEach` callback, gated by `if (counter == allProducts.length)`. When `allProducts` is empty (`length == 0`), the `forEach` never runs, `#product_list` is never populated, and the DataTable is never re-initialised — leaving the table in a stale destroyed state from the `.destroy()` call at the top. The UI silently shows the previous data.

**Fix:** After the `forEach`, check if the list is empty and clear the table explicitly:
```js
if (products.length === 0) {
    $('#product_list').empty();
    // optionally re-init DataTable with empty data
}
```

---

### M-08: `settings.img` receipt condition is inverted — shows nothing when there is a logo

**File:** `assets/js/pos.js:728, 2306`

```js
${settings.img == "" ? settings.img : '<img ... src ="' + img_path + settings.img + '" />'}
```

When `settings.img` is `""` (no logo), the ternary outputs `settings.img` (also `""`), rendering nothing — correct. When `settings.img` has a value, it renders the `<img>` tag — correct. So the logic happens to work, but it is clearly a copy-paste artefact: the truthy branch should be the empty string case and the falsy branch the image case. Reading the code as written, "if image is empty, display the empty string; otherwise display the img tag" is backwards from normal convention and will confuse anyone maintaining it, and if someone swaps the branches "to fix it" they'll invert the behaviour. This is also duplicated identically on line 2306.

**Fix:**
```js
${settings.img ? '<img style="max-width: 100px;" src="' + img_path + settings.img + '"/><br>' : ''}
```

---

### M-09: `#account` login form has no rate-limiting or lockout; no error feedback on network failure

**File:** `assets/js/pos.js:2451-2453`

The login AJAX error handler only does `console.log(data)` — if the local Express server hasn't started yet (race condition on first launch), the user sees a blank screen with no feedback. The authenticate form is appended inside `#loading` but there's no timeout or retry message.

**Fix:** Show a user-facing error in the error callback:
```js
error: function (data) {
    Swal.fire('Connection Error', 'Could not reach the server. Please restart the application.', 'error');
}
```

---

### M-10: `_downloadCsv` revokes the object URL synchronously before the browser has navigated

**File:** `assets/js/pos.js:2026-2032`

```js
a.href = url; a.download = filename; a.click();
URL.revokeObjectURL(url);
```

`a.click()` triggers the download asynchronously. Revoking the URL on the very next line may revoke it before the browser has fetched it, resulting in a failed or empty download on some Chromium versions (the one embedded in Electron). The fix is to revoke after a short delay or in the `load` event:

```js
a.click();
setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
```

---

## LOW severity

---

### L-01: `printJobComplete` function defined but never called

**File:** `assets/js/pos.js:629-631`

```js
function printJobComplete() {
    alert("print job complete");
}
```

Dead code. `alert()` is also inappropriate for an Electron app (blocks the renderer process). Remove or replace with a Swal notification.

---

### L-02: `console.log(formData)` left in production user-save handler

**File:** `assets/js/pos.js:1709`

Logs the entire user form including the plaintext password field to the DevTools console. Should be removed before shipping.

---

### L-03: `server.js` sets `Access-Control-Allow-Origin: *`

**File:** `server.js:15`

The CORS wildcard is intentional for a local app, but combined with the fact that the server binds to `0.0.0.0` (Express default), any process on the local machine (or on the LAN if the machine has a LAN IP) can reach the API with no authentication. This is noted as acceptable design, but the server should explicitly bind to `127.0.0.1` to prevent LAN-reachable access in standalone mode:

```js
server.listen(PORT, '127.0.0.1', () => console.log(`Listening on PORT ${PORT}`));
```

---

### L-04: `fileUpload` (express-fileupload) imported but unused in both `inventory.js` and `settings.js`

**File:** `api/inventory.js:6`, `api/settings.js:6`

`const fileUpload = require('express-fileupload');` is declared in both files but the middleware is never registered (`app.use(fileUpload())` is absent). The actual upload handling uses `multer`. Dead import.

---

### L-05: Category PUT sends form-serialized data but API expects JSON body

**File:** `assets/js/pos.js:1207-1209`

```js
$.ajax({
    type: method,   // PUT
    url: api + 'categories/category',
    data: $(this).serialize(),   // URL-encoded, not JSON
```

`api/categories.js` PUT handler reads `req.body.id` which is parsed by `bodyParser.json()`. Sending `application/x-www-form-urlencoded` from the form will populate `req.body` correctly only because `server.js` also registers `bodyParser.urlencoded`. This works today but is inconsistent — the POST half of the same form uses the same approach, while all other API calls use `JSON.stringify`. Document or standardise.

---

### L-06: `#account` login form rendered by string concatenation — `authenticate()` called multiple times would append duplicate forms

**File:** `assets/js/pos.js:2407-2413`

`authenticate()` uses `$('#loading').append(...)`, not `.html(...)`. If for any reason it is called twice (e.g., a future code path), the login form is duplicated. Use `.html()` or guard with an existence check.

---

### L-07: `inventory.js:decrementInventory` swallows NeDB errors silently

**File:** `api/inventory.js:155-183`

The `async.eachSeries` callback is called with the NeDB callback directly (`callback`). If NeDB passes an error to the callback, `async` will abort the series, but the error is never logged or surfaced. Stock decrements that fail silently leave the database in a partially decremented state with no indication of which products were not updated.

**Fix:** Log errors in the callback:
```js
inventoryDB.update(..., function(err) {
    if (err) console.error('Stock decrement failed for product', product._id, err);
    callback(err);  // propagate so async.eachSeries aborts correctly
});
```

---

### L-08: `loadTransactions` renders raw `trans.total` and `trans.paid` without formatting

**File:** `assets/js/pos.js:2092-2094`

```js
<td>${settings.symbol + trans.total}</td>
<td>${trans.paid == "" ? "" : settings.symbol + trans.paid}</td>
```

`trans.total` and `trans.paid` are stored as strings (from `toFixed(2)` on the client). String concatenation with `settings.symbol` works, but if any old transaction has a raw float total (e.g. `1.2` instead of `"1.20"`), the display is inconsistent. Use `parseFloat(trans.total).toFixed(2)` for consistency.

---

### L-09: `by_status` query parameter is never URL-encoded

**File:** `assets/js/pos.js:2055`

```js
let query = `by-date?start=${start_date}&end=${end_date}&user=${by_user}&status=${by_status}&till=${by_till}`;
```

`start_date` and `end_date` are ISO date strings containing colons (`:`) and `+` signs. While NeDB parses them back correctly most of the time, the `+` in a URL query string is interpreted as a space by some parsers. Use `encodeURIComponent`:

```js
let query = `by-date?start=${encodeURIComponent(start_date)}&end=${encodeURIComponent(end_date)}&user=${by_user}&status=${by_status}&till=${by_till}`;
```

---

_Reviewed: 2026-05-27_  
_Reviewer: Claude (adversarial code review)_
