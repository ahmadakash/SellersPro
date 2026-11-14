import {
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";

import {
    auth
} from "../config/firebase.js";


onAuthStateChanged(
    auth,
    function (user) {

        if (!user) {

            window.location.href =
                "../auth/login.html";

        }

    }
);