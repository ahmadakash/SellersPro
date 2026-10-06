// this is the firebase config file , it initializes the firebase app and exports the auth and db objects for use in other parts of the application.
// it imports the firebaseConfig object from the firebase-config.js file.
import { initializeApp } from
    "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";

import { getAuth } from
    "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";

import { getFirestore } from
    "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

import { getStorage } from
    "https://www.gstatic.com/firebasejs/12.0.0/firebase-storage.js";

import { firebaseConfig } from "./firebase-config.js";


const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

export default app;