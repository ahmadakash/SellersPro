
import { auth, db } from "../config/firebase.js";

import {
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";

import {
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

const loginForm = document.getElementById("adminLoginForm");
const loginMessage = document.getElementById("loginMessage");
const loginButton = document.getElementById("adminLoginBtn");
const passwordInput = document.getElementById("adminPassword");
const togglePassword = document.getElementById("togglePassword");

function showMessage(message) {
  loginMessage.textContent = message;
  loginMessage.hidden = false;
}

function hideMessage() {
  loginMessage.textContent = "";
  loginMessage.hidden = true;
}

async function verifyAdmin(user) {
  const adminRef = doc(db, "adminUsers", user.uid);
  const adminSnapshot = await getDoc(adminRef);

  if (!adminSnapshot.exists()) return false;

  const adminData = adminSnapshot.data();

  return adminData.active === true &&
    ["superadmin", "admin"].includes(adminData.role);
}

// Existing authenticated user check
onAuthStateChanged(auth, async (user) => {
  if (!user) return;

  try {
    const isAdmin = await verifyAdmin(user);

    if (isAdmin) {
      window.location.replace("dashboard.html");
    } else {
      await signOut(auth);
    }
  } catch (error) {
    console.error("Admin verification error:", error);
  }
});

togglePassword.addEventListener("click", () => {
  const isPassword = passwordInput.type === "password";
  passwordInput.type = isPassword ? "text" : "password";

  togglePassword.innerHTML = isPassword
    ? '<i class="bi bi-eye-slash"></i>'
    : '<i class="bi bi-eye"></i>';
});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  hideMessage();

  const email = document.getElementById("adminEmail").value.trim();
  const password = passwordInput.value;

  loginButton.disabled = true;
  loginButton.innerHTML = '<span>Verifying access...</span><i class="bi bi-arrow-repeat"></i>';

  try {
    const credential = await signInWithEmailAndPassword(
      auth,
      email,
      password
    );

    const isAdmin = await verifyAdmin(credential.user);

    if (!isAdmin) {
      await signOut(auth);
      throw new Error("This account is not authorized to access the Admin Panel.");
    }

    window.location.replace("dashboard.html");

  } catch (error) {
    console.error("Admin login error:", error);

    const message = error.code === "auth/invalid-credential"
      ? "Invalid email or password."
      : error.code === "auth/too-many-requests"
        ? "Too many attempts. Please try again later."
        : error.message || "Login failed. Please try again.";

    showMessage(message);

  } finally {
    loginButton.disabled = false;
    loginButton.innerHTML = '<span>Sign in to Admin Panel</span><i class="bi bi-arrow-right"></i>';
  }
});
