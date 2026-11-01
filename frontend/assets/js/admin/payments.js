import { auth, db } from "../config/firebase.js";

import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";

import {
  collection,
  doc,
  getDoc,
  getDocs
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

const $ = (id) => document.getElementById(id);

let allPayments = [];
let activeFilter = "all";

const modalElement = $("paymentDetailsModal");
const paymentModal = modalElement
  ? new bootstrap.Modal(modalElement)
  : null;

/* =========================================
   HELPERS
========================================= */

function escapeHTML(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function getDateValue(value) {
  if (!value) return 0;

  if (typeof value.toMillis === "function") {
    return value.toMillis();
  }

  if (typeof value.toDate === "function") {
    return value.toDate().getTime();
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function formatDate(value) {
  const timestamp = getDateValue(value);

  if (!timestamp) return "—";

  return new Date(timestamp).toLocaleString("en-BD", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function getStatus(payment) {
  return String(
    payment.paymentStatus || payment.status || "pending"
  ).toLowerCase();
}

function getAmount(payment) {
  const amount =
    payment.amount ??
    payment.price ??
    payment.paymentAmount;

  if (amount === undefined || amount === null || amount === "") {
    return "—";
  }

  return payment.currency === "BDT" || !payment.currency
    ? `৳${amount}`
    : `${payment.currency} ${amount}`;
}

function getMethod(payment) {
  return payment.paymentMethod || payment.method || "—";
}

function getSenderNumber(payment) {
  return (
    payment.senderNumber ||
    payment.phoneNumber ||
    payment.senderPhone ||
    "—"
  );
}

function getTransactionId(payment) {
  return (
    payment.transactionId ||
    payment.trxId ||
    payment.transactionID ||
    "—"
  );
}

function getSellerName(payment) {
  const profile = payment.sellerProfile || {};

  return (
    payment.sellerName ||
    profile.name ||
    profile.fullName ||
    profile.displayName ||
    profile.ownerName ||
    "Unknown Seller"
  );
}

function getSellerEmail(payment) {
  const profile = payment.sellerProfile || {};

  return (
    payment.sellerEmail ||
    profile.email ||
    "No email"
  );
}

function showFeedback(message) {
  const feedback = $("pageFeedback");
  if (!feedback) return;

  feedback.textContent = message;
  feedback.hidden = false;
}

function hideFeedback() {
  const feedback = $("pageFeedback");
  if (feedback) feedback.hidden = true;
}

/* =========================================
   ADMIN VERIFICATION
========================================= */

async function verifyAdmin(user) {
  const adminSnap = await getDoc(
    doc(db, "adminUsers", user.uid)
  );

  if (!adminSnap.exists()) return false;

  const admin = adminSnap.data();

  return (
    admin.active === true &&
    ["admin", "superadmin"].includes(admin.role)
  );
}

/* =========================================
   LOAD PAYMENTS FROM SEPARATE COLLECTION
========================================= */

async function loadPayments() {
  const loading = $("paymentsLoading");
  const tableWrap = $("paymentsTableWrap");
  const emptyState = $("emptyPayments");
  const refreshBtn = $("refreshBtn");

  if (loading) loading.hidden = false;
  if (tableWrap) tableWrap.hidden = true;
  if (emptyState) emptyState.hidden = true;
  if (refreshBtn) refreshBtn.disabled = true;

  hideFeedback();

  try {
    // Main payment data source:
    // Firestore > payments
    const paymentSnapshot = await getDocs(
      collection(db, "payments")
    );

    const paymentDocuments = paymentSnapshot.docs;

    // Attach the relevant seller profile to each payment.
    const paymentsWithSeller = await Promise.all(
      paymentDocuments.map(async (paymentDoc) => {
        const paymentData = paymentDoc.data();
        const sellerUid = paymentData.sellerUid;

        let sellerProfile = {};

        if (sellerUid) {
          try {
            const sellerSnap = await getDoc(
              doc(db, "users", sellerUid)
            );

            if (sellerSnap.exists()) {
              sellerProfile = sellerSnap.data();
            }
          } catch (error) {
            console.warn(
              `Could not load seller profile: ${sellerUid}`,
              error
            );
          }
        }

        return {
          id: paymentDoc.id,
          ...paymentData,
          sellerUid,
          sellerProfile
        };
      })
    );

    allPayments = paymentsWithSeller;

    allPayments.sort((a, b) => {
      const dateA = getDateValue(
        a.submittedAt ||
        a.createdAt ||
        a.requestedAt ||
        a.paymentDate
      );

      const dateB = getDateValue(
        b.submittedAt ||
        b.createdAt ||
        b.requestedAt ||
        b.paymentDate
      );

      return dateB - dateA;
    });

    updateSummary();
    renderPayments();

  } catch (error) {
    console.error("Payment loading error:", error);

    showFeedback(
      error.code === "permission-denied"
        ? "Permission denied. Check Admin Firestore read permissions for the payments collection."
        : error.message || "Could not load payment records."
    );

    if (emptyState) emptyState.hidden = false;

  } finally {
    if (loading) loading.hidden = true;
    if (refreshBtn) refreshBtn.disabled = false;
  }
}

/* =========================================
   SUMMARY CARDS
========================================= */

function updateSummary() {
  const pending = allPayments.filter(
    (payment) => getStatus(payment) === "pending"
  ).length;

  const approved = allPayments.filter(
    (payment) => getStatus(payment) === "approved"
  ).length;

  const rejected = allPayments.filter(
    (payment) => getStatus(payment) === "rejected"
  ).length;

  if ($("totalPayments")) {
    $("totalPayments").textContent = allPayments.length;
  }

  if ($("pendingPayments")) {
    $("pendingPayments").textContent = pending;
  }

  if ($("approvedPayments")) {
    $("approvedPayments").textContent = approved;
  }

  if ($("rejectedPayments")) {
    $("rejectedPayments").textContent = rejected;
  }

  if ($("pendingPaymentCount")) {
    $("pendingPaymentCount").textContent = pending;
  }
}

/* =========================================
   RENDER PAYMENT TABLE
========================================= */

function renderPayments() {
  const tbody = $("paymentTableBody");
  if (!tbody) return;

  const searchTerm = (
    $("paymentSearch")?.value || ""
  ).trim().toLowerCase();

  const filteredPayments = allPayments.filter((payment) => {
    const status = getStatus(payment);

    const matchesFilter =
      activeFilter === "all" ||
      status === activeFilter;

    const searchableText = [
      payment.id,
      payment.sellerUid,
      getSellerName(payment),
      getSellerEmail(payment),
      getMethod(payment),
      getSenderNumber(payment),
      getTransactionId(payment),
      payment.plan,
      payment.billingCycle
    ].join(" ").toLowerCase();

    return (
      matchesFilter &&
      searchableText.includes(searchTerm)
    );
  });

  if (!filteredPayments.length) {
    tbody.innerHTML = "";

    if ($("paymentsTableWrap")) {
      $("paymentsTableWrap").hidden = true;
    }

    if ($("emptyPayments")) {
      $("emptyPayments").hidden = false;
    }

    return;
  }

  if ($("emptyPayments")) {
    $("emptyPayments").hidden = true;
  }

  if ($("paymentsTableWrap")) {
    $("paymentsTableWrap").hidden = false;
  }

  tbody.innerHTML = filteredPayments.map((payment) => {
    const status = getStatus(payment);

    const statusClass = [
      "pending",
      "approved",
      "rejected"
    ].includes(status) ? status : "pending";

    const method = getMethod(payment);

    return `
      <tr>
        <td>
          <div class="payment-seller">
            <strong>${escapeHTML(getSellerName(payment))}</strong>
            <small>${escapeHTML(getSellerEmail(payment))}</small>
          </div>
        </td>

        <td>${escapeHTML(method)}</td>

        <td>${escapeHTML(getSenderNumber(payment))}</td>

        <td>
          <span class="transaction-id">
            ${escapeHTML(getTransactionId(payment))}
          </span>
        </td>

        <td><strong>${escapeHTML(getAmount(payment))}</strong></td>

        <td>${escapeHTML(formatDate(
          payment.submittedAt ||
          payment.createdAt ||
          payment.requestedAt
        ))}</td>

        <td>
          <span class="status-badge ${statusClass}">
            ${escapeHTML(status)}
          </span>
        </td>

        <td>
          <button
            type="button"
            class="btn btn-sm btn-light payment-view-btn"
            data-payment-id="${escapeHTML(payment.id)}"
            title="View payment details"
          >
            <i class="bi bi-eye"></i>
          </button>
        </td>
      </tr>
    `;
  }).join("");

  tbody.querySelectorAll(".payment-view-btn").forEach((button) => {
    button.addEventListener("click", () => {
      openPaymentDetails(button.dataset.paymentId);
    });
  });
}

/* =========================================
   PAYMENT DETAILS MODAL
========================================= */

function openPaymentDetails(paymentId) {
  const payment = allPayments.find(
    (item) => item.id === paymentId
  );

  if (!payment || !paymentModal) return;

  const modalBody = modalElement.querySelector(".modal-body");

  if (!modalBody) return;

  const details = [
    ["Payment ID", payment.id],
    ["Seller Name", getSellerName(payment)],
    ["Seller Email", getSellerEmail(payment)],
    ["Seller UID", payment.sellerUid || "—"],
    ["Plan", payment.plan || payment.planName || "—"],
    ["Billing Cycle", payment.billingCycle || payment.billing || "—"],
    ["Amount", getAmount(payment)],
    ["Payment Method", getMethod(payment)],
    ["Sender Number", getSenderNumber(payment)],
    ["Transaction ID", getTransactionId(payment)],
    ["Status", getStatus(payment)],
    ["Submitted At", formatDate(
      payment.submittedAt ||
      payment.createdAt ||
      payment.requestedAt
    )],
    ["Verified At", formatDate(payment.verifiedAt)],
    ["Verified By", payment.verifiedBy || "—"],
    ["Subscription Start", formatDate(payment.subscriptionStart)],
    ["Subscription End", formatDate(payment.subscriptionEnd)]
  ];

  modalBody.innerHTML = `
    <div class="payment-details-list">
      ${details.map(([label, value]) => `
        <div class="payment-detail-row">
          <span>${escapeHTML(label)}</span>
          <strong>${escapeHTML(value)}</strong>
        </div>
      `).join("")}
    </div>

    ${payment.rejectionReason ? `
      <div class="alert alert-warning mt-3">
        <strong>Rejection Reason:</strong>
        ${escapeHTML(payment.rejectionReason)}
      </div>
    ` : ""}
  `;

  paymentModal.show();
}

/* =========================================
   FILTERS AND SEARCH
========================================= */

document.querySelectorAll("[data-filter]").forEach((button) => {
  button.addEventListener("click", () => {
    activeFilter = button.dataset.filter || "all";

    document.querySelectorAll("[data-filter]").forEach((item) => {
      item.classList.remove("active");
    });

    button.classList.add("active");
    renderPayments();
  });
});

$("paymentSearch")?.addEventListener("input", renderPayments);

$("refreshBtn")?.addEventListener("click", loadPayments);

/* =========================================
   LOGOUT
========================================= */

$("adminLogoutBtn")?.addEventListener("click", async () => {
  try {
    await signOut(auth);
    window.location.href = "login.html";
  } catch (error) {
    console.error("Logout error:", error);
    alert("Could not log out. Please try again.");
  }
});

/* =========================================
   MOBILE SIDEBAR
========================================= */

const sidebar = $("sidebar");
const overlay = $("sidebarOverlay");

$("menuToggle")?.addEventListener("click", () => {
  sidebar?.classList.toggle("open");
  overlay?.classList.toggle("show");
});

overlay?.addEventListener("click", () => {
  sidebar?.classList.remove("open");
  overlay.classList.remove("show");
});

/* =========================================
   AUTH INITIALIZATION
========================================= */

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "login.html";
    return;
  }

  try {
    const isAdmin = await verifyAdmin(user);

    if (!isAdmin) {
      await signOut(auth);
      window.location.href = "login.html";
      return;
    }

    const adminSnap = await getDoc(
      doc(db, "adminUsers", user.uid)
    );

    const adminData = adminSnap.data() || {};

    if ($("adminName")) {
      $("adminName").textContent =
        adminData.name || "Administrator";
    }

    if ($("adminEmailLabel")) {
      $("adminEmailLabel").textContent =
        user.email || "";
    }

    await loadPayments();

  } catch (error) {
    console.error("Admin initialization error:", error);
    showFeedback("Could not verify Admin access.");
  }
});