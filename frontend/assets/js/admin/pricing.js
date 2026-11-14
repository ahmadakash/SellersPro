import { auth, db } from "../config/firebase.js";

import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";

import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

const $ = (id) => document.getElementById(id);

const pricingRef = doc(db, "platformSettings", "billing");

let currentAdmin = null;

const DEFAULT_PRICING = {
  monthlyPrice: 100,
  yearlyPrice: 1000,
  freeOrderLimit: 10,
  currency: "BDT"
};

function showNotice(message, type = "success") {
  const notice = $("pricingNotice");

  notice.className = `admin-alert ${type}`;
  notice.textContent = message;
  notice.hidden = false;
}

function formatMoney(amount) {
  return `৳${Number(amount).toLocaleString("en-BD")}`;
}

function displayPricing(data) {
  $("monthlyPrice").value = data.monthlyPrice;
  $("yearlyPrice").value = data.yearlyPrice;
  $("freeOrderLimit").value = data.freeOrderLimit;

  $("monthlyPricePreview").textContent =
    formatMoney(data.monthlyPrice);

  $("yearlyPricePreview").textContent =
    formatMoney(data.yearlyPrice);

  $("freeLimitPreview").textContent =
    data.freeOrderLimit;
}

async function loadPricing() {
  const snapshot = await getDoc(pricingRef);

  const data = snapshot.exists()
    ? { ...DEFAULT_PRICING, ...snapshot.data() }
    : DEFAULT_PRICING;

  displayPricing(data);

  if (snapshot.exists() && data.updatedAt?.toDate) {
    $("pricingUpdatedAt").textContent =
      `Last updated: ${data.updatedAt.toDate().toLocaleString()}`;
  } else {
    $("pricingUpdatedAt").textContent =
      "Default pricing — not saved to Firebase yet.";
  }
}

async function savePricing(event) {
  event.preventDefault();

  if (!currentAdmin) return;

  const monthlyPrice = Number($("monthlyPrice").value);
  const yearlyPrice = Number($("yearlyPrice").value);
  const freeOrderLimit = Number($("freeOrderLimit").value);

  if (
    !Number.isSafeInteger(monthlyPrice) ||
    !Number.isSafeInteger(yearlyPrice) ||
    !Number.isSafeInteger(freeOrderLimit) ||
    monthlyPrice < 1 ||
    yearlyPrice < 1 ||
    freeOrderLimit < 1
  ) {
    showNotice("Please enter valid positive whole numbers.", "danger");
    return;
  }

  const saveButton = $("savePricingBtn");
  saveButton.disabled = true;
  saveButton.innerHTML =
    '<span class="spinner-border spinner-border-sm"></span> Saving...';

  try {
    await setDoc(pricingRef, {
      monthlyPrice,
      yearlyPrice,
      freeOrderLimit,
      currency: "BDT",
      updatedAt: serverTimestamp(),
      updatedBy: currentAdmin.uid,
      updatedByEmail: currentAdmin.email || ""
    }, { merge: true });

    displayPricing({
      monthlyPrice,
      yearlyPrice,
      freeOrderLimit
    });

    $("pricingUpdatedAt").textContent =
      "Pricing saved successfully.";

    showNotice("Plan pricing updated successfully.");

  } catch (error) {
    console.error("Pricing save error:", error);

    showNotice(
      error.code === "permission-denied"
        ? "Permission denied. Check the platformSettings Firestore rules."
        : "Could not save pricing. Please try again.",
      "danger"
    );

  } finally {
    saveButton.disabled = false;
    saveButton.innerHTML =
      '<i class="bi bi-check2-circle"></i> Save Pricing';
  }
}

/* Preview updates */

["monthlyPrice", "yearlyPrice", "freeOrderLimit"].forEach((id) => {
  $(id).addEventListener("input", () => {
    const monthly = Number($("monthlyPrice").value);
    const yearly = Number($("yearlyPrice").value);
    const limit = Number($("freeOrderLimit").value);

    $("monthlyPricePreview").textContent =
      formatMoney(monthly || 0);

    $("yearlyPricePreview").textContent =
      formatMoney(yearly || 0);

    $("freeLimitPreview").textContent = limit || 0;
  });
});

$("pricingForm").addEventListener("submit", savePricing);

$("refreshPricingBtn").addEventListener("click", async () => {
  try {
    await loadPricing();
    showNotice("Pricing information refreshed.");
  } catch (error) {
    console.error(error);
    showNotice("Could not refresh pricing.", "danger");
  }
});

/* Sidebar */

$("menuToggle").addEventListener("click", () => {
  $("sidebar").classList.toggle("open");
  $("sidebarOverlay").classList.toggle("show");
});

$("sidebarOverlay").addEventListener("click", () => {
  $("sidebar").classList.remove("open");
  $("sidebarOverlay").classList.remove("show");
});

/* Logout */

$("adminLogoutBtn").addEventListener("click", async () => {
  try {
    await signOut(auth);
    window.location.replace("login.html");
  } catch (error) {
    console.error(error);
    alert("Unable to log out.");
  }
});

/* Admin authentication */

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.replace("login.html");
    return;
  }

  try {
    const adminSnapshot = await getDoc(
      doc(db, "adminUsers", user.uid)
    );

    if (!adminSnapshot.exists()) {
      await signOut(auth);
      window.location.replace("login.html");
      return;
    }

    const adminData = adminSnapshot.data();

    if (
      adminData.active !== true ||
      !["superadmin", "admin"].includes(adminData.role)
    ) {
      await signOut(auth);
      window.location.replace("login.html");
      return;
    }

    currentAdmin = user;

    $("adminName").textContent =
      adminData.name || "Administrator";

    $("adminEmailLabel").textContent =
      user.email || "";

    await loadPricing();

  } catch (error) {
    console.error("Admin initialization error:", error);
    showNotice("Could not initialize pricing settings.", "danger");
  }
});