import { auth, db } from "../config/firebase.js";

import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

const $ = (id) => document.getElementById(id);

/* Change this if your payment requests live in a different collection */
const PAYMENT_COLLECTION = "payments";

const sidebar = $("sidebar");
const overlay = $("sidebarOverlay");
const menuToggle = $("menuToggle");
const logoutButton = $("adminLogoutBtn");

/* ---------------------------------------------
   Sidebar + logout
--------------------------------------------- */

function closeSidebar() {
  sidebar.classList.remove("open");
  overlay.classList.remove("show");
}

menuToggle.addEventListener("click", () => {
  sidebar.classList.toggle("open");
  overlay.classList.toggle("show");
});

overlay.addEventListener("click", closeSidebar);

logoutButton.addEventListener("click", async () => {
  logoutButton.disabled = true;

  try {
    await signOut(auth);
    window.location.replace("login.html");
  } catch (error) {
    console.error("Admin logout error:", error);
    logoutButton.disabled = false;
    alert("Unable to log out. Please try again.");
  }
});

/* ---------------------------------------------
   Notice
--------------------------------------------- */

function showNotice(message) {
  $("adminNotice").textContent = message;
  $("adminNotice").hidden = false;
}

function hideNotice() {
  $("adminNotice").hidden = true;
  $("adminNotice").textContent = "";
}

/* ---------------------------------------------
   Stats
--------------------------------------------- */

// ---- stats:start (pure logic, no DOM) ----

const isBlocked = (seller) =>
  seller.accountStatus === "blocked" || seller.isBlocked === true;

// A seller counts as an active subscriber when they are on a paid plan
// and the subscription has not been marked expired / cancelled.
function hasActiveSubscription(seller) {
  const plan = String(seller.plan || "free").trim().toLowerCase();
  if (!plan || plan === "free") return false;

  const status = String(seller.subscriptionStatus || "active").trim().toLowerCase();
  return status === "active";
}

function computeSellerStats(sellers) {
  return {
    total: sellers.length,
    blocked: sellers.filter(isBlocked).length,
    subscribed: sellers.filter(hasActiveSubscription).length
  };
}

// ---- stats:end ----

const formatNumber = (value) => Number(value).toLocaleString("en-US");

function setStat(id, value, title = "") {
  const element = $(id);
  if (!element) return;

  element.textContent = value;
  element.title = title;
}

function setLoadingStats() {
  ["totalSellers", "activeSubscriptions", "pendingRequests", "blockedSellers"]
    .forEach((id) => setStat(id, "…"));
}

function setPendingBadge(count) {
  const badge = $("pendingPaymentCount");
  if (!badge) return;

  badge.textContent = count === null ? "—" : formatNumber(count);
  badge.hidden = count === 0;
}

async function loadStats() {
  hideNotice();
  setLoadingStats();

  const [sellersResult, pendingResult] = await Promise.allSettled([
    getDocs(collection(db, "users")),
    getDocs(
      query(collection(db, PAYMENT_COLLECTION), where("status", "==", "pending"))
    )
  ]);

  // ---- Sellers: total, blocked, active subscriptions ----
  if (sellersResult.status === "fulfilled") {
    const sellers = sellersResult.value.docs.map((item) => ({
      id: item.id,
      ...item.data()
    }));

    const stats = computeSellerStats(sellers);

    setStat("totalSellers", formatNumber(stats.total));
    setStat("blockedSellers", formatNumber(stats.blocked));
    setStat("activeSubscriptions", formatNumber(stats.subscribed));
  } else {
    console.error("Loading sellers failed:", sellersResult.reason);

    ["totalSellers", "blockedSellers", "activeSubscriptions"]
      .forEach((id) => setStat(id, "—"));

    showNotice(
      sellersResult.reason?.code === "permission-denied"
        ? "Permission denied while loading sellers. Check the Firestore admin read rules."
        : "Could not load platform statistics. Please refresh and try again."
    );
  }

  // ---- Pending payment requests ----
  if (pendingResult.status === "fulfilled") {
    const count = pendingResult.value.size;

    setStat("pendingRequests", formatNumber(count));
    setPendingBadge(count);
  } else {
    // The payments collection is not set up yet, or admin cannot read it.
    console.warn("Loading payment requests failed:", pendingResult.reason);

    setStat(
      "pendingRequests",
      "—",
      "Payment requests are not available yet."
    );
    setPendingBadge(null);
  }
}

/* ---------------------------------------------
   Auth
--------------------------------------------- */

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.replace("login.html");
    return;
  }

  try {
    const adminSnapshot = await getDoc(doc(db, "adminUsers", user.uid));

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

    $("adminName").textContent = adminData.name || "Administrator";
    $("adminEmailLabel").textContent = user.email || "";

    await loadStats();
  } catch (error) {
    console.error("Admin authorization failed:", error);

    showNotice("Unable to verify Admin access. Please refresh or sign in again.");
  }
});