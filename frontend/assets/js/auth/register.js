import {
    registerWithEmail
} from "../services/auth-service.js";


const registerForm =
    document.getElementById("registerForm");


registerForm.addEventListener(
    "submit",
    async function (event) {

        event.preventDefault();


        const name =
            document.getElementById("name")
                .value
                .trim();

        const email =
            document.getElementById("email")
                .value
                .trim();

        const password =
            document.getElementById("password")
                .value;


        try {

            await registerWithEmail(
                name,
                email,
                password
            );


            alert(
                "Account created successfully!"
            );


            window.location.href =
                "../dashboard/dashboard.html";


        } catch (error) {

            console.error(error);

            alert(
                "Registration failed. Please try again."
            );
        }

    }
);