
import { auth, db } from "../config/firebase.js";

import {
  onAuthStateChanged,
  signOut,
  sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";

import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

// ========================================
// SellersPro Settings
// ========================================

const $ = (id) => document.getElementById(id);

const notice = $("settingsNotice");

let currentUser = null;
let profileData = {};
let isSaving = false;

// ========================================
// Notifications
// ========================================

let noticeTimer = null;

function showNotice(message, type = "info") {
  if (!notice) return;

  clearTimeout(noticeTimer);

  notice.textContent = message;
  notice.className = "settings-notice";

  if (type === "success") {
    notice.classList.add("success");
  } else if (type === "error") {
    notice.classList.add("error");
  }

  notice.hidden = false;

  // Mobile: notice is at the top, so bring it into view
  notice.scrollIntoView({ behavior: "smooth", block: "center" });

  if (type === "success") {
    noticeTimer = setTimeout(hideNotice, 4000);
  }
}

function hideNotice() {
  if (!notice) return;

  clearTimeout(noticeTimer);
  notice.hidden = true;
  notice.textContent = "";
  notice.className = "settings-notice";
}

function setButtonLoading(button, loading, loadingText = "Saving...") {
  if (!button) return;

  if (loading) {
    button.dataset.originalText = button.innerHTML;
    button.innerHTML = `<span class="spinner-border spinner-border-sm" aria-hidden="true"></span> ${loadingText}`;
    button.disabled = true;
  } else {
    if (button.dataset.originalText) {
      button.innerHTML = button.dataset.originalText;
      delete button.dataset.originalText;
    }

    button.disabled = false;
  }
}

// ========================================
// Firestore profile reference
// ========================================

function getUserDocRef() {
  if (!currentUser) {
    throw new Error("You must be logged in.");
  }

  return doc(db, "users", currentUser.uid);
}

// ========================================
// Load Settings
// ========================================

async function loadSettings(user) {
  currentUser = user;

  try {
    const snapshot = await getDoc(getUserDocRef());

    profileData = snapshot.exists() ? snapshot.data() : {};

    const displayName =
      profileData.fullName ||
      profileData.name ||
      user.displayName ||
      "";

    const businessName = profileData.businessName || "";
    const phone = profileData.phone || "";
    const address = profileData.businessAddress || "";

    $("ownerName").value = displayName;
    $("accountName").value = displayName;
    $("businessName").value = businessName;
    $("businessPhone").value = phone;
    $("businessAddress").value = address;
    $("accountEmail").value = user.email || profileData.email || "";

    // Existing dashboard header
    if ($("userName")) {
      $("userName").textContent = displayName || "My Account";
    }

    if ($("userBusiness")) {
      $("userBusiness").textContent = businessName || "Your Business";
    }

    if ($("userAvatar")) {
      const initials = (displayName || user.email || "U")
        .trim()
        .charAt(0)
        .toUpperCase();

      $("userAvatar").textContent = initials;
    }

    // Notification preferences
    const preferences = profileData.notificationPreferences || {};

    $("lowStockAlerts").checked =
      preferences.lowStockAlerts !== false;

    $("orderAlerts").checked =
      preferences.orderAlerts !== false;

    hideNotice();
  } catch (error) {
    console.error("Failed to load settings:", error);

    showNotice(
      "Could not load your settings. Please refresh and try again.",
      "error"
    );
  }
}

// ========================================
// Save Business Information
// ========================================

async function saveBusinessInformation(event) {
  event.preventDefault();

  if (!currentUser || isSaving) return;

  hideNotice();

  const businessName = $("businessName").value.trim();
  const ownerName = $("ownerName").value.trim();
  const phone = $("businessPhone").value.trim();
  const address = $("businessAddress").value.trim();

  if (!businessName || !ownerName) {
    showNotice("Please enter your business name and owner name.", "error");
    return;
  }
  if (phone && !/^[0-9+\-\s()]{6,25}$/.test(phone)) {
    showNotice("Please enter a valid phone number.", "error");
    return;
  }

  const button = $("saveBusinessBtn");
  isSaving = true;
  setButtonLoading(button, true);

  try {
    const updates = {
      businessName,
      name: ownerName,
      fullName: ownerName,
      phone,
      businessAddress: address,
      updatedAt: serverTimestamp()
    };

    const ref = getUserDocRef();
    const snapshot = await getDoc(ref);

    if (snapshot.exists()) {
      await updateDoc(ref, updates);
    } else {
      await setDoc(ref, {
        ...updates,
        email: currentUser.email || ""
      });
    }

    profileData = { ...profileData, ...updates };

    if ($("userName")) {
      $("userName").textContent = ownerName;
    }

    if ($("userBusiness")) {
      $("userBusiness").textContent = businessName;
    }

    if ($("userAvatar")) {
      $("userAvatar").textContent = ownerName.charAt(0).toUpperCase();
    }

    if ($("accountName")) $("accountName").value = ownerName;

    showNotice("Business information saved successfully.", "success");
  } catch (error) {
    console.error("Business information save failed:", error);

    showNotice(
      "Unable to save business information. Check your Firebase permissions and try again.",
      "error"
    );
  } finally {
    isSaving = false;
    setButtonLoading(button, false);
  }
}

// ========================================
// Save Account Information
// ========================================

async function saveAccountInformation(event) {
  event.preventDefault();

  if (!currentUser || isSaving) return;

  hideNotice();

  const name = $("accountName").value.trim();

  if (!name) {
    showNotice("Please enter your full name.", "error");
    return;
  }

  const button = $("saveAccountBtn");
  isSaving = true;
  setButtonLoading(button, true);

  try {
    const updates = {
      name,
      fullName: name,
      updatedAt: serverTimestamp()
    };

    const ref = getUserDocRef();
    const snapshot = await getDoc(ref);

    if (snapshot.exists()) {
      await updateDoc(ref, updates);
    } else {
      await setDoc(ref, {
        ...updates,
        email: currentUser.email || "",
        businessName: "",
        phone: ""
      });
    }

    profileData = { ...profileData, ...updates };

    // Keep business form owner name in sync
    $("ownerName").value = name;

    if ($("userName")) {
      $("userName").textContent = name;
    }

    if ($("userAvatar")) {
      $("userAvatar").textContent = name.charAt(0).toUpperCase();
    }

    showNotice("Account information saved successfully.", "success");
  } catch (error) {
    console.error("Account information save failed:", error);

    showNotice(
      "Unable to save account information. Please try again.",
      "error"
    );
  } finally {
    isSaving = false;
    setButtonLoading(button, false);
  }
}

// ========================================
// Save Notification Preferences
// ========================================

async function saveNotificationPreferences(event) {
  event.preventDefault();

  if (!currentUser || isSaving) return;

  hideNotice();

  const button = $("saveNotificationsBtn");
  isSaving = true;
  setButtonLoading(button, true);

  try {
    const notificationPreferences = {
      lowStockAlerts: $("lowStockAlerts").checked,
      orderAlerts: $("orderAlerts").checked
    };

    const ref = getUserDocRef();
    const snapshot = await getDoc(ref);

    if (snapshot.exists()) {
      await updateDoc(ref, {
        notificationPreferences,
        updatedAt: serverTimestamp()
      });
    } else {
      await setDoc(ref, {
        email: currentUser.email || "",
        notificationPreferences,
        updatedAt: serverTimestamp()
      });
    }

    profileData = {
      ...profileData,
      notificationPreferences
    };

    showNotice("Notification preferences saved successfully.", "success");
  } catch (error) {
    console.error("Notification preferences save failed:", error);

    showNotice(
      "Unable to save notification preferences. Please try again.",
      "error"
    );
  } finally {
    isSaving = false;
    setButtonLoading(button, false);
  }
}

// ========================================
// Password Reset
// ========================================

async function resetPassword() {
  if (!currentUser) return;

  const email = currentUser.email;

  if (!email) {
    showNotice("Your account does not have an email address.", "error");
    return;
  }

  const button = $("resetPasswordBtn");

  hideNotice();
  setButtonLoading(button, true, "Sending...");

  try {
    await sendPasswordResetEmail(auth, email);

    showNotice(
      `Password reset email sent to ${email}. Check your inbox and spam folder.`,
      "success"
    );
  } catch (error) {
    console.error("Password reset failed:", error);

    if (error.code === "auth/too-many-requests") {
      showNotice(
        "Too many attempts. Please wait before trying again.",
        "error"
      );
    } else {
      showNotice(
        "Could not send the reset email. Check your account and Firebase Authentication settings.",
        "error"
      );
    }
  } finally {
    setButtonLoading(button, false);
  }
}

// ========================================
// Sidebar Navigation
// ========================================

function setupNavigation() {
  const sidebar = $("sidebar");
  const overlay = $("sidebarOverlay");
  const menuToggle = $("menuToggle");

  function closeSidebar() {
    sidebar?.classList.remove("open");
    overlay?.classList.remove("show");
  }

  menuToggle?.addEventListener("click", (event) => {
    event.stopPropagation();
    if (!sidebar) return;

    const open = !sidebar.classList.contains("open");
    sidebar.classList.toggle("open", open);
    overlay?.classList.toggle("show", open);
  });

  overlay?.addEventListener("click", closeSidebar);

  document.querySelectorAll("#sidebar a").forEach((link) => {
    link.addEventListener("click", closeSidebar);
  });

  // Click anywhere outside the sidebar closes it
  document.addEventListener("click", (event) => {
    if (!sidebar?.classList.contains("open")) return;
    if (event.target.closest("#sidebar") || event.target.closest("#menuToggle")) {
      return;
    }
    closeSidebar();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeSidebar();
  });

  // Reset when going back to desktop width
  window.addEventListener("resize", () => {
    if (window.innerWidth > 992) closeSidebar();
  });
}

// ========================================
// Profile button shortcut
// ========================================

function setupProfileShortcut() {
  $("profileTrigger")?.addEventListener("click", () => {
    const section = $("accountSection");
    if (!section) return;

    section.scrollIntoView({ behavior: "smooth", block: "start" });

    section.classList.add("flash");
    setTimeout(() => section.classList.remove("flash"), 1600);

    setTimeout(() => $("accountName")?.focus({ preventScroll: true }), 450);
  });
}

// ========================================
// Logout
// ========================================

function setupLogout() {
  $("logoutBtn")?.addEventListener("click", async () => {
    const button = $("logoutBtn");

    if (button) button.disabled = true;

    try {
      await signOut(auth);
      window.location.href = "../auth/login.html";
    } catch (error) {
      console.error("Logout failed:", error);

      showNotice("Logout failed. Please try again.", "error");

      if (button) button.disabled = false;
    }
  });
}

// ========================================
// Initialize
// ========================================

function setupForms() {
  $("businessForm")?.addEventListener(
    "submit",
    saveBusinessInformation
  );

  $("accountForm")?.addEventListener(
    "submit",
    saveAccountInformation
  );

  $("notificationsForm")?.addEventListener(
    "submit",
    saveNotificationPreferences
  );

  $("resetPasswordBtn")?.addEventListener("click", resetPassword);
}

function initializeSettings() {
  setupForms();
  setupNavigation();
  setupProfileShortcut();
  setupLogout();

  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.href = "../auth/login.html";
      return;
    }

    await loadSettings(user);
  });
}

initializeSettings();
