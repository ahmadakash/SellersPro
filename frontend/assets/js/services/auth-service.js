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
   EMAIL REGISTRATION
========================================= */

export async function registerWithEmail({

    name,
    email,
    password,
    businessName,
    phone

}) {

    const result =
        await createUserWithEmailAndPassword(
            auth,
            email,
            password
        );

    try {

        // Nice-to-have: lets other screens use displayName
        await updateProfile(
            result.user,
            { displayName: name }
        ).catch(() => {});

        return await createUserProfile(
            result.user,
            {

                name,

                email,

                phone,

                businessName,

                authProvider: "email"

            }
        );

    } catch (error) {

        // Profile could not be saved: remove the new login so the person
        // is not left with an account that has no seller profile.
        console.error(
            "Profile creation failed, removing the new account:",
            error
        );

        try {
            await deleteUser(result.user);
        } catch {
            await signOut(auth).catch(() => {});
        }

        throw error;
    }
}


/* =========================================
   EMAIL LOGIN
   remember = true  -> stay signed in after closing the browser
   remember = false -> signed out when the browser/tab session ends
========================================= */

export async function loginWithEmail(
    email,
    password,
    { remember = true } = {}
) {

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

    return result.user;
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

    return result.user;
}


/* =========================================
   PHONE OTP
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