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

let allApplications = [];
let activeFilter = "all";

const modalElement = $("applicationModal");
const applicationModal = new bootstrap.Modal(modalElement);

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

function getStatus(application) {
  return String(
    application.status || "pending"
  ).toLowerCase();
}

function getAmount(application) {
  const amount =
    application.amount ??
    application.price ??
    application.paymentAmount;

  if (amount === undefined || amount === null || amount === "") {
    return "—";
  }

  const currency = application.currency || "BDT";

  return currency === "BDT"
    ? `৳${amount}`
    : `${currency} ${amount}`;
}

function showFeedback(message) {
  $("pageFeedback").textContent = message;
  $("pageFeedback").hidden = false;
}

function hideFeedback() {
  $("pageFeedback").hidden = true;
}

async function verifyAdmin(user) {
  const adminSnap = await getDoc(
    doc(db, "adminUsers", user.uid)
  );

  if (!adminSnap.exists()) return null;

  const admin = adminSnap.data();

  return admin.active === true &&
    ["admin", "superadmin"].includes(admin.role)
    ? admin
    : null;
}

/* Fill the admin profile shown at the top right (name + email) */
function showAdminProfile(user, admin = null) {
  $("adminEmailLabel").textContent = user.email || "Signed in";

  if (admin) {
    $("adminName").textContent = admin.name || "Administrator";
  }
}

/* Sidebar badge next to "Payment Requests" */
function updatePendingBadge() {
  const badge = $("pendingPaymentCount");
  if (!badge) return;

  const pending = allApplications.filter(
    (item) => getStatus(item) === "pending"
  ).length;

  badge.textContent = pending;
  badge.hidden = pending === 0;
}

/* =========================================
   LOAD APPLICATIONS
========================================= */

async function loadApplications() {
  $("applicationsLoading").hidden = false;
  $("applicationsTableWrap").hidden = true;
  $("emptyApplications").hidden = true;
  $("refreshBtn").disabled = true;

  hideFeedback();

  try {
    const usersSnapshot = await getDocs(
      collection(db, "users")
    );

    const sellerDocuments = usersSnapshot.docs;

    const sellerApplications = await Promise.all(
      sellerDocuments.map(async (sellerDoc) => {
        const sellerUid = sellerDoc.id;
        const sellerProfile = sellerDoc.data();

        try {
          const requestSnapshot = await getDocs(
            collection(
              db,
              "users",
              sellerUid,
              "subscriptionRequests"
            )
          );

          return requestSnapshot.docs.map((requestDoc) => ({
            id: requestDoc.id,
            sellerUid,
            sellerProfile,
            ...requestDoc.data()
          }));

        } catch (error) {
          console.error(
            `Could not load subscription requests for ${sellerUid}:`,
            error
          );

          return [];
        }
      })
    );

    allApplications = sellerApplications.flat();

    allApplications.sort((a, b) =>
      getDateValue(b.createdAt || b.submittedAt) -
      getDateValue(a.createdAt || a.submittedAt)
    );

    updateSummary();
    renderApplications();

  } catch (error) {
    console.error("Subscription loading error:", error);

    showFeedback(
      error.code === "permission-denied"
        ? "Permission denied. Check Admin Firestore read permissions."
        : error.message || "Could not load subscription applications."
    );

    $("emptyApplications").hidden = false;
  } finally {
    $("applicationsLoading").hidden = true;
    $("refreshBtn").disabled = false;
  }
}

/* =========================================
   SUMMARY
========================================= */

function updateSummary() {
  const pending = allApplications.filter(
    (item) => getStatus(item) === "pending"
  ).length;

  const approved = allApplications.filter(
    (item) => getStatus(item) === "approved"
  ).length;

  const rejected = allApplications.filter(
    (item) => getStatus(item) === "rejected"
  ).length;

  $("totalApplications").textContent = allApplications.length;
  $("pendingApplications").textContent = pending;
  $("approvedApplications").textContent = approved;
  $("rejectedApplications").textContent = rejected;

  updatePendingBadge();
}

/* =========================================
   APPLICATION DISPLAY
========================================= */

function getSellerName(application) {
  const profile = application.sellerProfile || {};

  return (
    profile.name ||
    profile.fullName ||
    profile.displayName ||
    profile.ownerName ||
    application.sellerName ||
    "Unknown Seller"
  );
}

function getSellerEmail(application) {
  const profile = application.sellerProfile || {};

  return profile.email || application.email || "No email";
}

function getPlan(application) {
  return (
    application.plan ||
    application.planName ||
    application.subscriptionPlan ||
    "Pro"
  );
}

function getBilling(application) {
  return (
    application.billingCycle ||
    application.billing ||
    application.duration ||
    "—"
  );
}

function getPaymentMethod(application) {
  return (
    application.paymentMethod ||
    application.method ||
    "—"
  );
}

function getTransactionId(application) {
  return (
    application.transactionId ||
    application.trxId ||
    application.transactionID ||
    "—"
  );
}

function renderApplications() {
  const searchTerm = $("searchInput").value
    .trim()
    .toLowerCase();

  const filtered = allApplications.filter((application) => {
    const status = getStatus(application);

    const matchesFilter =
      activeFilter === "all" || status === activeFilter;

    const searchableText = [
      getSellerName(application),
      getSellerEmail(application),
      getTransactionId(application),
      application.senderNumber || "",
      application.sellerUid || ""
    ].join(" ").toLowerCase();

    return matchesFilter && searchableText.includes(searchTerm);
  });

  $("resultCount").textContent =
    `Showing ${filtered.length} of ${allApplications.length} applications`;

  if (!filtered.length) {
    $("applicationsTableWrap").hidden = true;
    $("emptyApplications").hidden = false;
    return;
  }

  $("applicationsTableWrap").hidden = false;
  $("emptyApplications").hidden = true;

  $("applicationsTableBody").innerHTML = filtered.map((application) => {
    const name = getSellerName(application);
    const email = getSellerEmail(application);
    const status = getStatus(application);

    const safeStatus = [
      "pending",
      "approved",
      "rejected"
    ].includes(status) ? status : "unknown";

    const date = application.createdAt || application.submittedAt;

    return `
      <tr>
        <td>
        <div class="application-seller">
        <div class="application-avatar">
            ${escapeHTML(name.charAt(0).toUpperCase())}
        </div>
        <div class="application-seller-info">
            <strong>${escapeHTML(name)}</strong>
            <small>${escapeHTML(email)}</small>
        </div>
        </div>
        </td>

        <td>
          <span class="subscription-plan-label">
            ${escapeHTML(getPlan(application))}
            </span>
        </td>

        <td>
          <span class="billing-text">${escapeHTML(getBilling(application))}</span>
        </td>

        <td>
          <span class="amount-text">${escapeHTML(getAmount(application))}</span>
        </td>

        <td>${escapeHTML(getPaymentMethod(application))}</td>

        <td>
          <span class="date-text">${escapeHTML(formatDate(date))}</span>
        </td>

        <td>
            <span class="subscription-status ${safeStatus}">
            ${escapeHTML(status)}
            </span>
        </td>

        <td>
          <button
            class="view-application-btn"
            data-application-id="${escapeHTML(application.id)}"
            data-seller-uid="${escapeHTML(application.sellerUid)}"
            title="View application details"
          >
            <i class="bi bi-eye"></i>
          </button>
        </td>
      </tr>
    `;
  }).join("");
}

/* =========================================
   APPLICATION DETAILS
========================================= */

function detailItem(label, value) {
  return `
    <div class="modal-detail-item">
      <small>${escapeHTML(label)}</small>
      <strong>${escapeHTML(value ?? "—")}</strong>
    </div>
  `;
}

function openApplicationDetails(application) {
  const profile = application.sellerProfile || {};

  const details = [
    ["Seller Name", getSellerName(application)],
    ["Seller Email", getSellerEmail(application)],
    ["Seller Phone", profile.phone || profile.phoneNumber || "—"],
    ["Business Name", profile.businessName || profile.shopName || "—"],
    ["Seller UID", application.sellerUid],
    ["Application ID", application.id],
    ["Plan", getPlan(application)],
    ["Billing Cycle", getBilling(application)],
    ["Requested Amount", getAmount(application)],
    ["Payment Method", getPaymentMethod(application)],
    ["Sender Number", application.senderNumber || application.phoneNumber || "—"],
    ["Transaction ID", getTransactionId(application)],
    ["Submitted At", formatDate(application.createdAt || application.submittedAt)],
    ["Current Status", getStatus(application)]
  ];

  $("applicationDetails").innerHTML = `
    <div class="modal-detail-grid">
      ${details.map(([label, value]) => detailItem(label, value)).join("")}
    </div>
  `;

  applicationModal.show();
}

/* =========================================
   EVENTS
========================================= */

$("applicationsTableBody").addEventListener("click", (event) => {
  const button = event.target.closest("[data-application-id]");

  if (!button) return;

  const application = allApplications.find((item) =>
    item.id === button.dataset.applicationId &&
    item.sellerUid === button.dataset.sellerUid
  );

  if (application) {
    openApplicationDetails(application);
  }
});

$("searchInput").addEventListener("input", renderApplications);

$("filterButtons").addEventListener("click", (event) => {
  const button = event.target.closest("[data-filter]");

  if (!button) return;

  activeFilter = button.dataset.filter;

  document.querySelectorAll(".filter-btn").forEach((item) => {
    item.classList.toggle("active", item === button);
  });

  renderApplications();
});

$("refreshBtn").addEventListener("click", loadApplications);

$("adminLogoutBtn").addEventListener("click", async () => {
  await signOut(auth);
  window.location.replace("login.html");
});

$("menuToggle")?.addEventListener("click", () => {
  $("sidebar")?.classList.toggle("open");
  $("sidebarOverlay")?.classList.toggle("show");
});

$("sidebarOverlay")?.addEventListener("click", () => {
  $("sidebar")?.classList.remove("open");
  $("sidebarOverlay")?.classList.remove("show");
});

/* =========================================
   AUTH CHECK
========================================= */

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "login.html";
    return;
  }

  // Show the signed-in email immediately so the top-right never stays on "Loading..."
  showAdminProfile(user);

  try {
    const admin = await verifyAdmin(user);

    if (!admin) {
      await signOut(auth);
      window.location.href = "login.html";
      return;
    }

    showAdminProfile(user, admin);

    await loadApplications();

  } catch (error) {
    console.error("Admin verification error:", error);

    showFeedback(
      "Admin verification failed. Please check your Admin account and Firestore rules."
    );

    $("applicationsLoading").hidden = true;
    $("emptyApplications").hidden = false;
  }
});