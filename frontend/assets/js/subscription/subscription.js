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
  where,
  writeBatch,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

const $ = (id) => document.getElementById(id);

const DEFAULT_BILLING = {
  monthlyPrice: 100,
  yearlyPrice: 1000,
  freeOrderLimit: 10,
  currency: "BDT"
};

let currentUser = null;
let sellerProfile = {};
let billing = { ...DEFAULT_BILLING };
let selectedCycle = "monthly";
let isSubmitting = false;

function money(amount) {
  return `৳${Number(amount || 0).toLocaleString("en-BD")}`;
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

function showNotice(message, type = "info") {
  const notice = $("subscriptionNotice");
  notice.textContent = message;
  notice.className = `subscription-notice ${type}`;
  notice.hidden = false;
  notice.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function hideNotice() {
  $("subscriptionNotice").hidden = true;
}

function getCurrentPlan() {
  const rawPlan = String(
    sellerProfile.plan ||
    sellerProfile.subscriptionPlan ||
    "Free"
  ).toLowerCase();

  return rawPlan === "pro" ? "Pro" : "Free";
}

function getSubscriptionStatus() {
  return String(sellerProfile.subscriptionStatus || "free").toLowerCase();
}

function getSubscriptionEnd() {
  const value =
    sellerProfile.subscriptionEnd ||
    sellerProfile.subscriptionEndDate ||
    sellerProfile.currentPeriodEnd ||
    null;

  if (!value) return null;

  if (typeof value.toDate === "function") return value.toDate();

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isSubscriptionActive() {
  if (getCurrentPlan() !== "Pro") return false;

  const status = getSubscriptionStatus();
  const endDate = getSubscriptionEnd();

  if (["expired", "cancelled", "rejected", "blocked"].includes(status)) {
    return false;
  }

  if (endDate && endDate.getTime() < Date.now()) {
    return false;
  }

  return status === "active" || status === "approved" || !status;
}

function updateCurrentPlanUI() {
  const plan = getCurrentPlan();
  const active = isSubscriptionActive();
  const endDate = getSubscriptionEnd();

  $("currentPlanName").textContent =
    plan === "Pro" && active ? "Pro Plan" : "Free Plan";

  $("currentPlanDescription").textContent =
    plan === "Pro" && active
      ? "Your Pro subscription is active."
      : "You are currently using the Free plan.";

  const statusText =
    plan === "Pro" && active
      ? "Active"
      : plan === "Pro"
        ? "Expired"
        : "Free";

  $("currentPlanStatus").textContent = statusText;
  $("currentPlanStatus").className =
    `status-pill ${statusText.toLowerCase()}`;

  $("subscriptionExpiry").textContent =
    plan === "Pro" && active && endDate
      ? `Valid until ${endDate.toLocaleDateString()}`
      : plan === "Pro" && active
        ? "Subscription active"
        : "10 orders per month on Free";

  $("sidebarPlanName").textContent =
    plan === "Pro" && active ? "Pro plan" : "Free plan";

  $("sidebarPlanDescription").textContent =
    plan === "Pro" && active
      ? "Your business is on Pro."
      : "Upgrade to unlock more.";

  $("sidebarPlanLimit").textContent =
    plan === "Pro" && active
      ? "Unlimited orders"
      : `${billing.freeOrderLimit} orders / month`;

  $("freePlanButton").textContent =
    plan === "Free" ? "Your current plan" : "Free plan";

  $("upgradeBtn").disabled = plan === "Pro" && active;

  if (plan === "Pro" && active) {
    $("upgradeBtn").innerHTML =
      '<span>Pro plan active</span><i class="bi bi-check-circle"></i>';
  }
}

async function loadBillingSettings() {
  try {
    const settingsRef = doc(db, "platformSettings", "billing");
    const snapshot = await getDoc(settingsRef);

    if (snapshot.exists()) {
      const data = snapshot.data();

      billing = {
        monthlyPrice: Number(data.monthlyPrice ?? DEFAULT_BILLING.monthlyPrice),
        yearlyPrice: Number(data.yearlyPrice ?? DEFAULT_BILLING.yearlyPrice),
        freeOrderLimit: Number(data.freeOrderLimit ?? DEFAULT_BILLING.freeOrderLimit),
        currency: data.currency || "BDT"
      };
    }
  } catch (error) {
    console.warn("Could not load billing settings; using default prices.", error);
    billing = { ...DEFAULT_BILLING };
  }

  $("freeOrderFeature").textContent =
    `Up to ${billing.freeOrderLimit} orders per month`;

  updatePriceUI();
  updateCurrentPlanUI();
}

function getSelectedAmount() {
  return selectedCycle === "yearly"
    ? billing.yearlyPrice
    : billing.monthlyPrice;
}

function updatePriceUI() {
  const amount = getSelectedAmount();

  $("proPrice").innerHTML =
    `${money(amount)} <small>/ ${selectedCycle === "yearly" ? "year" : "month"}</small>`;

  $("proPriceNote").textContent =
    selectedCycle === "yearly"
      ? "Billed yearly after approval"
      : "Billed monthly after approval";

  document.querySelectorAll("[data-cycle]").forEach((button) => {
    button.classList.toggle(
      "active",
      button.dataset.cycle === selectedCycle
    );
  });

  $("selectedPlanLabel").textContent =
    `Pro ${selectedCycle === "yearly" ? "Yearly" : "Monthly"}`;

  $("selectedAmount").textContent = money(amount);
}

function openPaymentPanel() {
  if (getCurrentPlan() === "Pro" && isSubscriptionActive()) {
    showNotice("Your Pro subscription is already active.", "success");
    return;
  }

  hideNotice();
  updatePriceUI();
  $("paymentPanel").hidden = false;
  $("paymentPanel").scrollIntoView({ behavior: "smooth", block: "start" });
}

function closePaymentPanel() {
  $("paymentPanel").hidden = true;
}

function formatDate(value) {
  if (!value) return "—";

  const date = typeof value.toDate === "function"
    ? value.toDate()
    : new Date(value);

  if (Number.isNaN(date.getTime())) return "—";

  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}

function statusClass(status) {
  const normalized = String(status || "pending").toLowerCase();
  return ["pending", "approved", "rejected"].includes(normalized)
    ? normalized
    : "pending";
}

function renderHistory(payments) {
  const body = $("paymentHistoryBody");
  const mobile = $("paymentHistoryMobile");

  if (!payments.length) {
    body.innerHTML = `
      <tr><td colspan="7" class="table-message">
        No payment requests yet. Your submitted requests will appear here.
      </td></tr>
    `;
    mobile.innerHTML = `
      <div class="table-message">No payment requests yet.</div>
    `;
    return;
  }

  body.innerHTML = payments.map((payment) => {
    const status = statusClass(payment.status);
    return `
      <tr>
        <td><strong>${escapeHTML(payment.plan || "Pro")}</strong></td>
        <td>${escapeHTML(payment.billingCycle || "—")}</td>
        <td>${money(payment.amount)}</td>
        <td>${escapeHTML(payment.paymentMethod || "—")}</td>
        <td>${escapeHTML(payment.transactionId || "—")}</td>
        <td>${formatDate(payment.submittedAt || payment.createdAt)}</td>
        <td><span class="payment-status ${status}">${escapeHTML(status)}</span></td>
      </tr>
    `;
  }).join("");

  mobile.innerHTML = payments.map((payment) => {
    const status = statusClass(payment.status);
    return `
      <article class="history-mobile-card">
        <div class="mobile-card-top">
          <div>
            <strong>${escapeHTML(payment.plan || "Pro")} · ${escapeHTML(payment.billingCycle || "—")}</strong><br>
            <small>${formatDate(payment.submittedAt || payment.createdAt)}</small>
          </div>
          <span class="payment-status ${status}">${escapeHTML(status)}</span>
        </div>
        <div class="mobile-card-meta">
          <span><b>Amount</b>${money(payment.amount)}</span>
          <span><b>Method</b>${escapeHTML(payment.paymentMethod || "—")}</span>
          <span><b>Transaction ID</b>${escapeHTML(payment.transactionId || "—")}</span>
          <span><b>Sender number</b>${escapeHTML(payment.senderNumber || "—")}</span>
        </div>
      </article>
    `;
  }).join("");
}

async function loadPaymentHistory() {
  const body = $("paymentHistoryBody");
  body.innerHTML = `
    <tr><td colspan="7" class="table-message">Loading payment history...</td></tr>
  `;

  try {
    const paymentsQuery = query(
      collection(db, "payments"),
      where("sellerUid", "==", currentUser.uid)
    );

    const snapshot = await getDocs(paymentsQuery);

    const payments = snapshot.docs.map((paymentDoc) => ({
      id: paymentDoc.id,
      ...paymentDoc.data()
    }));

    payments.sort((a, b) => {
      const dateA = a.submittedAt?.toMillis?.() || 0;
      const dateB = b.submittedAt?.toMillis?.() || 0;
      return dateB - dateA;
    });

    renderHistory(payments);
  } catch (error) {
    console.error("Payment history error:", error);

    body.innerHTML = `
      <tr><td colspan="7" class="table-message">
        Could not load payment history. Please check your connection and Firestore rules.
      </td></tr>
    `;
    $("paymentHistoryMobile").innerHTML =
      '<div class="table-message">Could not load payment history.</div>';
  }
}

function validatePaymentForm() {
  const method = $("paymentMethod").value;
  const sender = $("senderNumber").value.trim();
  const transactionId = $("transactionId").value.trim();

  if (!method) {
    showNotice("Please select bKash or Nagad.", "error");
    return false;
  }

  if (!/^[0-9+\-\s]{8,20}$/.test(sender)) {
    showNotice("Please enter a valid sender mobile number.", "error");
    $("senderNumber").focus();
    return false;
  }

  if (transactionId.length < 5) {
    showNotice("Please enter a valid transaction ID.", "error");
    $("transactionId").focus();
    return false;
  }

  if (!$("paymentConfirm").checked) {
    showNotice("Please confirm your payment information.", "error");
    return false;
  }

  return true;
}

async function submitPaymentRequest(event) {
  event.preventDefault();

  if (isSubmitting || !validatePaymentForm()) return;

  const submitButton = $("submitPayment");
  const originalButton = submitButton.innerHTML;

  isSubmitting = true;
  submitButton.disabled = true;
  submitButton.innerHTML =
    '<span class="spinner-border spinner-border-sm"></span> Submitting...';

  try {
    const profileRef = doc(db, "users", currentUser.uid);
    const profileSnapshot = await getDoc(profileRef);

    if (!profileSnapshot.exists()) {
      throw new Error("Your seller profile was not found. Please contact support.");
    }

    sellerProfile = profileSnapshot.data();

    if (
      String(sellerProfile.accountStatus || "").toLowerCase() === "blocked" ||
      sellerProfile.isBlocked === true
    ) {
      throw new Error("Your account is currently blocked. Please contact SellersPro support.");
    }

    if (getCurrentPlan() === "Pro" && isSubscriptionActive()) {
      throw new Error("Your Pro subscription is already active.");
    }

    const amount = getSelectedAmount();

    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error("The selected plan price is not valid. Please contact support.");
    }

    const paymentRef = doc(collection(db, "payments"));
    const requestRef = doc(
      db,
      "users",
      currentUser.uid,
      "subscriptionRequests",
      paymentRef.id
    );

    const paymentData = {
      sellerUid: currentUser.uid,
      sellerName:
        sellerProfile.name ||
        sellerProfile.fullName ||
        currentUser.displayName ||
        "Seller",
      sellerEmail: currentUser.email || sellerProfile.email || "",

      plan: "Pro",
      billingCycle: selectedCycle,
      amount,
      currency: billing.currency || "BDT",

      paymentMethod: $("paymentMethod").value,
      senderNumber: $("senderNumber").value.trim(),
      transactionId: $("transactionId").value.trim(),

      status: "pending",
      submittedAt: serverTimestamp(),

      subscriptionStart: null,
      subscriptionEnd: null,
      verifiedAt: null,
      verifiedBy: null
    };

    const requestData = {
      paymentId: paymentRef.id,
      sellerUid: currentUser.uid,
      sellerName: paymentData.sellerName,
      sellerEmail: paymentData.sellerEmail,

      plan: paymentData.plan,
      billingCycle: paymentData.billingCycle,
      amount: paymentData.amount,
      currency: paymentData.currency,

      paymentMethod: paymentData.paymentMethod,
      senderNumber: paymentData.senderNumber,
      transactionId: paymentData.transactionId,

      status: "pending",
      createdAt: serverTimestamp(),
      submittedAt: serverTimestamp()
    };

    const batch = writeBatch(db);
    batch.set(paymentRef, paymentData);
    batch.set(requestRef, requestData);

    await batch.commit();

    $("paymentForm").reset();
    closePaymentPanel();

    showNotice(
      "Payment request submitted successfully. It will remain pending until Admin verifies your transaction.",
      "success"
    );

    await loadPaymentHistory();

  } catch (error) {
    console.error("Payment request error:", error);

    let message = error.message || "Could not submit payment request.";

    if (error.code === "permission-denied") {
      message = "Permission denied. Please check the latest Firestore payment rules.";
    }

    showNotice(message, "error");
  } finally {
    isSubmitting = false;
    submitButton.disabled = false;
    submitButton.innerHTML = originalButton;
  }
}

async function loadSeller(user) {
  currentUser = user;

  const profileSnapshot = await getDoc(doc(db, "users", user.uid));
  sellerProfile = profileSnapshot.exists() ? profileSnapshot.data() : {};

  const name =
    sellerProfile.fullName ||
    sellerProfile.name ||
    user.displayName ||
    "Seller";

  $("userName").textContent = name;
  $("userBusiness").textContent =
    sellerProfile.businessName || "Your business";
  $("userAvatar").textContent =
    name.trim().charAt(0).toUpperCase() || "S";

  await loadBillingSettings();
  updateCurrentPlanUI();
  await loadPaymentHistory();
}

/* Event listeners */

document.querySelectorAll("[data-cycle]").forEach((button) => {
  button.addEventListener("click", () => {
    selectedCycle = button.dataset.cycle;
    updatePriceUI();
  });
});

$("upgradeBtn").addEventListener("click", openPaymentPanel);
$("closePayment").addEventListener("click", closePaymentPanel);
$("cancelPayment").addEventListener("click", closePaymentPanel);
$("paymentForm").addEventListener("submit", submitPaymentRequest);
$("refreshHistory").addEventListener("click", loadPaymentHistory);

$("logoutBtn").addEventListener("click", async () => {
  await signOut(auth);
  window.location.href = "../auth/login.html";
});

$("menuToggle").addEventListener("click", () => {
  $("sidebar").classList.toggle("active");
  $("sidebarOverlay").classList.toggle("active");
});

$("sidebarOverlay").addEventListener("click", () => {
  $("sidebar").classList.remove("active");
  $("sidebarOverlay").classList.remove("active");
});

$("profileTrigger").addEventListener("click", () => {
  window.location.href = "../settings/settings.html";
});

/* Authentication */

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "../auth/login.html";
    return;
  }

  try {
    await loadSeller(user);
  } catch (error) {
    console.error("Subscription page initialization error:", error);
    showNotice(
      "Could not load your subscription information. Please refresh the page.",
      "error"
    );
  }
});