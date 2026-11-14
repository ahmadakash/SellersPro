
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

const tableBody = $("sellersTableBody");
const mobileList = $("sellerMobileList");
const searchInput = $("sellerSearch");
const statusFilter = $("sellerStatusFilter");

let allSellers = [];
let currentAdmin = null;

function escapeHTML(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

function showNotice(message) {
  $("sellersNotice").textContent = message;
  $("sellersNotice").hidden = false;
}

function hideNotice() {
  $("sellersNotice").hidden = true;
  $("sellersNotice").textContent = "";
}

function getAccountStatus(data) {
  return data.accountStatus === "blocked" || data.isBlocked === true
    ? "blocked"
    : "active";
}

function formatDate(timestamp) {
  if (!timestamp) return "—";

  const date = timestamp.toDate
    ? timestamp.toDate()
    : new Date(timestamp);

  if (Number.isNaN(date.getTime())) return "—";

  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}

function getInitial(name) {
  return String(name || "S").trim().charAt(0).toUpperCase() || "S";
}

function sellerRow(seller) {
  const status = getAccountStatus(seller);
  const name = seller.name || seller.fullName || "Unnamed Seller";

  return `
    <tr>
      <td>
        <div class="seller-person">
          <span class="seller-avatar">${escapeHTML(getInitial(name))}</span>
          <span class="seller-person-info">
            <strong>${escapeHTML(name)}</strong>
            <small>${escapeHTML(seller.email || "No email")}</small>
          </span>
        </div>
      </td>
      <td>${escapeHTML(seller.businessName || "—")}</td>
      <td>${escapeHTML(seller.phone || "—")}</td>
      <td><span class="seller-plan">${escapeHTML(seller.plan || "Free")}</span></td>
      <td>
        <span class="seller-status ${status}">
          ${status === "blocked" ? "Blocked" : "Active"}
        </span>
      </td>
      <td>${escapeHTML(formatDate(seller.createdAt))}</td>
      <td>
        <button class="seller-view-btn" type="button" data-seller-id="${escapeHTML(seller.id)}">
          View details <i class="bi bi-arrow-up-right"></i>
        </button>
      </td>
    </tr>
  `;
}

function sellerMobileCard(seller) {
  const status = getAccountStatus(seller);
  const name = seller.name || seller.fullName || "Unnamed Seller";

  return `
    <article class="seller-mobile-card">
      <div class="seller-mobile-top">
        <div class="seller-person">
          <span class="seller-avatar">${escapeHTML(getInitial(name))}</span>
          <span class="seller-person-info">
            <strong>${escapeHTML(name)}</strong>
            <small>${escapeHTML(seller.email || "No email")}</small>
          </span>
        </div>
        <span class="seller-status ${status}">
          ${status === "blocked" ? "Blocked" : "Active"}
        </span>
      </div>

      <div class="seller-mobile-meta">
        <span>Business<strong>${escapeHTML(seller.businessName || "—")}</strong></span>
        <span>Phone<strong>${escapeHTML(seller.phone || "—")}</strong></span>
        <span>Plan<strong>${escapeHTML(seller.plan || "Free")}</strong></span>
        <span>Joined<strong>${escapeHTML(formatDate(seller.createdAt))}</strong></span>
      </div>

      <button class="seller-view-btn" type="button" data-seller-id="${escapeHTML(seller.id)}">
        View seller details <i class="bi bi-arrow-right"></i>
      </button>
    </article>
  `;
}

function renderSellers() {
  const searchTerm = searchInput.value.trim().toLowerCase();
  const selectedStatus = statusFilter.value;

  const filtered = allSellers.filter((seller) => {
    const status = getAccountStatus(seller);

    const searchable = [
      seller.name,
      seller.fullName,
      seller.email,
      seller.businessName,
      seller.phone,
      seller.id
    ].join(" ").toLowerCase();

    const matchesSearch = searchable.includes(searchTerm);
    const matchesStatus = selectedStatus === "all" ||
      selectedStatus === status;

    return matchesSearch && matchesStatus;
  });

  $("sellerTotal").textContent = allSellers.length;
  $("sellerActive").textContent = allSellers.filter(
    (seller) => getAccountStatus(seller) === "active"
  ).length;
  $("sellerBlocked").textContent = allSellers.filter(
    (seller) => getAccountStatus(seller) === "blocked"
  ).length;

  $("sellerResultCount").textContent =
    `Showing ${filtered.length} of ${allSellers.length} sellers`;

  if (!filtered.length) {
    tableBody.innerHTML = `
      <tr><td colspan="7" class="seller-table-message">
        No seller accounts found.
      </td></tr>
    `;

    mobileList.innerHTML = `
      <div class="seller-table-message">No seller accounts found.</div>
    `;
    return;
  }

  tableBody.innerHTML = filtered.map(sellerRow).join("");
  mobileList.innerHTML = filtered.map(sellerMobileCard).join("");
}

async function loadSellers() {
  hideNotice();

  tableBody.innerHTML = `
    <tr><td colspan="7" class="seller-table-message">
      <span class="spinner-border spinner-border-sm"></span>
      Loading sellers...
    </td></tr>
  `;

  mobileList.innerHTML = "";

  try {
    const snapshot = await getDocs(collection(db, "users"));

    allSellers = snapshot.docs.map((item) => ({
      id: item.id,
      ...item.data()
    }));

    allSellers.sort((a, b) => {
      const aDate = a.createdAt?.toMillis?.() || 0;
      const bDate = b.createdAt?.toMillis?.() || 0;
      return bDate - aDate;
    });

    renderSellers();

  } catch (error) {
    console.error("Seller loading error:", error);

    tableBody.innerHTML = `
      <tr><td colspan="7" class="seller-table-message">
        Unable to load seller records.
      </td></tr>
    `;

    showNotice(
      error.code === "permission-denied"
        ? "Permission denied. Check the Admin Firestore read rules."
        : "Could not load sellers. Please refresh and try again."
    );
  }
}

function openSellerDetails(event) {
  const button = event.target.closest("[data-seller-id]");
  if (!button) return;

  const sellerId = button.dataset.sellerId;

  if (!sellerId) return;

  window.location.href =
    `seller-details.html?uid=${encodeURIComponent(sellerId)}`;
}

searchInput.addEventListener("input", renderSellers);
statusFilter.addEventListener("change", renderSellers);

$("refreshSellersBtn").addEventListener("click", loadSellers);

tableBody.addEventListener("click", openSellerDetails);
mobileList.addEventListener("click", openSellerDetails);

$("adminLogoutBtn").addEventListener("click", async () => {
  await signOut(auth);
  window.location.replace("login.html");
});

$("menuToggle").addEventListener("click", () => {
  $("sidebar").classList.toggle("open");
  $("sidebarOverlay").classList.toggle("show");
});

$("sidebarOverlay").addEventListener("click", () => {
  $("sidebar").classList.remove("open");
  $("sidebarOverlay").classList.remove("show");
});

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

    await loadSellers();

  } catch (error) {
    console.error("Admin verification error:", error);
    showNotice(
      "Could not verify Admin permissions. Please check Firestore Rules."
    );
  }
});
