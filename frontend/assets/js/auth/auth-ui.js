/* =====================================================
   SellersPro - shared helpers for the login & register pages
   File: assets/js/auth/auth-ui.js
===================================================== */

export const $ = (id) => document.getElementById(id);

export const DASHBOARD_URL = "../dashboard/dashboard.html";

/* ---------------------------------------------
   Validation helpers
--------------------------------------------- */

export function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(value ?? "").trim());
}

/**
 * Accepts 01712345678, 017 1234 5678, +8801712345678, 8801712345678, 1712345678
 * Returns { local: "01712345678", e164: "+8801712345678" } or null.
 */
export function normalizeBdPhone(input) {
  let digits = String(input ?? "").replace(/[\s\-().]/g, "");

  if (digits.startsWith("+")) digits = digits.slice(1);
  if (!/^\d+$/.test(digits)) return null;

  if (digits.startsWith("880")) digits = digits.slice(3);
  if (digits.length === 10 && digits.startsWith("1")) digits = `0${digits}`;

  if (!/^01[3-9]\d{8}$/.test(digits)) return null;

  return { local: digits, e164: `+880${digits.slice(1)}` };
}

const COMMON_PASSWORDS = new Set([
  "12345678", "123456789", "1234567890", "password", "password1",
  "qwertyui", "qwertyuiop", "11111111", "iloveyou", "abcd1234", "admin123"
]);

/** level: 0 = empty, 1 = too short, 2 = weak, 3 = good, 4 = strong */
export function passwordStrength(password) {
  if (!password) return { level: 0, label: "" };
  if (password.length < 8) return { level: 1, label: "Too short" };
  if (COMMON_PASSWORDS.has(password.toLowerCase())) return { level: 2, label: "Weak, too common" };

  let extras = 0;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) extras += 1;
  if (/\d/.test(password)) extras += 1;
  if (/[^A-Za-z0-9]/.test(password)) extras += 1;
  if (password.length >= 12) extras += 1;

  if (extras <= 1) return { level: 2, label: "Weak" };
  if (extras === 2) return { level: 3, label: "Good" };
  return { level: 4, label: "Strong" };
}

/* ---------------------------------------------
   Error messages (Firebase code -> friendly text)
--------------------------------------------- */

const ERROR_MESSAGES = {
  "auth/invalid-credential": "Incorrect email or password.",
  "auth/wrong-password": "Incorrect email or password.",
  "auth/user-not-found": "Incorrect email or password.",
  "auth/invalid-email": "Please enter a valid email address.",
  "auth/user-disabled": "This account has been disabled. Please contact support.",
  "auth/too-many-requests": "Too many attempts. Please wait a few minutes and try again.",
  "auth/network-request-failed": "Network error. Check your internet connection and try again.",
  "auth/popup-blocked": "Your browser blocked the Google sign-in window. Allow pop-ups and try again.",
  "auth/account-exists-with-different-credential":
    "An account already exists with this email. Sign in with your email and password instead.",
  "auth/operation-not-allowed": "This sign-in method is not enabled yet. Please contact support.",
  "auth/invalid-phone-number": "Enter a valid Bangladeshi mobile number, like 01712345678.",
  "auth/missing-phone-number": "Enter your mobile number.",
  "auth/quota-exceeded": "SMS limit reached for now. Please try again later.",
  "auth/captcha-check-failed": "Security check failed. Please refresh the page and try again.",
  "auth/invalid-app-credential": "Security check failed. Please refresh the page and try again.",
  "auth/invalid-verification-code": "That code is not correct. Please check it and try again.",
  "auth/code-expired": "This code has expired. Please request a new one.",
  "auth/session-expired": "This code has expired. Please request a new one.",
  "auth/email-already-in-use": "This email is already registered. Try signing in instead.",
  "auth/weak-password": "Please choose a stronger password.",
  "permission-denied": "We could not save your profile (permission denied). Please contact support.",
  unavailable: "The service is temporarily unavailable. Please try again in a moment."
};

/** Codes where the user simply closed the window, so we show a soft message */
export const CANCELLED_CODES = [
  "auth/popup-closed-by-user",
  "auth/cancelled-popup-request"
];

export function getAuthErrorMessage(error) {
  const code = error?.code || "";

  // Our own errors (AuthFlowError) already carry a clear message
  if (code.startsWith("app/") && error.message) return error.message;

  return ERROR_MESSAGES[code] || "Something went wrong. Please try again.";
}

/* ---------------------------------------------
   Alerts, loading buttons, field errors
--------------------------------------------- */

const ALERT_ICONS = {
  error: "bi-exclamation-circle-fill",
  success: "bi-check-circle-fill",
  info: "bi-info-circle-fill"
};

export function setAlert(element, message, type = "error") {
  if (!element) return;

  if (!message) {
    element.hidden = true;
    element.className = "auth-alert";
    return;
  }

  element.className = `auth-alert is-${type}`;
  element.innerHTML = `<i class="bi ${ALERT_ICONS[type] || ALERT_ICONS.error}" aria-hidden="true"></i><span></span>`;
  element.querySelector("span").textContent = message;
  element.hidden = false;
}

export function clearAlert(element) {
  setAlert(element, "");
}

export function setLoading(button, loading, loadingText = "Please wait...") {
  if (!button) return;

  const label = button.querySelector(".btn-label");

  if (loading) {
    if (label && !button.dataset.label) button.dataset.label = label.textContent;
    if (label) label.textContent = loadingText;
    button.classList.add("is-loading");
    button.disabled = true;
  } else {
    if (label && button.dataset.label) {
      label.textContent = button.dataset.label;
      delete button.dataset.label;
    }
    button.classList.remove("is-loading");
    button.disabled = false;
  }
}

export function setFieldError(inputId, message) {
  const input = $(inputId);
  if (!input) return;

  const field = input.closest(".field");
  const error = $(`${inputId}Error`);

  field?.classList.toggle("has-error", Boolean(message));
  input.setAttribute("aria-invalid", message ? "true" : "false");

  if (error) {
    error.textContent = message || "";
    error.hidden = !message;
  }
}

export function clearFieldError(inputId) {
  setFieldError(inputId, "");
}

/** Clears a field's error as soon as the user edits it */
export function bindFieldErrorClearing(root = document) {
  root.querySelectorAll(".field input").forEach((input) => {
    input.addEventListener("input", () => {
      if (input.id) clearFieldError(input.id);
    });
  });
}

/** Eye icon toggles: <button data-toggle-password="passwordInputId"> */
export function bindPasswordToggles() {
  document.querySelectorAll("[data-toggle-password]").forEach((button) => {
    button.addEventListener("click", () => {
      const input = $(button.dataset.togglePassword);
      if (!input) return;

      const show = input.type === "password";
      input.type = show ? "text" : "password";

      button.setAttribute("aria-label", show ? "Hide password" : "Show password");
      button.setAttribute("aria-pressed", String(show));

      const icon = button.querySelector("i");
      if (icon) icon.className = `bi ${show ? "bi-eye-slash" : "bi-eye"}`;
    });
  });
}