import {
    loginWithEmail,
    loginWithGoogle,
    setupPhoneRecaptcha,
    sendPhoneOTP,
    verifyPhoneOTP,
    resetPassword
} from "../services/auth-service.js";


const loginForm =
    document.getElementById("loginForm");

const password =
    document.getElementById("password");

const togglePassword =
    document.getElementById("togglePassword");

const forgotPassword =
    document.getElementById("forgotPassword");

const googleLoginBtn =
    document.getElementById("googleLoginBtn");

const phoneLoginBtn =
    document.getElementById("phoneLoginBtn");

const phoneLoginSection =
    document.getElementById("phoneLoginSection");

const sendOtpBtn =
    document.getElementById("sendOtpBtn");

const verifyOtpBtn =
    document.getElementById("verifyOtpBtn");

const otpSection =
    document.getElementById("otpSection");

const message =
    document.getElementById("loginMessage");


/* ================================
   PASSWORD VISIBILITY
================================ */

togglePassword.addEventListener(
    "click",
    function () {

        password.type =
            password.type === "password"
                ? "text"
                : "password";

    }
);


/* ================================
   EMAIL LOGIN
================================ */

loginForm.addEventListener(
    "submit",
    async function (event) {

        event.preventDefault();

        const email =
            document
                .getElementById("email")
                .value
                .trim();

        const passwordValue =
            password.value;

        message.textContent =
            "Signing in...";

        try {

            await loginWithEmail(
                email,
                passwordValue
            );

            message.textContent =
                "Login successful.";

            window.location.href =
                "../dashboard/dashboard.html";

        } catch (error) {

            console.error(error);

            message.textContent =
                getLoginError(error.code);
        }
    }
);


/* ================================
   GOOGLE LOGIN
================================ */

googleLoginBtn.addEventListener(
    "click",
    async function () {

        message.textContent =
            "Signing in with Google...";

        try {

            await loginWithGoogle();

            message.textContent =
                "Login successful.";

            window.location.href =
                "../dashboard/dashboard.html";

        } catch (error) {

            console.error(error);

            message.textContent =
                getLoginError(error.code);
        }
    }
);


/* ================================
   SHOW PHONE LOGIN
================================ */

phoneLoginBtn.addEventListener(
    "click",
    function () {

        phoneLoginSection.hidden = false;

        phoneLoginBtn.disabled = true;

        try {

            setupPhoneRecaptcha(
                "recaptcha-container"
            );

        } catch (error) {

            console.error(error);

            message.textContent =
                "Phone authentication setup failed.";
        }

    }
);


/* ================================
   SEND PHONE OTP
================================ */

sendOtpBtn.addEventListener(
    "click",
    async function () {

        const phoneNumber =
            document
                .getElementById("phoneNumber")
                .value
                .trim();

        if (!phoneNumber) {

            message.textContent =
                "Enter your phone number.";

            return;
        }


        try {

            await sendPhoneOTP(
                phoneNumber,
                window.recaptchaVerifier
            );

            message.textContent =
                "OTP sent successfully.";

            otpSection.hidden = false;

        } catch (error) {

            console.error(error);

            message.textContent =
                getLoginError(error.code);
        }
    }
);


/* ================================
   VERIFY PHONE OTP
================================ */

verifyOtpBtn.addEventListener(
    "click",
    async function () {

        const otp =
            document
                .getElementById("otp")
                .value
                .trim();

        if (!otp) {

            message.textContent =
                "Enter the OTP.";

            return;
        }


        try {

            await verifyPhoneOTP(otp);

            message.textContent =
                "Phone login successful.";

            window.location.href =
                "../dashboard/dashboard.html";

        } catch (error) {

            console.error(error);

            message.textContent =
                getLoginError(error.code);
        }
    }
);


/* ================================
   FORGOT PASSWORD
================================ */

forgotPassword.addEventListener(
    "click",
    async function (event) {

        event.preventDefault();

        const email =
            document
                .getElementById("email")
                .value
                .trim();

        if (!email) {

            message.textContent =
                "Enter your email first.";

            return;
        }


        try {

            await resetPassword(email);

            message.textContent =
                "Password reset email sent.";

        } catch (error) {

            console.error(error);

            message.textContent =
                getLoginError(error.code);
        }

    }
);


/* ================================
   ERROR HANDLING
================================ */

function getLoginError(code) {

    switch (code) {

        case "auth/invalid-credential":
            return "Invalid email or password.";

        case "auth/user-not-found":
            return "No account found with this email.";

        case "auth/wrong-password":
            return "Incorrect password.";

        case "auth/invalid-email":
            return "Please enter a valid email.";

        case "auth/invalid-phone-number":
            return "Enter a valid phone number.";

        case "auth/invalid-verification-code":
            return "Invalid OTP.";

        case "auth/code-expired":
            return "OTP has expired.";

        case "auth/too-many-requests":
            return "Too many attempts. Try again later.";

        default:
            return "Unable to sign in. Please try again.";
    }
}