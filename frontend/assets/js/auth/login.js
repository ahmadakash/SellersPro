import {
    loginWithIdentifier,
    loginWithGoogle,
    resolveLoginEmail,
    resetPassword,
    sendVerificationLink
} from "../services/auth-service.js";

import { auth } from "../config/firebase.js";

import {
    signOut
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";

import {
    $,
    DASHBOARD_URL,
    CANCELLED_CODES,
    getAuthErrorMessage,
    setAlert,
    clearAlert,
    setLoading,
    setFieldError,
    bindFieldErrorClearing,
    bindPasswordToggles
} from "./auth-ui.js";

const loginAlert = $("loginAlert");

const RESET_COOLDOWN_SECONDS = 30;
const VERIFY_COOLDOWN_SECONDS = 60;

let redirecting = false;
let resetCooldownUntil = 0;
let verifyCooldownUntil = 0;
let unverifiedUser = null;      // signed in only so "Resend" can work

bindPasswordToggles();
bindFieldErrorClearing();


/* =========================================
   HELPERS
========================================= */

function goToDashboard(message = "Signed in. Taking you to your dashboard...") {

    redirecting = true;

    setAlert(loginAlert, message, "success");

    window.setTimeout(() => {
        window.location.href = DASHBOARD_URL;
    }, 500);
}

function showError(error) {

    console.error(error);

    if (CANCELLED_CODES.includes(error?.code)) {
        setAlert(loginAlert, "Sign-in was cancelled.", "info");
        return;
    }

    setAlert(loginAlert, getAuthErrorMessage(error), "error");
}

function lockOtherButtons(locked) {
    $("googleLoginBtn").disabled = locked;
}

async function dropUnverifiedSession() {

    unverifiedUser = null;
    $("verifyBox").hidden = true;

    if (auth.currentUser && !auth.currentUser.emailVerified) {
        await signOut(auth).catch(() => {});
    }
}

function showVerifyBox(user) {

    unverifiedUser = user;

    $("verifyEmail").textContent = user.email || "your email";
    $("verifyBox").hidden = false;

    setAlert(
        loginAlert,
        "Please verify your email first. Open the link we sent you, then sign in again.",
        "info"
    );
}


/* =========================================
   LANDED FROM THE VERIFICATION LINK
========================================= */

const params = new URLSearchParams(window.location.search);

if (params.get("verified") === "1") {

    setAlert(
        loginAlert,
        "Email verified. Your registration is complete. Please sign in.",
        "success"
    );

    history.replaceState(null, "", window.location.pathname);

} else if (params.get("verify") === "1") {

    setAlert(
        loginAlert,
        "Please verify your email address, then sign in.",
        "info"
    );

    history.replaceState(null, "", window.location.pathname);
}

// A leftover unverified session (closed tab etc.) must not stay signed in here.
auth.authStateReady?.().then(() => {
    if (auth.currentUser && !auth.currentUser.emailVerified) {
        signOut(auth).catch(() => {});
    }
});


/* =========================================
   EMAIL / MOBILE + PASSWORD LOGIN
========================================= */

$("loginForm").addEventListener("submit", async (event) => {

    event.preventDefault();

    if (redirecting) return;

    clearAlert(loginAlert);
    await dropUnverifiedSession();

    const identifier = $("identifier").value.trim();
    const password = $("password").value;

    let valid = true;

    if (!identifier) {
        setFieldError("identifier", "Enter your email or mobile number.");
        valid = false;
    }

    if (!password) {
        setFieldError("password", "Enter your password.");
        valid = false;
    }

    if (!valid) {
        (document.querySelector(".has-error input") || $("identifier")).focus();
        return;
    }

    const button = $("loginSubmit");

    setLoading(button, true, "Signing in...");
    lockOtherButtons(true);

    try {

        const { user, verified } = await loginWithIdentifier(identifier, password, {
            remember: $("rememberMe").checked
        });

        if (!verified) {
            showVerifyBox(user);
            setLoading(button, false);
            lockOtherButtons(false);
            return;
        }

        goToDashboard();

    } catch (error) {

        showError(error);

        if (
            error.code === "auth/invalid-credential" ||
            error.code === "auth/wrong-password"
        ) {
            $("password").select();
        }

        setLoading(button, false);
        lockOtherButtons(false);
    }
});


/* =========================================
   RESEND VERIFICATION EMAIL
========================================= */

$("resendVerifyBtn").addEventListener("click", async () => {

    if (!unverifiedUser) return;

    const waitSeconds = Math.ceil((verifyCooldownUntil - Date.now()) / 1000);

    if (waitSeconds > 0) {
        setAlert(
            loginAlert,
            `A link was just sent. You can request another in ${waitSeconds}s.`,
            "info"
        );
        return;
    }

    const button = $("resendVerifyBtn");
    button.disabled = true;

    try {

        await sendVerificationLink(unverifiedUser);

        verifyCooldownUntil = Date.now() + VERIFY_COOLDOWN_SECONDS * 1000;

        setAlert(
            loginAlert,
            `Verification link sent to ${unverifiedUser.email}. Check your inbox and spam folder.`,
            "success"
        );

        // Sign out now. They sign in again after opening the link.
        await dropUnverifiedSession();

    } catch (error) {

        showError(error);

    } finally {

        button.disabled = false;
    }
});


/* =========================================
   GOOGLE LOGIN
========================================= */

$("googleLoginBtn").addEventListener("click", async () => {

    if (redirecting) return;

    clearAlert(loginAlert);

    const button = $("googleLoginBtn");

    setLoading(button, true, "Opening Google...");
    $("loginSubmit").disabled = true;

    try {

        await loginWithGoogle();

        goToDashboard();

    } catch (error) {

        showError(error);

        setLoading(button, false);
        $("loginSubmit").disabled = false;
    }
});


/* =========================================
   FORGOT PASSWORD (email or mobile number)
========================================= */

$("forgotPassword").addEventListener("click", async () => {

    clearAlert(loginAlert);

    const identifier = $("identifier").value.trim();

    if (!identifier) {

        setFieldError(
            "identifier",
            "Enter your email or mobile number here first, then click Forgot password."
        );

        $("identifier").focus();
        return;
    }

    const waitSeconds = Math.ceil((resetCooldownUntil - Date.now()) / 1000);

    if (waitSeconds > 0) {
        setAlert(
            loginAlert,
            `A reset link was just sent. You can request another in ${waitSeconds}s.`,
            "info"
        );
        return;
    }

    const button = $("forgotPassword");
    button.disabled = true;

    try {

        const email = await resolveLoginEmail(identifier);

        if (email) {
            await resetPassword(email).catch((error) => {
                // user-not-found must look the same as success
                if (error?.code !== "auth/user-not-found") throw error;
            });
        }

        resetCooldownUntil = Date.now() + RESET_COOLDOWN_SECONDS * 1000;

        // Same wording whether or not the account exists (no guessing)
        setAlert(
            loginAlert,
            "If an account exists for that email or number, we sent a password reset link. Check your inbox and spam folder.",
            "success"
        );

    } catch (error) {

        showError(error);

    } finally {

        button.disabled = false;
    }
});


/* =========================================
   BACK BUTTON (page restored from cache after a redirect)
========================================= */

window.addEventListener("pageshow", (event) => {
    if (event.persisted) window.location.reload();
});
