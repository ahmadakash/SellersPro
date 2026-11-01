import {
    registerWithEmail
} from "../services/auth-service.js";

import {
    $,
    DASHBOARD_URL,
    isValidEmail,
    normalizeBdPhone,
    passwordStrength,
    getAuthErrorMessage,
    setAlert,
    clearAlert,
    setLoading,
    setFieldError,
    clearFieldError,
    bindFieldErrorClearing,
    bindPasswordToggles
} from "./auth-ui.js";

const registerAlert = $("registerAlert");

let submitting = false;

bindPasswordToggles();
bindFieldErrorClearing();


/* =========================================
   LIVE FEEDBACK: PASSWORD STRENGTH + MATCH
========================================= */

function updateStrength() {

    const { level, label } = passwordStrength($("password").value);

    $("passwordStrength").dataset.level = String(level);
    $("strengthLabel").textContent = label;
    $("strengthLabel").dataset.level = String(level);
}

function updateMatchHint() {

    const password = $("password").value;
    const confirm = $("confirmPassword").value;
    const hint = $("matchHint");

    if (!confirm) {
        hint.textContent = "";
        hint.className = "match-hint";
        return;
    }

    const match = password === confirm;

    hint.textContent = match ? "Passwords match" : "Passwords do not match yet";
    hint.className = `match-hint ${match ? "is-ok" : "is-bad"}`;
}

$("password").addEventListener("input", () => {
    updateStrength();
    updateMatchHint();
});

$("confirmPassword").addEventListener("input", updateMatchHint);


/* =========================================
   VALIDATION
   Returns { values } when valid, or null (after marking every bad field)
========================================= */

function validate() {

    const fullName = $("fullName").value.trim();
    const businessName = $("businessName").value.trim();
    const email = $("email").value.trim();
    const phoneInput = $("phone").value.trim();
    const password = $("password").value;
    const confirmPassword = $("confirmPassword").value;

    const errors = [];   // [fieldId, message] in page order

    if (!fullName) {
        errors.push(["fullName", "Enter your full name."]);
    }

    if (!businessName) {
        errors.push(["businessName", "Enter your business name."]);
    }

    if (!email) {
        errors.push(["email", "Enter your email address."]);
    } else if (!isValidEmail(email)) {
        errors.push(["email", "Enter a valid email address."]);
    }

    const phone = normalizeBdPhone(phoneInput);

    if (!phoneInput) {
        errors.push(["phone", "Enter your mobile number."]);
    } else if (!phone) {
        errors.push(["phone", "Enter a valid Bangladeshi mobile number, like 01712345678."]);
    }

    if (!password) {
        errors.push(["password", "Create a password."]);
    } else if (password.length < 8) {
        errors.push(["password", "Use at least 8 characters."]);
    }

    if (!confirmPassword) {
        errors.push(["confirmPassword", "Repeat your password."]);
    } else if (password !== confirmPassword) {
        errors.push(["confirmPassword", "Passwords do not match."]);
    }

    ["fullName", "businessName", "email", "phone", "password", "confirmPassword"]
        .forEach(clearFieldError);

    errors.forEach(([id, message]) => setFieldError(id, message));

    if (errors.length) {
        $(errors[0][0]).focus();
        return null;
    }

    return {
        fullName,
        businessName,
        email,
        // stored in the same 01XXXXXXXXX format the app already uses
        phone: phone.local,
        password
    };
}


/* =========================================
   SUBMIT
========================================= */

$("registerForm").addEventListener("submit", async (event) => {

    event.preventDefault();

    if (submitting) return;

    clearAlert(registerAlert);

    const values = validate();

    if (!values) return;

    submitting = true;

    const button = $("registerBtn");

    setLoading(button, true, "Creating your account...");

    try {

        await registerWithEmail({
            name: values.fullName,
            email: values.email,
            password: values.password,
            businessName: values.businessName,
            phone: values.phone
        });

        showSuccess(values.fullName);

    } catch (error) {

        console.error("Registration error:", error);

        if (error.code === "auth/email-already-in-use") {

            setFieldError("email", "This email is already registered. Try signing in instead.");
            $("email").focus();

        } else if (error.code === "auth/invalid-email") {

            setFieldError("email", "Enter a valid email address.");
            $("email").focus();

        } else if (error.code === "auth/weak-password") {

            setFieldError("password", "Choose a stronger password.");
            $("password").focus();

        } else {

            setAlert(registerAlert, getAuthErrorMessage(error), "error");
        }

        submitting = false;
        setLoading(button, false);
    }
});


/* =========================================
   SUCCESS
   The new account is already signed in, so go straight to the dashboard
========================================= */

function showSuccess(fullName) {

    const firstName = fullName.split(/\s+/)[0] || "there";

    $("registerPanel").hidden = true;
    $("registerSuccess").hidden = false;

    $("registerSuccess").querySelector("h2").textContent =
        `Welcome, ${firstName}!`;

    window.setTimeout(() => {
        window.location.href = DASHBOARD_URL;
    }, 1800);
}


/* =========================================
   BACK BUTTON (page restored from cache after a redirect)
========================================= */

window.addEventListener("pageshow", (event) => {
    if (event.persisted) window.location.reload();
});