import {
    registerWithEmail
} from "../services/auth-service.js";


console.log("Register JS loaded");


const registerForm =
    document.getElementById("registerForm");

const registerBtn =
    document.getElementById("registerBtn");

const registerMessage =
    document.getElementById("registerMessage");

const fullNameInput =
    document.getElementById("fullName");

const businessNameInput =
    document.getElementById("businessName");

const emailInput =
    document.getElementById("email");

const phoneInput =
    document.getElementById("phone");

const passwordInput =
    document.getElementById("password");

const confirmPasswordInput =
    document.getElementById("confirmPassword");


/* =========================================
   SHOW MESSAGE
========================================= */

function showMessage(message, type = "error") {

    registerMessage.textContent = message;

    registerMessage.className =
        `auth-message ${type}`;

}


/* =========================================
   PASSWORD TOGGLE
========================================= */

document
    .querySelectorAll(".password-toggle")
    .forEach(button => {

        button.addEventListener("click", () => {

            const targetId =
                button.dataset.target;

            const input =
                document.getElementById(targetId);


            if (input.type === "password") {

                input.type = "text";

                button.setAttribute(
                    "aria-label",
                    "Hide password"
                );

            } else {

                input.type = "password";

                button.setAttribute(
                    "aria-label",
                    "Show password"
                );
            }

        });

    });


/* =========================================
   REGISTER FORM
========================================= */

registerForm.addEventListener(
    "submit",
    async (event) => {

        event.preventDefault();

        console.log("Register form submitted");


        /* Clear old message */

        showMessage("");


        /* Get values */

        const fullName =
            fullNameInput.value.trim();

        const businessName =
            businessNameInput.value.trim();

        const email =
            emailInput.value.trim();

        const phone =
            phoneInput.value.trim();

        const password =
            passwordInput.value;

        const confirmPassword =
            confirmPasswordInput.value;


        /* =====================================
           EMPTY FIELD VALIDATION
        ===================================== */

        if (!fullName) {

            showMessage(
                "Please enter your full name."
            );

            fullNameInput.focus();

            return;
        }


        if (!businessName) {

            showMessage(
                "Please enter your business name."
            );

            businessNameInput.focus();

            return;
        }


        if (!email) {

            showMessage(
                "Please enter your email address."
            );

            emailInput.focus();

            return;
        }


        if (!phone) {

            showMessage(
                "Please enter your phone number."
            );

            phoneInput.focus();

            return;
        }


        if (!password) {

            showMessage(
                "Please enter a password."
            );

            passwordInput.focus();

            return;
        }


        if (!confirmPassword) {

            showMessage(
                "Please confirm your password."
            );

            confirmPasswordInput.focus();

            return;
        }


        /* =====================================
           EMAIL VALIDATION
        ===================================== */

        const emailPattern =
            /^[^\s@]+@[^\s@]+\.[^\s@]+$/;


        if (!emailPattern.test(email)) {

            showMessage(
                "Please enter a valid email address."
            );

            emailInput.focus();

            return;
        }


        /* =====================================
           PASSWORD VALIDATION
        ===================================== */

        if (password.length < 8) {

            showMessage(
                "Password must be at least 8 characters."
            );

            passwordInput.focus();

            return;
        }


        /* =====================================
           CONFIRM PASSWORD
        ===================================== */

        if (password !== confirmPassword) {

            showMessage(
                "Passwords do not match."
            );

            confirmPasswordInput.focus();

            return;
        }


        /* =====================================
           PHONE VALIDATION
        ===================================== */

        const phonePattern =
            /^01[3-9]\d{8}$/;


        if (!phonePattern.test(phone)) {

            showMessage(
                "Please enter a valid Bangladeshi phone number."
            );

            phoneInput.focus();

            return;
        }


        /* =====================================
           START FIREBASE REGISTRATION
        ===================================== */

        registerBtn.disabled = true;

        registerBtn.textContent =
            "Creating Account...";


        try {

            console.log(
                "Creating Firebase account..."
            );


            const user =
                await registerWithEmail({

                    name: fullName,

                    email: email,

                    password: password,

                    businessName: businessName,

                    phone: phone

                });


            console.log(
                "Firebase account created:",
                user.uid
            );


            showMessage(
                "Account created successfully.",
                "success"
            );


            setTimeout(() => {

                window.location.href =
                    "login.html";

            }, 1200);


        } catch (error) {

            console.error(
                "Registration error:",
                error
            );


            let message =
                "Unable to create account.";


            if (
                error.code ===
                "auth/email-already-in-use"
            ) {

                message =
                    "This email is already registered.";

            } else if (
                error.code ===
                "auth/invalid-email"
            ) {

                message =
                    "Please enter a valid email address.";

            } else if (
                error.code ===
                "auth/weak-password"
            ) {

                message =
                    "Password is too weak.";

            } else if (
                error.code ===
                "auth/operation-not-allowed"
            ) {

                message =
                    "Email/Password login is not enabled in Firebase.";

            } else if (
                error.code ===
                "permission-denied"
            ) {

                message =
                    "Firestore permission denied.";

            } else if (error.message) {

                message =
                    error.message;
            }


            showMessage(message);


            registerBtn.disabled =
                false;

            registerBtn.textContent =
                "Create Account";

        }

    }
);