import {
    loginWithEmail,
    loginWithGoogle,
    setupPhoneRecaptcha,
    clearPhoneRecaptcha,
    sendPhoneOTP,
    verifyPhoneOTP,
    resetPassword
} from "../services/auth-service.js";

import {
    $,
    DASHBOARD_URL,
    CANCELLED_CODES,
    isValidEmail,
    normalizeBdPhone,
    getAuthErrorMessage,
    setAlert,
    clearAlert,
    setLoading,
    setFieldError,
    clearFieldError,
    bindFieldErrorClearing,
    bindPasswordToggles
} from "./auth-ui.js";

const loginAlert = $("loginAlert");
const phoneAlert = $("phoneAlert");

const OTP_RESEND_SECONDS = 30;
const RESET_COOLDOWN_SECONDS = 30;

let redirecting = false;
let phoneRecaptchaReady = false;
let lastPhone = null;          // { local, e164 } used for the current OTP
let resendTimer = null;
let resetCooldownUntil = 0;

bindPasswordToggles();
bindFieldErrorClearing();


/* =========================================
   HELPERS
========================================= */

function goToDashboard(alertElement, message = "Signed in. Taking you to your dashboard...") {

    redirecting = true;

    setAlert(alertElement, message, "success");

    window.setTimeout(() => {
        window.location.href = DASHBOARD_URL;
    }, 500);
}

function showError(alertElement, error) {

    console.error(error);

    if (CANCELLED_CODES.includes(error?.code)) {
        setAlert(alertElement, "Sign-in was cancelled.", "info");
        return;
    }

    setAlert(alertElement, getAuthErrorMessage(error), "error");
}

function lockSocialButtons(locked) {
    $("googleLoginBtn").disabled = locked;
    $("phoneLoginBtn").disabled = locked;
}


/* =========================================
   EMAIL + PASSWORD LOGIN
========================================= */

$("loginForm").addEventListener("submit", async (event) => {

    event.preventDefault();

    if (redirecting) return;

    clearAlert(loginAlert);

    const email = $("email").value.trim();
    const password = $("password").value;

    let valid = true;

    if (!email) {
        setFieldError("email", "Enter your email address.");
        valid = false;
    } else if (!isValidEmail(email)) {
        setFieldError("email", "Enter a valid email address.");
        valid = false;
    }

    if (!password) {
        setFieldError("password", "Enter your password.");
        valid = false;
    }

    if (!valid) {
        (document.querySelector(".has-error input") || $("email")).focus();
        return;
    }

    const button = $("loginSubmit");

    setLoading(button, true, "Signing in...");
    lockSocialButtons(true);

    try {

        await loginWithEmail(email, password, {
            remember: $("rememberMe").checked
        });

        goToDashboard(loginAlert);

    } catch (error) {

        showError(loginAlert, error);

        if (
            error.code === "auth/invalid-credential" ||
            error.code === "auth/wrong-password"
        ) {
            $("password").select();
        }

        setLoading(button, false);
        lockSocialButtons(false);
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
    $("phoneLoginBtn").disabled = true;

    try {

        await loginWithGoogle();

        goToDashboard(loginAlert);

    } catch (error) {

        showError(loginAlert, error);

        setLoading(button, false);
        $("loginSubmit").disabled = false;
        $("phoneLoginBtn").disabled = false;
    }
});


/* =========================================
   FORGOT PASSWORD
========================================= */

$("forgotPassword").addEventListener("click", async () => {

    clearAlert(loginAlert);

    const email = $("email").value.trim();

    if (!isValidEmail(email)) {

        setFieldError(
            "email",
            email
                ? "Enter a valid email address."
                : "Enter your email here first, then click Forgot password."
        );

        $("email").focus();
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

        await resetPassword(email);

        resetCooldownUntil = Date.now() + RESET_COOLDOWN_SECONDS * 1000;

        // Same wording whether or not the account exists (no email guessing)
        setAlert(
            loginAlert,
            `If an account exists for ${email}, we sent a password reset link. Check your inbox and spam folder.`,
            "success"
        );

    } catch (error) {

        showError(loginAlert, error);

    } finally {

        button.disabled = false;
    }
});


/* =========================================
   PHONE LOGIN: VIEWS
========================================= */

function showView(name) {

    const phone = name === "phone";

    $("loginView").hidden = phone;
    $("phoneView").hidden = !phone;

    clearAlert(loginAlert);
    clearAlert(phoneAlert);

    if (phone) {
        resetPhoneSteps();
        $("phoneNumber").focus();
    } else {
        stopResendTimer();
        $("email").focus();
    }
}

function resetPhoneSteps() {

    $("phoneForm").hidden = false;
    $("otpForm").hidden = true;
    $("otp").value = "";

    clearFieldError("phoneNumber");
    clearFieldError("otp");

    $("phoneSubtitle").textContent =
        "We will text a 6-digit code to your mobile number.";

    stopResendTimer();
}

function ensureRecaptcha() {

    if (phoneRecaptchaReady) return;

    setupPhoneRecaptcha("recaptcha-container");
    phoneRecaptchaReady = true;
}

function resetRecaptcha() {

    clearPhoneRecaptcha();
    phoneRecaptchaReady = false;
}

$("phoneLoginBtn").addEventListener("click", () => showView("phone"));

$("backToEmail").addEventListener("click", () => showView("login"));

$("changeNumberBtn").addEventListener("click", () => {

    resetRecaptcha();
    clearAlert(phoneAlert);
    resetPhoneSteps();
    $("phoneNumber").focus();
});


/* =========================================
   PHONE LOGIN: SEND CODE
========================================= */

function startResendTimer() {

    stopResendTimer();

    const button = $("resendOtpBtn");
    let remaining = OTP_RESEND_SECONDS;

    button.disabled = true;
    button.textContent = `Resend code in ${remaining}s`;

    resendTimer = window.setInterval(() => {

        remaining -= 1;

        if (remaining <= 0) {
            stopResendTimer();
            button.disabled = false;
            button.textContent = "Resend code";
            return;
        }

        button.textContent = `Resend code in ${remaining}s`;

    }, 1000);
}

function stopResendTimer() {

    if (resendTimer) {
        window.clearInterval(resendTimer);
        resendTimer = null;
    }

    const button = $("resendOtpBtn");
    button.disabled = true;
    button.textContent = "Resend code";
}

async function sendCode(phone, button) {

    clearAlert(phoneAlert);

    setLoading(button, true, "Sending code...");

    try {

        // A fresh security check for every request avoids "already rendered" errors
        resetRecaptcha();
        ensureRecaptcha();

        await sendPhoneOTP(phone.e164);

        lastPhone = phone;

        $("phoneForm").hidden = true;
        $("otpForm").hidden = false;
        $("otp").value = "";

        $("phoneSubtitle").textContent =
            `Enter the 6-digit code we sent to +880 ${phone.local.slice(1)}.`;

        setAlert(phoneAlert, "Code sent. It can take up to a minute to arrive.", "success");

        startResendTimer();
        $("otp").focus();

    } catch (error) {

        showError(phoneAlert, error);
        resetRecaptcha();

    } finally {

        setLoading(button, false);
    }
}

$("phoneForm").addEventListener("submit", async (event) => {

    event.preventDefault();

    const phone = normalizeBdPhone($("phoneNumber").value);

    if (!phone) {
        setFieldError(
            "phoneNumber",
            "Enter a valid Bangladeshi mobile number, like 01712345678."
        );
        $("phoneNumber").focus();
        return;
    }

    await sendCode(phone, $("sendOtpBtn"));
});

$("resendOtpBtn").addEventListener("click", async () => {

    if (!lastPhone) return;

    const button = $("resendOtpBtn");
    button.disabled = true;

    await sendCode(lastPhone, button);

    // sendCode() restores the button, so restart the countdown on success
    if (!$("otpForm").hidden) startResendTimer();
});


/* =========================================
   PHONE LOGIN: VERIFY CODE
========================================= */

$("otp").addEventListener("input", () => {
    // digits only
    $("otp").value = $("otp").value.replace(/\D/g, "").slice(0, 6);
});

$("otpForm").addEventListener("submit", async (event) => {

    event.preventDefault();

    if (redirecting) return;

    clearAlert(phoneAlert);

    const code = $("otp").value.trim();

    if (!/^\d{6}$/.test(code)) {
        setFieldError("otp", "Enter the 6-digit code from the SMS.");
        $("otp").focus();
        return;
    }

    const button = $("verifyOtpBtn");

    setLoading(button, true, "Verifying...");

    try {

        await verifyPhoneOTP(code);

        stopResendTimer();
        goToDashboard(phoneAlert);

    } catch (error) {

        showError(phoneAlert, error);
        setLoading(button, false);

        if (error.code === "auth/invalid-verification-code") {
            $("otp").select();
        }
    }
});


/* =========================================
   BACK BUTTON (page restored from cache after a redirect)
========================================= */

window.addEventListener("pageshow", (event) => {
    if (event.persisted) window.location.reload();
});