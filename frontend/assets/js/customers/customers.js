
import { onAuthStateChanged } from
  "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

import { auth, db } from "../config/firebase.js";
import { logoutUser } from "../services/auth-service.js";

const $ = (id) => document.getElementById(id);

let currentUser = null;
let currentProfile = {};
let customers = [];

const customerCollection = () =>
  collection(db, "users", currentUser.uid, "customers");

function showNotice(message, type = "error") {
  const notice = $("customersNotice");
  notice.textContent = message;
  notice.hidden = false;
  notice.classList.toggle("error", type === "error");
}

function escapeHTML(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function showSellerProfile(user, profile = {}) {
  const name = profile.name || user.displayName || user.email || "Seller";
  $("userName").textContent = name;
  $("userBusiness").textContent = profile.businessName || "My business";
  $("userAvatar").textContent = name.trim().charAt(0).toUpperCase() || "S";
}

function renderCustomers() {
  const query = $("customerSearch").value.trim().toLowerCase();

  const filtered = customers.filter((customer) => {
    const haystack = [
      customer.name,
      customer.phone,
      customer.email,
      customer.address
    ].join(" ").toLowerCase();

    return haystack.includes(query);
  });

  $("customerCount").textContent = customers.length;

  const tableBody = $("customersTableBody");
  const mobileList = $("customerMobileList");

  if (filtered.length === 0) {
    const message = customers.length
      ? "No customers match your search."
      : "No customers yet. Add your first customer.";

    tableBody.innerHTML =
      `<tr><td colspan="5" class="customer-empty">${escapeHTML(message)}</td></tr>`;
    mobileList.innerHTML =
      `<div class="customer-empty">${escapeHTML(message)}</div>`;
    return;
  }

  tableBody.innerHTML = filtered.map((customer) => `
    <tr>
      <td>
        <div class="customer-person">
          <span class="customer-person-avatar">
            ${escapeHTML((customer.name || "C").trim().charAt(0).toUpperCase())}
          </span>
          <span><strong>${escapeHTML(customer.name || "Unnamed")}</strong></span>
        </div>
      </td>
      <td>${escapeHTML(customer.phone || "—")}</td>
      <td>${escapeHTML(customer.email || "—")}</td>
      <td>${escapeHTML(customer.address || "—")}</td>
      <td>
        <div class="customer-actions">
          <button class="customer-icon-btn" type="button"
            data-edit="${escapeHTML(customer.id)}" aria-label="Edit customer">
            <i class="bi bi-pencil"></i>
          </button>
          <button class="customer-icon-btn delete" type="button"
            data-delete="${escapeHTML(customer.id)}" aria-label="Delete customer">
            <i class="bi bi-trash3"></i>
          </button>
        </div>
      </td>
    </tr>
  `).join("");

  mobileList.innerHTML = filtered.map((customer) => `
    <article class="customer-mobile-card">
      <div class="customer-person">
        <span class="customer-person-avatar">
          ${escapeHTML((customer.name || "C").trim().charAt(0).toUpperCase())}
        </span>
        <span><strong>${escapeHTML(customer.name || "Unnamed")}</strong></span>
      </div>
      <p><strong>Phone:</strong> ${escapeHTML(customer.phone || "—")}</p>
      <p><strong>Email:</strong> ${escapeHTML(customer.email || "—")}</p>
      <p><strong>Address:</strong> ${escapeHTML(customer.address || "—")}</p>
      <div class="customer-actions">
        <button class="customer-icon-btn" type="button"
          data-edit="${escapeHTML(customer.id)}" aria-label="Edit customer">
          <i class="bi bi-pencil"></i>
        </button>
        <button class="customer-icon-btn delete" type="button"
          data-delete="${escapeHTML(customer.id)}" aria-label="Delete customer">
          <i class="bi bi-trash3"></i>
        </button>
      </div>
    </article>
  `).join("");
}

async function loadCustomers() {
  const snapshot = await getDocs(customerCollection());

  customers = snapshot.docs.map((item) => ({
    id: item.id,
    ...item.data()
  }));

  customers.sort((a, b) =>
    String(a.name || "").localeCompare(String(b.name || ""))
  );

  renderCustomers();
}

function openCustomerModal(customer = null) {
  $("customerForm").reset();
  $("customerFormFeedback").hidden = true;
  $("customerId").value = customer?.id || "";

  $("customerModalTitle").textContent =
    customer ? "Edit customer" : "Add customer";

  $("saveCustomerBtn").textContent =
    customer ? "Save changes" : "Save customer";

  $("customerName").value = customer?.name || "";
  $("customerPhone").value = customer?.phone || "";
  $("customerEmail").value = customer?.email || "";
  $("customerAddress").value = customer?.address || "";
  $("customerNotes").value = customer?.notes || "";

  $("customerModal").hidden = false;
  document.body.style.overflow = "hidden";
  $("customerName").focus();
}

function closeCustomerModal() {
  $("customerModal").hidden = true;
  document.body.style.overflow = "";
  $("addCustomerBtn").focus();
}

$("addCustomerBtn").addEventListener("click", () => openCustomerModal());
$("closeCustomerBtn").addEventListener("click", closeCustomerModal);
$("cancelCustomerBtn").addEventListener("click", closeCustomerModal);

$("customerModal").querySelector("[data-close-customer]")
  .addEventListener("click", closeCustomerModal);

$("customerSearch").addEventListener("input", renderCustomers);

$("customersTableBody").addEventListener("click", handleCustomerAction);
$("customerMobileList").addEventListener("click", handleCustomerAction);

async function handleCustomerAction(event) {
  const editButton = event.target.closest("[data-edit]");
  const deleteButton = event.target.closest("[data-delete]");

  if (editButton) {
    const customer = customers.find((item) => item.id === editButton.dataset.edit);
    if (customer) openCustomerModal(customer);
  }

  if (deleteButton) {
    const customer = customers.find((item) => item.id === deleteButton.dataset.delete);
    if (!customer) return;

    if (!window.confirm(`Delete customer "${customer.name}"? This cannot be undone.`)) {
      return;
    }

    deleteButton.disabled = true;

    try {
      await deleteDoc(doc(db, "users", currentUser.uid, "customers", customer.id));
      await loadCustomers();
      showNotice("Customer deleted successfully.", "success");
    } catch (error) {
      console.error("Deleting customer failed:", error);
      showNotice("Could not delete customer. Check Firestore rules.");
      deleteButton.disabled = false;
    }
  }
}

$("customerForm").addEventListener("submit", async (event) => {
  event.preventDefault();

  const id = $("customerId").value;
  const customer = {
    name: $("customerName").value.trim(),
    phone: $("customerPhone").value.trim(),
    email: $("customerEmail").value.trim(),
    address: $("customerAddress").value.trim(),
    notes: $("customerNotes").value.trim()
  };

  if (!customer.name || !customer.phone) {
    $("customerFormFeedback").textContent =
      "Full name and phone number are required.";
    $("customerFormFeedback").hidden = false;
    return;
  }

  const saveButton = $("saveCustomerBtn");
  saveButton.disabled = true;
  saveButton.textContent = "Saving...";

  try {
    if (id) {
      await updateDoc(
        doc(db, "users", currentUser.uid, "customers", id),
        { ...customer, updatedAt: serverTimestamp() }
      );
    } else {
      await addDoc(customerCollection(), {
        ...customer,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    }

    closeCustomerModal();
    await loadCustomers();
    showNotice(id ? "Customer updated successfully." : "Customer added successfully.", "success");
  } catch (error) {
    console.error("Saving customer failed:", error);
    $("customerFormFeedback").textContent =
      "Could not save customer. Check your connection and Firestore rules.";
    $("customerFormFeedback").hidden = false;
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = id ? "Save changes" : "Save customer";
  }
});

/* Seller profile modal */
function openProfile() {
  $("profileFeedback").hidden = true;
  $("profileName").value = currentProfile.name || currentUser.displayName || "";
  $("profileBusinessName").value = currentProfile.businessName || "";
  $("profileEmail").value = currentUser.email || "";
  $("profilePhone").value = currentProfile.phone || currentUser.phoneNumber || "";
  $("profileModal").hidden = false;
  document.body.style.overflow = "hidden";
  $("profileName").focus();
}

function closeProfile() {
  $("profileModal").hidden = true;
  document.body.style.overflow = "";
  $("profileTrigger").focus();
}

$("profileTrigger").addEventListener("click", openProfile);
$("closeProfileBtn").addEventListener("click", closeProfile);
$("cancelProfileBtn").addEventListener("click", closeProfile);

$("profileModal").querySelector("[data-close-profile]")
  .addEventListener("click", closeProfile);

$("profileForm").addEventListener("submit", async (event) => {
  event.preventDefault();

  const name = $("profileName").value.trim();
  const businessName = $("profileBusinessName").value.trim();
  const phone = $("profilePhone").value.trim();
  const button = $("saveProfileBtn");

  if (!name || !businessName) {
    $("profileFeedback").textContent = "Name and business name are required.";
    $("profileFeedback").hidden = false;
    return;
  }

  button.disabled = true;

  try {
    await updateDoc(doc(db, "users", currentUser.uid), {
      name,
      businessName,
      phone,
      updatedAt: serverTimestamp()
    });

    currentProfile = { ...currentProfile, name, businessName, phone };
    showSellerProfile(currentUser, currentProfile);

    $("profileFeedback").textContent = "Profile updated successfully.";
    $("profileFeedback").className = "profile-feedback success";
    $("profileFeedback").hidden = false;
    window.setTimeout(closeProfile, 800);
  } catch (error) {
    console.error("Updating profile failed:", error);
    $("profileFeedback").textContent = "Could not update profile. Check Firestore rules.";
    $("profileFeedback").className = "profile-feedback error";
    $("profileFeedback").hidden = false;
  } finally {
    button.disabled = false;
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (!$("customerModal").hidden) closeCustomerModal();
    if (!$("profileModal").hidden) closeProfile();
  }
});

/* Logout and mobile sidebar */
$("logoutBtn").addEventListener("click", async () => {
  try {
    await logoutUser();
    window.location.replace("../auth/login.html");
  } catch (error) {
    console.error("Logout failed:", error);
    showNotice("Logout failed. Please try again.");
  }
});

const sidebar = $("sidebar");
const sidebarOverlay = $("sidebarOverlay");

function closeSidebar() {
  sidebar.classList.remove("open");
  sidebarOverlay.classList.remove("show");
}

$("menuToggle").addEventListener("click", () => {
  sidebar.classList.toggle("open");
  sidebarOverlay.classList.toggle("show");
});

sidebarOverlay.addEventListener("click", closeSidebar);

document.querySelectorAll("[data-coming-soon]").forEach((element) => {
  element.addEventListener("click", (event) => {
    event.preventDefault();
    showNotice(`${element.dataset.comingSoon} page is not connected yet.`, "info");
    closeSidebar();
  });
});

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.replace("../auth/login.html");
    return;
  }

  currentUser = user;

  try {
    const profileSnapshot = await getDoc(doc(db, "users", user.uid));

    if (profileSnapshot.exists()) {
      currentProfile = profileSnapshot.data();
      showSellerProfile(user, currentProfile);
    } else {
      showSellerProfile(user);
      showNotice("Your seller profile was not found.");
    }

    await loadCustomers();
  } catch (error) {
    console.error("Initializing customers page failed:", error);
    showNotice("Could not load customers. Check your connection and Firestore rules.");
    $("customersTableBody").innerHTML =
      '<tr><td colspan="5" class="customer-empty">Could not load customers.</td></tr>';
  }
});
