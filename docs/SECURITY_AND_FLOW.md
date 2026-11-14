# sellersPro: Business Flow, Permissions and Security (Lab Viva Guide)

Stack: HTML/CSS/JS frontend (Firebase Hosting) + Firebase Authentication + Cloud Firestore.
There is no custom server. **Firestore Security Rules are the server-side security layer.**
Payment is manual (bKash/Nagad transaction ID, verified by an Admin).

---------------------------------------------------------------------------------------------

## 1. Roles
| Role | How identified | Can do |
|------|----------------|--------|
| Visitor / Customer | not signed in | Open the public order form, send an order *request*. Nothing else. |
| Seller | Firebase Auth user with a **verified email** | Manage own products, customers, orders, analytics, subscription payment. |
| Admin | document `adminUsers/{uid}` with `active == true` and role admin/superadmin | Read all sellers' data, verify payments, set prices, change plan fields. |

## 2. Database map (Firestore)
```
adminUsers/{uid}                         who is an admin (read-only, own doc)
users/{uid}                              seller profile (plan, subscription, business info)
  products/{id}   customers/{id}   notifications/{id}
  orders/{id}  ->  items/{id}
  subscriptionRequests/{id}              copy of a payment request (seller creates, admin decides)
payments/{id}                            manual payment records
platformSettings/billing                 prices + free order limit (admin writes, signed-in read)
auditLogs/{id}                           admin read only
publicStores/{sellerUid}                 PUBLIC safe catalog (name, price, in-stock only)
  orderRequests/{id}                     customer requests (customers can only CREATE)
loginIndex/{01XXXXXXXXX}                 mobile number -> {uid, email} for mobile login + unique numbers
```

## 3. Full business flow (start to end)

### 3.1 Register and verify email
1. Seller enters name, business, **email, mobile**, password (min 8 chars).
2. App checks `loginIndex/{mobile}`: number must be unused.
3. Firebase Auth creates the account. App creates `users/{uid}` (rules force it to be a **Free** profile).
4. Firebase emails a **verification link**. The seller is signed out.
5. Opening the link sets `email_verified = true` and returns to `login.html?verified=1`.
   Registration is complete only now.

### 3.2 Login
- One field: **email or mobile number** + password (Google login also works).
- Mobile: app reads `loginIndex/{mobile}` to get the email, then signs in with email+password.
- Wrong mobile and wrong password give the **same message** (no user guessing).
- Unverified email: sign-in is refused, "Resend verification email" is offered (60 s cooldown).
- First verified login links the mobile number in `loginIndex` (first verified owner keeps it).
- Server side: every seller read/write needs `request.auth.token.email_verified == true`.

### 3.3 Seller daily work
- **Products**: name, SKU, cost, selling price, stock, low-stock threshold.
- **Customers**: name, phone, email, address.
- **Orders** (status): `Pending -> Processing -> Delivered`, or `Cancelled`.
  - Creating an order reduces stock in one **transaction** (all or nothing). Cancel restores stock.
  - Free plan: limit per month (default 10, set by Admin in `platformSettings/billing`).
  - Delivered sets `deliveredAt`.
- **Analytics**: revenue, delivered count, graph and best sellers are counted on the **delivery date**.
  Total/Pending/Processing/Cancelled are counted on the order (create) date.

### 3.4 Smart Order Link (customer self-order)
1. Seller shares `order.html?s=<sellerUid>`.
2. Customer sees only the public catalog `publicStores/{uid}` (name, price, in stock). No login.
3. Customer submits -> one document in `publicStores/{uid}/orderRequests`. Rules validate every field
   (types, lengths, max 10 lines, quantity 1-100, only while the link is switched on).
4. Seller opens **Orders -> Order requests**, reviews, then:
   - **Approve**: ONE transaction creates the order + items, reduces stock, counts monthly usage,
     adds the customer (or links the existing one by phone **or** email), notifies, deletes the request.
   - **Remove**: deletes the request.
5. A request never changes orders, stock, customers or analytics until approved.
   Price and stock always come from the seller's own product data, never from the customer.

### 3.5 Pro subscription (manual payment)
1. Seller pays by bKash/Nagad outside the app, then submits method, sender number, transaction ID.
2. App writes `payments/{id}` and `users/{uid}/subscriptionRequests/{id}` in one batch, status `pending`.
   Rules check: amount equals the Admin's published price, currency BDT, sizes, status pending.
3. Admin checks the transaction in the admin panel and approves/rejects.
   Approval writes subscription fields on `payments`, `subscriptionRequests` and `users/{uid}`
   (plan `Pro`, start, end, status `active`). **Only an Admin can do this.**
4. When the end date passes, the app downgrades the seller to `free`/`expired`.

### 3.6 Admin
Login -> checks `adminUsers/{uid}`. Pages: dashboard, sellers, seller details/export, payments,
subscriptions, pricing, audit logs. Admin has read access to sellers' data and may change only the
subscription fields of a profile.

---------------------------------------------------------------------------------------------

## 4. Permission matrix (what Firestore rules allow)
| Path | Visitor | Seller (verified, own data) | Admin |
|------|---------|-----------------------------|-------|
| `users/{uid}` | no | read; create (Free only); update business fields only | read; update subscription fields only |
| `users/{uid}/products,customers,orders,items,notifications` | no | full | read |
| `users/{uid}/subscriptionRequests` | no | read; create `pending` only | read; update decision fields |
| `payments` | no | create own pending (validated); read own | read; verify (approve/reject) |
| `platformSettings/billing` | no | read | read + write |
| `auditLogs` | no | no | read |
| `adminUsers/{uid}` | no | own doc get | own doc get |
| `publicStores/{uid}` | **get one** (no list) | write own | no |
| `publicStores/{uid}/orderRequests` | **create only** (validated) | read/delete own | no |
| `loginIndex/{phone}` | **get one** (no list) | create/update/delete own, only for own profile phone | no |
| anything else | denied | denied | denied |

## 5. Security audit: problems found and how they were fixed
| # | Severity | Problem | Fix | Where |
|---|----------|---------|-----|-------|
| 1 | **Critical** | A seller could edit their own `plan`, `subscriptionStatus`, `subscriptionEnd` (free Pro for ever) or create their profile as `Pro`. | Protected fields locked: seller can only downgrade to `free`/`expired`; subscription dates, role, block flags, uid are Admin-only; new profile must be Free; monthly counter cannot go down. | `firestore.rules` (`ownerProfileUpdateOk`, `validNewProfile`) |
| 2 | High | Wildcard `users/{uid}/{**}` let the seller write everything, including their own `subscriptionRequests.status` (fake "approved"). | Replaced by explicit rules per subcollection (least privilege). Seller can only create a `pending` request; only Admin updates it. Unknown subcollections are denied. | `firestore.rules` |
| 3 | High | Payment record had weak checks: any amount/currency/text length. Free text reached the admin screen. | Exact key list, amount must equal the Admin's price, currency `BDT`, size limits, `submittedAt == request.time`, decision fields must be null. | `firestore.rules` (`payments`) |
| 4 | High | Anyone could register with someone else's email and use the app without proving ownership. | Email verification link; rules require `email_verified` for all seller data; app also signs unverified users out. | `auth-service.js`, `login.js`, `register.js`, `verify-gate.js`, rules |
| 5 | High | Customers had no safe way to order (would need open rules). | Separate public area: customers can only read one safe catalog doc and create a validated request. `users/**` never exposed. | `publicStores` rules, `public-order.js` |
| 6 | Medium | Login errors could reveal whether an account exists. | Same message for wrong email/phone/password; same wording for password reset. | `login.js`, `auth-ui.js` |
| 7 | Medium | Mobile numbers were not unique. | `loginIndex` (first verified owner wins), checked at register and in settings. | `auth-service.js`, `settings.js`, rules |
| 8 | Medium | No browser security headers. | `firebase.json`: nosniff, frame deny, referrer policy, HSTS, permissions policy. | `firebase.json` |
| 9 | Low | Dead debug code probing a non-existent collection. | Removed. | `products.js` |
| 10 | Checked, OK | Stored XSS (seller text shown in admin panel). | All dynamic text is escaped (`escapeHTML`/`textContent`); payment text is also size-limited by rules. | admin/*.js, seller pages |
| 11 | Checked, OK | Secrets in repo. | Only the public Firebase web config exists (not a secret; protected by rules). No service-account keys. | `firebase-config.js` |

## 6. Defence in depth (layers)
1. **Authentication**: Firebase Auth, password min 8, verified email, Google login.
2. **Authorization**: Firestore rules (server side): ownership, role, verified email, field locks.
3. **Validation**: rules validate shape/size/type of public data; app validates again.
4. **Integrity**: transactions for stock, orders, monthly counter, approval (no double approve).
5. **Output safety**: escape every dynamic string before inserting into HTML.
6. **Transport/browser**: HTTPS (Hosting) + security headers.
7. **Privacy**: public catalog excludes cost price, exact stock, SKU, customers.

## 7. Known limits (be honest in viva) and production upgrades
| Limit | Why | Upgrade |
|-------|-----|---------|
| Free-plan order limit is checked in the browser. A technical seller could bypass it by calling Firestore directly. Rules stop faking Pro and lowering the counter, but cannot count orders. | No backend code. | Cloud Function creates orders and enforces the limit server-side. |
| `loginIndex` can be read by id: whoever knows a mobile number can learn its email. | Mobile+password login needs a lookup without a server. | Cloud Function that signs in by mobile and never exposes the email. |
| Mobile numbers are not OTP-verified. | Only email is verified. | Phone OTP at registration. |
| Public order form can be spammed (no rate limit in rules). Spam stays in the inbox; it cannot touch orders/stock. | Rules have no rate limiting. | Enable Firebase App Check (reCAPTCHA v3). |
| Payment is manual; the same transaction ID could be submitted twice. | Out of scope. | Admin checks IDs; later use a payment gateway with webhooks. |
| Admin audit log is read-only; nothing writes it from the app. | Clients may not write logs (good). | Cloud Function writes logs on admin actions. |
| Blocked sellers (`isBlocked`) are shown to Admin but not enforced by rules. | Needs an extra read per request. | Add `notBlocked()` check or disable the account in Auth. |
| No strict CSP header. | Pages load CDN scripts. | Add a CSP after listing all script/style sources. |

## 8. How to demonstrate security in the viva (Firebase Console -> Firestore -> Rules -> Playground)
1. Unauthenticated `get /users/ANY_UID` -> **Denied**.
2. Unauthenticated `list /publicStores` -> **Denied**; `get /publicStores/UID` -> Allowed.
3. Unauthenticated `create /publicStores/UID/orderRequests/x` with a valid body -> Allowed; with `quantity: 5000` or an extra field -> **Denied**.
4. Unauthenticated `get /publicStores/UID/orderRequests/x` -> **Denied**.
5. Signed in seller A (verified) `get /users/B/orders/1` -> **Denied**.
6. Seller A `update /users/A` setting `plan: "pro"` -> **Denied**; setting `businessName` -> Allowed.
7. Seller A `create payments/p1` with `amount: 1` -> **Denied**.
8. Signed in but `email_verified = false` -> every seller read/write **Denied**.
9. Admin `update /users/A` with `businessName` -> **Denied**; with `plan` -> Allowed.

## 9. Likely viva questions
- *Why Firestore rules and not only JavaScript checks?* Browser code can be edited by the user; rules run on Google's servers and cannot be bypassed.
- *How is one seller's data hidden from another?* Path contains the uid; rules compare `request.auth.uid` with the path uid.
- *How can customers order without an account?* Public area `publicStores` with create-only, validated requests; seller approves; customers never touch `users/**`.
- *What stops a customer sending a fake price?* Requests store only product id and quantity; price/stock come from the seller's own product on approval.
- *What stops a seller giving themselves Pro?* Protected fields in the rules; only Admin can set plan/subscription dates.
- *Why a transaction for approval?* Order, stock, customer and request deletion succeed or fail together; no double approval.
- *What is XSS and how is it prevented?* Injecting script through text fields; all dynamic text is escaped or set with `textContent`.
- *What is the weakest point?* Server-side order limit and mobile lookup (Section 7), solvable with Cloud Functions.

## 10. Deployment checklist
1. Firebase Console -> Authentication: enable Email/Password (and Google); add your hosting domain to Authorized domains.
2. Firestore -> Rules: paste `backend/firebase/firestore/firestore.rules` and Publish.
3. Create admin: add `adminUsers/{adminUid}` = `{ active: true, role: "superadmin" }` in the console.
4. Create `platformSettings/billing` = `{ monthlyPrice, yearlyPrice, freeOrderLimit, currency: "BDT" }` (Admin -> Pricing page does this).
5. Deploy hosting: `firebase deploy` (uses `firebase.json`).
6. Optional: App Check, Email template edit.
7. Existing sellers: must verify their email once (login page offers a resend). Old phone-OTP-only accounts must be re-created.
