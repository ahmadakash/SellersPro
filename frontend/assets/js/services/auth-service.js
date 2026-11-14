// Auth service: register, login, logout and password reset.
// It talks to Firebase Authentication and the Firestore "users" collection.
import {
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    signInWithPopup,
    GoogleAuthProvider,
    RecaptchaVerifier,
    signInWithPhoneNumber,
    sendPasswordResetEmail,
    sendEmailVerification,
    signOut,
    deleteUser,
    updateProfile,
    getAdditionalUserInfo,
    setPersistence,
    browserLocalPersistence,
    browserSessionPersistence
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";

import {
    doc,
    setDoc,
    getDoc,
    deleteDoc,
    updateDoc,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

import {
    auth,
    db
} from "../config/firebase.js";


/* =========================================
   OUR OWN ERROR TYPE
   code "app/..." means the message is safe to show to the user
========================================= */

export class AuthFlowError extends Error {
    constructor(code, message) {
        super(message);
        this.name = "AuthFlowError";
        this.code = code;
    }
}


/* =========================================
   CREATE / GET USER PROFILE
========================================= */

export async function createUserProfile(
    user,
    additionalData = {}
) {

    const userRef =
        doc(db, "users", user.uid);

    const existingUser =
        await getDoc(userRef);


    if (!existingUser.exists()) {

        await setDoc(userRef, {

            uid: user.uid,

            name:
                additionalData.name ||
                user.displayName ||
                "",

            email:
                user.email ||
                "",

            phone:
                additionalData.phone ||
                user.phoneNumber ||
                "",

            businessName:
                additionalData.businessName ||
                "",

            plan: "free",

            authProvider:
                additionalData.authProvider ||
                "email",

            createdAt:
                serverTimestamp(),

            updatedAt:
                serverTimestamp()

        });
    }

    return user;
}


/* =========================================
   REMOVE A JUST-CREATED AUTH ACCOUNT

   Only a brand new account is deleted. If the person already had an
   account (for example an admin or an older seller), we only sign out,
   so a real account is never destroyed by a failed login attempt.
========================================= */

async function discardUnregisteredAccount(result) {

    const isNewAccount =
        getAdditionalUserInfo(result)?.isNewUser === true;

    try {

        if (isNewAccount) {
            await deleteUser(result.user);
        } else {
            await signOut(auth);
        }

    } catch (error) {

        console.error(
            "Could not remove the unregistered account:",
            error
        );

        await signOut(auth).catch(() => {});
    }
}


/* =========================================
   PHONE / EMAIL HELPERS
========================================= */

/** 01712345678, +8801712345678, 017-1234 5678 ... -> "01712345678" or null */
export function toLocalBdPhone(input) {

    let digits = String(input ?? "").replace(/[\s\-().]/g, "");

    if (digits.startsWith("+")) digits = digits.slice(1);
    if (!/^\d+$/.test(digits)) return null;

    if (digits.startsWith("880")) digits = digits.slice(3);
    if (digits.length === 10 && digits.startsWith("1")) digits = `0${digits}`;

    return /^01[3-9]\d{8}$/.test(digits) ? digits : null;
}

/** Where the verification link sends the person after Firebase confirms the email */
function verificationSettings() {

    const url = new URL("login.html", window.location.href);

    url.search = "";
    url.hash = "";
    url.searchParams.set("verified", "1");

    return { url: url.toString(), handleCodeInApp: false };
}

export async function sendVerificationLink(user) {
    await sendEmailVerification(user, verificationSettings());
}


/* =========================================
   LOGIN INDEX  (phone number -> account)

   loginIndex/{01XXXXXXXXX} = { uid, email }
   - created only by a VERIFIED owner, only for the phone saved in their profile
   - first verified owner of a number keeps it (phone numbers are unique)
   - used for "phone + password" sign in and the "number already used" check
========================================= */

const loginIndexRef = (phone) => doc(db, "loginIndex", phone);

export async function isPhoneTaken(phone) {

    const snapshot = await getDoc(loginIndexRef(phone));

    return snapshot.exists();
}

/**
 * Called after a verified sign-in. Makes sure the seller profile exists and
 * their phone number points to this account. Never blocks the sign-in.
 */
export async function finishVerifiedSetup(user) {

    const result = { phoneLinked: false, phoneConflict: false };

    try {

        await createUserProfile(user, {
            authProvider: user.providerData?.[0]?.providerId === "google.com"
                ? "google"
                : "email"
        });

        const profile = await getDoc(doc(db, "users", user.uid));
        const phone = toLocalBdPhone(profile.data()?.phone);

        if (!phone || !user.email) return result;

        // The rules compare the index key with profile.phone, so store it normalized.
        if (profile.data().phone !== phone) {
            await updateDoc(doc(db, "users", user.uid), { phone, updatedAt: serverTimestamp() });
        }

        const existing = await getDoc(loginIndexRef(phone));

        if (!existing.exists()) {

            await setDoc(loginIndexRef(phone), {
                uid: user.uid,
                email: user.email,
                createdAt: serverTimestamp()
            });

            result.phoneLinked = true;

        } else if (existing.data().uid === user.uid) {

            if (existing.data().email !== user.email) {
                await setDoc(loginIndexRef(phone), {
                    uid: user.uid,
                    email: user.email,
                    createdAt: existing.data().createdAt || serverTimestamp()
                });
            }

            result.phoneLinked = true;

        } else {

            result.phoneConflict = true;
        }

    } catch (error) {

        console.warn("Login index setup failed:", error);
    }

    return result;
}

/** Settings page: the seller changed the phone number in their profile. */
export async function moveLoginIndex(user, oldPhoneInput, newPhoneInput) {

    const oldPhone = toLocalBdPhone(oldPhoneInput);
    const newPhone = toLocalBdPhone(newPhoneInput);

    if (oldPhone === newPhone || !user?.email) return { ok: true };

    if (newPhone) {

        const taken = await getDoc(loginIndexRef(newPhone));

        if (taken.exists() && taken.data().uid !== user.uid) {
            return { ok: false, reason: "taken" };
        }
    }

    if (oldPhone) {

        const old = await getDoc(loginIndexRef(oldPhone));

        if (old.exists() && old.data().uid === user.uid) {
            await deleteDoc(loginIndexRef(oldPhone));
        }
    }

    if (newPhone) {
        await setDoc(loginIndexRef(newPhone), {
            uid: user.uid,
            email: user.email,
            createdAt: serverTimestamp()
        });
    }

    return { ok: true };
}


/** Email typed directly, or the email linked to a mobile number (null if none). */
export async function resolveLoginEmail(identifier) {

    const value = String(identifier || "").trim();

    if (value.includes("@")) return value;

    const phone = toLocalBdPhone(value);

    if (!phone) return null;

    const entry = await getDoc(loginIndexRef(phone));

    return entry.exists() ? (entry.data().email || null) : null;
}


/* =========================================
   EMAIL REGISTRATION
   1. create the login  2. save the seller profile  3. email a verification link
   4. sign out: the account only becomes usable after the link is opened
========================================= */

export async function registerWithEmail({

    name,
    email,
    password,
    businessName,
    phone

}) {

    // Friendly early check. The rules enforce uniqueness again at verification.
    if (await isPhoneTaken(phone)) {

        throw new AuthFlowError(
            "app/phone-in-use",
            "This mobile number is already registered. Try signing in instead."
        );
    }

    const result =
        await createUserWithEmailAndPassword(
            auth,
            email,
            password
        );

    try {

        await updateProfile(
            result.user,
            { displayName: name }
        ).catch(() => {});

        await createUserProfile(
            result.user,
            {
                name,
                email,
                phone,
                businessName,
                authProvider: "email"
            }
        );

        await sendVerificationLink(result.user);

    } catch (error) {

        // Nothing half-finished is left behind.
        console.error(
            "Registration failed, removing the new account:",
            error
        );

        try {
            await deleteUser(result.user);
        } catch {
            await signOut(auth).catch(() => {});
        }

        throw error;
    }

    await signOut(auth).catch(() => {});

    return { email };
}


/* =========================================
   LOGIN  (email + password  OR  mobile number + password)
   remember = true  -> stay signed in after closing the browser
   remember = false -> signed out when the browser/tab session ends

   Returns { user, verified }. An unverified user stays signed in only so the
   caller can offer "Resend link"; the caller must sign them out afterwards.
========================================= */

export async function loginWithIdentifier(
    identifier,
    password,
    { remember = true } = {}
) {

    const value = String(identifier || "").trim();
    let email = value;

    if (!value.includes("@")) {

        const phone = toLocalBdPhone(value);

        if (!phone) {
            throw new AuthFlowError(
                "app/bad-identifier",
                "Enter a valid email address or a Bangladeshi mobile number."
            );
        }

        const entry = await getDoc(loginIndexRef(phone));

        // Same message as a wrong password, so numbers cannot be probed.
        if (!entry.exists() || !entry.data().email) {
            throw Object.assign(new Error("invalid"), { code: "auth/invalid-credential" });
        }

        email = entry.data().email;
    }

    await setPersistence(
        auth,
        remember
            ? browserLocalPersistence
            : browserSessionPersistence
    );

    const result =
        await signInWithEmailAndPassword(
            auth,
            email,
            password
        );

    const user = result.user;

    await user.reload().catch(() => {});

    if (!user.emailVerified) {
        return { user, verified: false };
    }

    // Make sure the token carries email_verified before any Firestore call.
    await user.getIdToken(true).catch(() => {});
    await finishVerifiedSetup(user);

    return { user, verified: true };
}


/* =========================================
   GOOGLE LOGIN (registered sellers only)
========================================= */

export async function loginWithGoogle() {

    const provider = new GoogleAuthProvider();
    const result = await signInWithPopup(auth, provider);

    const userRef = doc(db, "users", result.user.uid);
    const existingProfile = await getDoc(userRef);

    if (!existingProfile.exists()) {

        await discardUnregisteredAccount(result);

        throw new AuthFlowError(
            "app/not-registered",
            "No SellersPro account was found for this Google account. Please create an account first."
        );
    }

    await finishVerifiedSetup(result.user);

    return result.user;
}


/* =========================================
   PHONE OTP (no longer used by the login page)
========================================= */

export function clearPhoneRecaptcha() {

    try {
        window.recaptchaVerifier?.clear();
    } catch (error) {
        console.warn("reCAPTCHA clear failed:", error);
    }

    window.recaptchaVerifier = null;
}


export function setupPhoneRecaptcha(
    containerId
) {

    // Always start from a clean verifier. Re-using a used one is what
    // causes "reCAPTCHA has already been rendered" errors on retry.
    clearPhoneRecaptcha();

    window.recaptchaVerifier =
        new RecaptchaVerifier(
            auth,
            containerId,
            {
                size: "invisible"
            }
        );

    return window.recaptchaVerifier;
}


export async function sendPhoneOTP(
    phoneNumber,
    recaptchaVerifier = window.recaptchaVerifier
) {

    if (!recaptchaVerifier) {

        throw new AuthFlowError(
            "app/recaptcha-missing",
            "Security check is not ready. Please try again."
        );
    }

    const confirmationResult =
        await signInWithPhoneNumber(
            auth,
            phoneNumber,
            recaptchaVerifier
        );

    window.confirmationResult =
        confirmationResult;

    return confirmationResult;
}


export async function verifyPhoneOTP(
    otp
) {

    if (!window.confirmationResult) {

        throw new AuthFlowError(
            "app/otp-not-requested",
            "Please request a code first."
        );
    }


    const result =
        await window.confirmationResult.confirm(
            otp
        );

    window.confirmationResult = null;


    return await createUserProfile(
        result.user,
        {
            authProvider: "phone"
        }
    );
}


/* =========================================
   RESET PASSWORD
========================================= */

export async function resetPassword(
    email
) {

    await sendPasswordResetEmail(
        auth,
        email
    );
}


/* =========================================
   LOGOUT
========================================= */

export async function logoutUser() {

    await signOut(auth);

}