# Smart Order Link + Order Requests

## Flow
1. Seller copies the **Smart order link** (Dashboard or Orders page) and sends it to a customer.
2. Customer opens `pages/order-form/order.html?s=<sellerUid>` (no login), fills name, phone, address, products.
3. The form creates ONE document in `publicStores/{sellerUid}/orderRequests/{id}`.
   Nothing else changes: no order, no customer, no stock change, no analytics impact.
4. Seller sees it in **Orders -> Order requests** (also sidebar badge + dashboard).
5. **Approve & create order** runs one atomic transaction:
   free-plan limit (10/month) + Pro expiry check, stock check and reduction, customer created
   (or matched by phone), order + items created, notification, request deleted.
6. **Remove request** just deletes it.

## Data layout
| Path | Who can do what |
|------|-----------------|
| `publicStores/{uid}` | anyone: `get` one doc (no list). Owner: write. Holds only business name, product name/price/inStock, on/off switch. |
| `publicStores/{uid}/orderRequests/{id}` | anyone: **create only** (strictly validated). Owner: read/delete. Nobody: update. |
| `users/{uid}/**` | unchanged, owner only. Never exposed. |

Never exposed publicly: cost price, exact stock, SKU, customers, orders, revenue, other sellers.

## Deploy checklist
1. Firebase Console -> Firestore -> Rules: replace your rules with the full merged file
   `backend/firebase/firestore/firestore.rules (full, merged with the live rules)` inside your existing
   `match /databases/{database}/documents { ... }` (do not replace your other rules), then Publish.
2. Deploy the frontend as usual. Public link uses the page's own domain, so deploy to
   a real host (Firebase Hosting etc.), not `localhost`, before sharing links.
3. Open Dashboard once as the seller: this creates `publicStores/{uid}`.
4. Recommended: enable **Firebase App Check (reCAPTCHA v3)** for Firestore to block bots.
   Rules cannot rate-limit; the form already has a honeypot and a 30s client cooldown.

## Test checklist
- Free seller with 10 orders this month: approve fails with upgrade message, request stays.
- Two approvals of the same request (double click / two tabs): second fails, no duplicate order.
- Product stock lower than requested: approval blocked with a clear message.
- Existing phone number: order links to the existing customer, no duplicate customer.
- Pause the link switch: customer sees "Orders are paused" and rules reject direct writes.
- Logged-out browser: reading `users/{uid}/...` or listing `publicStores` is denied.
- Delivered request-orders appear in Analytics exactly like normal orders.
