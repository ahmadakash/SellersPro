import { onAuthStateChanged } from
  "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  updateDoc
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

import { auth, db } from "../config/firebase.js";
import { logoutUser } from "../services/auth-service.js";

const $ = (id) => document.getElementById(id);

const userName = $("userName");
const userBusiness = $("userBusiness");
const userAvatar = $("userAvatar");
const welcomeName = $("welcomeName");
const logoutBtn = $("logoutBtn");
const dashboardNotice = $("dashboardNotice");

const profileTrigger = $("profileTrigger");
const profileModal = $("profileModal");
const profileForm = $("profileForm");
const profileName = $("profileName");
const profileBusinessName = $("profileBusinessName");
const profileEmail = $("profileEmail");
const profilePhone = $("profilePhone");
const profileFeedback = $("profileFeedback");
const saveProfileBtn = $("saveProfileBtn");

let currentUser = null;
let currentProfile = {};

function showNotice(message, type = "error") {
  dashboardNotice.textContent = message;
  dashboardNotice.hidden = false;
  dashboardNotice.classList.toggle("error", type === "error");
}

function clearNotice() {
  dashboardNotice.hidden = true;
  dashboardNotice.textContent = "";
}

function showUserProfile(user, profile = {}) {
  const fullName =
    profile.name || user.displayName || user.email || "Seller";

  const businessName = profile.businessName || "My business";

  userName.textContent = fullName;
  userBusiness.textContent = businessName;
  welcomeName.textContent = fullName.trim().split(/\s+/)[0] || "Seller";
  userAvatar.textContent = fullName.trim().charAt(0).toUpperCase() || "S";
}

function showProfileFeedback(message, type = "error") {
  profileFeedback.textContent = message;
  profileFeedback.className = `profile-feedback ${type}`;
  profileFeedback.hidden = false;
}

function clearProfileFeedback() {
  profileFeedback.hidden = true;
  profileFeedback.textContent = "";
  profileFeedback.className = "profile-feedback";
}

/* Load dashboard numbers from the signed-in seller's own collections. */
async function loadDashboardStats(uid) {
  const requiredIds = [
    "totalProducts",
    "totalCustomers",
    "totalOrders",
    "lowStockItems"
  ];

  const missingIds = requiredIds.filter((id) => !$(id));

  if (missingIds.length > 0) {
    throw new Error(
      `Dashboard HTML is missing these elements: ${missingIds.join(", ")}`
    );
  }

  const productsRef = collection(db, "users", uid, "products");
  const customersRef = collection(db, "users", uid, "customers");
  const ordersRef = collection(db, "users", uid, "orders");

  const [productsSnapshot, customersSnapshot, ordersSnapshot] =
    await Promise.all([
      getDocs(productsRef),
      getDocs(customersRef),
      getDocs(ordersRef)
    ]);

  const products = productsSnapshot.docs.map((item) => item.data());

  const lowStockCount = products.filter((product) => {
    const stock = Number(product.stock ?? 0);
    const threshold = Number(product.lowStockThreshold ?? 5);
    return Number.isFinite(stock) &&
      Number.isFinite(threshold) &&
      stock <= threshold;
  }).length;

  $("totalProducts").textContent = productsSnapshot.size;
  $("totalCustomers").textContent = customersSnapshot.size;
  $("totalOrders").textContent = ordersSnapshot.size;
  $("lowStockItems").textContent = lowStockCount;
}

/* Profile interface */
function openProfile() {
  if (!currentUser) return;

  clearProfileFeedback();

  profileName.value =
    currentProfile.name || currentUser.displayName || "";

  profileBusinessName.value =
    currentProfile.businessName || "";

  profileEmail.value =
    currentUser.email || currentProfile.email || "";

  profilePhone.value =
    currentProfile.phone || currentUser.phoneNumber || "";

  profileModal.hidden = false;
  document.body.style.overflow = "hidden";
  profileName.focus();
}

function closeProfile() {
  profileModal.hidden = true;
  document.body.style.overflow = "";
  profileTrigger.focus();
}

profileTrigger.addEventListener("click", openProfile);

$("closeProfileBtn").addEventListener("click", closeProfile);
$("cancelProfileBtn").addEventListener("click", closeProfile);

profileModal.querySelector("[data-close-profile]")
  .addEventListener("click", closeProfile);

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !profileModal.hidden) {
    closeProfile();
  }
});

/* Save editable profile fields to users/{uid}. */
profileForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!currentUser) return;

  const name = profileName.value.trim();
  const businessName = profileBusinessName.value.trim();
  const phone = profilePhone.value.trim();

  if (!name || !businessName) {
    showProfileFeedback(
      "Full name and business name are required."
    );
    return;
  }

  saveProfileBtn.disabled = true;
  saveProfileBtn.textContent = "Saving...";
  clearProfileFeedback();

  try {
    const profileRef = doc(db, "users", currentUser.uid);

    await updateDoc(profileRef, {
      name,
      businessName,
      phone,
      updatedAt: serverTimestamp()
    });

    currentProfile = {
      ...currentProfile,
      name,
      businessName,
      phone
    };

    showUserProfile(currentUser, currentProfile);
    showProfileFeedback("Profile updated successfully.", "success");

    // Close after a short moment so the success message can be seen.
    window.setTimeout(() => {
      if (!profileModal.hidden) closeProfile();
    }, 800);
  } catch (error) {
    console.error("Saving profile failed:", error);

    showProfileFeedback(
      "Could not save your profile. Check your connection and Firestore rules."
    );
  } finally {
    saveProfileBtn.disabled = false;
    saveProfileBtn.textContent = "Save changes";
  }
});

/* Authentication and page initialization */
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.replace("../auth/login.html");
    return;
  }

  currentUser = user;
  clearNotice();

  // Show basic Auth details while Firestore is loading.
  showUserProfile(user);

  try {
    const profileRef = doc(db, "users", user.uid);
    const profileSnapshot = await getDoc(profileRef);

    if (profileSnapshot.exists()) {
      currentProfile = profileSnapshot.data();
      showUserProfile(user, currentProfile);
    } else {
      currentProfile = {};
      showNotice(
        "Your seller profile record was not found. Please check registration."
      );
    }

    await loadDashboardStats(user.uid);
  } catch (error) {
    console.error("Dashboard initialization failed:", error);

    showNotice(
      "Dashboard data could not be loaded. Check your connection and Firestore rules."
    );
  }
});

/* Logout */
logoutBtn.addEventListener("click", async () => {
  logoutBtn.disabled = true;

  try {
    await logoutUser();
    window.location.replace("../auth/login.html");
  } catch (error) {
    console.error("Logout failed:", error);
    showNotice("Logout failed. Please try again.");
    logoutBtn.disabled = false;
  }
});

/* Mobile sidebar */
const sidebar = $("sidebar");
const sidebarOverlay = $("sidebarOverlay");
const menuToggle = $("menuToggle");

function closeSidebar() {
  sidebar.classList.remove("open");
  sidebarOverlay.classList.remove("show");
}

menuToggle.addEventListener("click", () => {
  sidebar.classList.toggle("open");
  sidebarOverlay.classList.toggle("show");
});

sidebarOverlay.addEventListener("click", closeSidebar);

/* Existing not-yet-built navigation */
document.querySelectorAll("[data-coming-soon]").forEach((element) => {
  element.addEventListener("click", (event) => {
    event.preventDefault();

    showNotice(
      `${element.dataset.comingSoon} page is not connected yet.`,
      "info"
    );

    closeSidebar();
  });
});