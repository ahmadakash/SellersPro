# Auth: email verification + email/mobile login

## Register
1. Seller enters name, business, **email**, **mobile**, password.
2. Mobile number is checked against `loginIndex/{01XXXXXXXXX}` (must not be used).
3. Firebase account + `users/{uid}` profile are created, a **verification link** is emailed, and the seller is signed out.
4. Registration is complete only after the link is opened (it returns to `login.html?verified=1`).

## Login
- One field: **email or mobile number** + password. Google sign-in still works (Google emails are already verified).
- Mobile login: `loginIndex/{mobile}` -> email -> normal email/password sign-in.
- Unverified accounts: blocked, with "Resend verification email" (60s cooldown).
- First verified login links the seller's mobile number in `loginIndex` (first verified owner keeps the number).

## Enforcement (server side, Firestore rules)
All `users/{uid}/**`, `publicStores` owner access and `loginIndex` writes require `request.auth.token.email_verified == true`.
Seller pages also redirect unverified sessions (`services/verify-gate.js`).

## Known trade-offs
- `loginIndex` can be read by id (no listing). Anyone who knows a mobile number can learn the email linked to it.
  A zero-leak mobile login needs a Cloud Function (Blaze plan). Enable Firebase App Check to slow scraping.
- Mobile numbers are not OTP-verified. Whoever verifies an email first claims the number.
- Old phone-OTP-only accounts (no email) can no longer sign in.

## Firebase Console checklist
- Authentication -> Sign-in method: Email/Password enabled.
- Authentication -> Settings -> Authorized domains: your hosting domain (the link redirects there).
- Authentication -> Templates -> Email address verification: edit sender/subject if wanted.
- Firestore -> Rules: publish `backend/firebase/firestore/firestore.rules`.
