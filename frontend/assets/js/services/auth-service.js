// this is the auth service file, it contains the function for registering, logging in and logging out users. It uses the firebase auth and firestore services to perform these actions.
// it is backend file that is used to communicate with firebase auth and firestore services.
import {
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    signInWithPopup,
    GoogleAuthProvider,
    RecaptchaVerifier,
    signInWithPhoneNumber,
    sendPasswordResetEmail,
    signOut
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
}


/* =========================================
   EMAIL LOGIN
========================================= */

export async function loginWithEmail(
    email,
    password
) {

    const result =
        await signInWithEmailAndPassword(
            auth,
            email,
            password
        );

    return result.user;
}


/* =========================================
   GOOGLE LOGIN
========================================= */

export async function loginWithGoogle() {

    const provider =
        new GoogleAuthProvider();

    const result =
        await signInWithPopup(
            auth,
            provider
        );


    return await createUserProfile(
        result.user,
        {
            authProvider: "google"
        }
    );
}


/* =========================================
   PHONE OTP
========================================= */

export function setupPhoneRecaptcha(
    containerId
) {

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
    recaptchaVerifier
) {

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

        throw new Error(
            "Please request the OTP first."
        );
    }


    const result =
        await window.confirmationResult.confirm(
            otp
        );


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