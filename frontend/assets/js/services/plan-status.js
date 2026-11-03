import { auth, db } from "../config/firebase.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";

import {
  doc,
  getDoc,
  updateDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

/* =========================================
   DATE HELPER
========================================= */

function getDate(value) {
  if (!value) return null;

  if (typeof value.toDate === "function") {
    return value.toDate();
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

/* =========================================
   CHECK PRO SUBSCRIPTION
========================================= */

function getActivePro(profile) {
  const plan = String(
    profile.plan || profile.subscriptionPlan || "free"
  ).toLowerCase();

  const status = String(
    profile.subscriptionStatus || ""
  ).toLowerCase();

  const endDate = getDate(
    profile.subscriptionEnd ||
    profile.subscriptionEndDate ||
    profile.currentPeriodEnd
  );

  return (
    plan === "pro" &&
    status === "active" &&
    endDate !== null &&
    endDate.getTime() > Date.now()
  );
}

/* =========================================
   UPDATE PLAN CARD
========================================= */

function updatePlanCard(profile) {
  const name = document.getElementById("sidebarPlanName");
  const description = document.getElementById("sidebarPlanDescription");
  const limit = document.getElementById("sidebarPlanLimit");
  const action = document.getElementById("planCardAction");
  const icon = document.querySelector("#sellerPlanCard .plan-icon i");

  if (!name || !description || !limit) return;

  const isPro = getActivePro(profile);

  name.textContent = isPro ? "Pro plan" : "Free plan";

  description.textContent = isPro
    ? "Your Pro subscription is active."
    : "Upgrade to unlock unlimited orders.";

  limit.textContent = isPro
    ? "Unlimited orders"
    : "Order limit: 10 orders / month";

  if (action) {
    action.textContent = isPro ? "Manage" : "Upgrade";
  }

  if (icon) {
    icon.className = isPro
      ? "bi bi-gem"
      : "bi bi-stars";
  }
}

/* =========================================
   EXPIRE SUBSCRIPTION
========================================= */

async function expireSubscription(profileRef, profile) {
  const plan = String(profile.plan || "").toLowerCase();

  const status = String(
    profile.subscriptionStatus || ""
  ).toLowerCase();

  const endDate = getDate(
    profile.subscriptionEnd ||
    profile.subscriptionEndDate ||
    profile.currentPeriodEnd
  );

  const isExpired =
    plan === "pro" &&
    status === "active" &&
    endDate !== null &&
    endDate.getTime() <= Date.now();

  if (!isExpired) return profile;

  await updateDoc(profileRef, {
    plan: "free",
    subscriptionStatus: "expired",
    updatedAt: serverTimestamp()
  });

  return {
    ...profile,
    plan: "free",
    subscriptionStatus: "expired"
  };
}

/* =========================================
   AUTH INITIALIZATION
========================================= */

onAuthStateChanged(auth, async (user) => {
  if (!user) return;

  try {
    const profileRef = doc(db, "users", user.uid);

    const snapshot = await getDoc(profileRef);

    if (!snapshot.exists()) return;

    let profile = snapshot.data();

    // Automatically change expired Pro profile to Free
    // when the seller loads a page using this service.
    profile = await expireSubscription(profileRef, profile);

    updatePlanCard(profile);

  } catch (error) {
    console.error("Plan status load failed:", error);
  }
});