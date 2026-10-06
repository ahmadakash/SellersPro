import {
    loginWithEmail,
    loginWithGoogle
} from "../services/auth-service.js";


const loginForm =
    document.getElementById("loginForm");

const googleLoginBtn =
    document.getElementById("googleLoginBtn");

const loginError =
    document.getElementById("loginError");


function showError(message) {

    loginError.textContent = message;

}


loginForm.addEventListener("submit", async (event) => {

    event.preventDefault();

    showError("");

    const email =
        document.getElementById("email").value.trim();

    const password =
        document.getElementById("password").value;


    try {

        await loginWithEmail(
            email,
            password
        );

        window.location.href =
            "../../pages/dashboard/dashboard.html";

    } catch (error) {

        console.error(error);

        showError(
            "Unable to sign in. Please check your email and password."
        );

    }

});


googleLoginBtn.addEventListener(
    "click",
    async () => {

        showError("");

        try {

            await loginWithGoogle();

            window.location.href =
                "../../pages/dashboard/dashboard.html";

        } catch (error) {

            console.error(error);

            showError(
                "Google sign-in failed. Please try again."
            );

        }

    }
);