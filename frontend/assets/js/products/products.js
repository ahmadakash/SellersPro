
// this file is backend-agnostic and can be used with any backend, but it currently uses Firebase Firestore for data storage and Firebase Auth for authentication.

import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";

import { getDoc } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

// Replace the existing onAuthStateChanged block with this:
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.replace("../auth/login.html");
    return;
  }

  currentUser = user;

  try {
    const profileSnapshot = await getDoc(doc(db, "users", user.uid));

    if (profileSnapshot.exists()) {
      const profile = profileSnapshot.data();
      $("userName").textContent =
        profile.name || user.displayName || user.email || "Seller";
      $("userBusiness").textContent = profile.businessName || "My business";
    } else {
      $("userName").textContent = user.displayName || user.email || "Seller";
      $("userBusiness").textContent = "My business";
    }

    $("userAvatar").textContent =
      $("userName").textContent.trim().charAt(0).toUpperCase() || "S";

    await loadProducts();
  } catch (error) {
    console.error("Initializing products page failed:", error);
    showMessage("Could not initialize your products. Check your connection and Firestore rules.", "error");
  }
});


import {
  collection,
  doc,
  addDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

import { auth, db } from "../config/firebase.js";
import { logoutUser } from "../services/auth-service.js";

const $ = (id) => document.getElementById(id);

const form = $("productForm");
const modal = $("productModal");
const tableBody = $("productTableBody");
const emptyState = $("emptyState");
const statusMessage = $("statusMessage");
const saveButton = $("saveProductBtn");

let currentUser = null;
let products = [];
let searchTerm = "";
let isSaving = false;

function showMessage(message, type = "success") {
  statusMessage.textContent = message;
  statusMessage.className = `status-message ${type === "error" ? "error" : type === "info" ? "info" : ""}`;
  statusMessage.hidden = false;
}

function hideMessage() {
  statusMessage.hidden = true;
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

function money(value) {
  return `৳${Number(value || 0).toLocaleString("en-BD", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

function productCollection() {
  if (!currentUser) throw new Error("Please sign in first.");
  return collection(db, "users", currentUser.uid, "products");
}

function productDocument(productId) {
  if (!currentUser) throw new Error("Please sign in first.");
  return doc(db, "users", currentUser.uid, "products", productId);
}

function openModal(product = null) {
  hideMessage();
  $("formError").hidden = true;
  form.reset();
  $("productId").value = "";

  if (product) {
    $("modalTitle").textContent = "Edit product";
    $("saveProductBtn").textContent = "Update product";
    $("productId").value = product.id;
    $("productName").value = product.name || "";
    $("productSku").value = product.sku || "";
    $("productCategory").value = product.category || "";
    $("sellingPrice").value = product.sellingPrice ?? 0;
    $("costPrice").value = product.costPrice ?? 0;
    $("productStock").value = product.stock ?? 0;
    $("lowStockThreshold").value = product.lowStockThreshold ?? 5;
    $("productDescription").value = product.description || "";
  } else {
    $("modalTitle").textContent = "Add product";
    $("saveProductBtn").textContent = "Save product";
    $("lowStockThreshold").value = 5;
  }

  modal.hidden = false;
  $("productName").focus();
}

function closeModal() {
  if (isSaving) return;
  modal.hidden = true;
}

function getStockStatus(product) {
  const stock = Number(product.stock || 0);
  const threshold = Number(product.lowStockThreshold ?? 5);

  if (stock === 0) return { label: "Out of stock", className: "status-out" };
  if (stock <= threshold) return { label: "Low stock", className: "status-low" };
  return { label: "In stock", className: "status-in" };
}

function renderProducts() {
  const filtered = products.filter((product) => {
    const searchable = [
      product.name,
      product.sku,
      product.category
    ].join(" ").toLowerCase();

    return searchable.includes(searchTerm);
  });

  $("totalProducts").textContent = products.length.toLocaleString("en-BD");

  $("totalStock").textContent = products.reduce(
    (sum, product) => sum + Number(product.stock || 0), 0
  ).toLocaleString("en-BD");

  $("lowStockCount").textContent = products.filter((product) => {
    const stock = Number(product.stock || 0);
    const threshold = Number(product.lowStockThreshold ?? 5);
    return stock <= threshold;
  }).length.toLocaleString("en-BD");

  tableBody.replaceChildren();

  if (filtered.length === 0) {
    tableBody.closest(".table-responsive").hidden = true;
    emptyState.hidden = false;

    if (products.length === 0) {
      $("emptyTitle").textContent = "No products yet";
      $("emptyDescription").textContent =
        "Add your first product to start building your catalog.";
      $("emptyAddBtn").hidden = false;
    } else {
      $("emptyTitle").textContent = "No matching products";
      $("emptyDescription").textContent =
        "Try a different product name, SKU or category.";
      $("emptyAddBtn").hidden = true;
    }
    return;
  }

  tableBody.closest(".table-responsive").hidden = false;
  emptyState.hidden = true;

  for (const product of filtered) {
    const status = getStockStatus(product);
    const row = document.createElement("tr");

    row.innerHTML = `
      <td>
        <span class="product-name">${escapeHTML(product.name)}</span>
        <span class="product-category">${escapeHTML(product.category || "Uncategorized")}</span>
      </td>
      <td>${escapeHTML(product.sku || "—")}</td>
      <td><span class="product-price">${money(product.sellingPrice)}</span></td>
      <td>${money(product.costPrice)}</td>
      <td><span class="stock-pill">${Number(product.stock || 0)}</span></td>
      <td><span class="status-pill ${status.className}">${status.label}</span></td>
      <td>
        <div class="action-group">
          <button class="action-btn" type="button" data-action="edit"
            data-id="${escapeHTML(product.id)}" aria-label="Edit product" title="Edit">
            <i class="bi bi-pencil"></i>
          </button>
          <button class="action-btn delete" type="button" data-action="delete"
            data-id="${escapeHTML(product.id)}" aria-label="Delete product" title="Delete">
            <i class="bi bi-trash3"></i>
          </button>
        </div>
      </td>
    `;

    tableBody.appendChild(row);
  }
}

async function loadProducts() {
  tableBody.innerHTML =
    '<tr><td colspan="7" class="loading-cell">Loading products...</td></tr>';
  tableBody.closest(".table-responsive").hidden = false;
  emptyState.hidden = true;

  try {
    const snapshot = await getDocs(productCollection());

    products = snapshot.docs.map((item) => ({
      id: item.id,
      ...item.data()
    }));

    products.sort((a, b) => {
      const aTime = a.createdAt?.toMillis?.() || 0;
      const bTime = b.createdAt?.toMillis?.() || 0;
      return bTime - aTime;
    });

    renderProducts();
  } catch (error) {
    console.error("Loading products failed:", error);
    tableBody.innerHTML = "";
    showMessage(
      "Products could not be loaded. Check your Firestore rules and internet connection.",
      "error"
    );
  }
}

function getFormData() {
  const name = $("productName").value.trim();
  const sku = $("productSku").value.trim();
  const category = $("productCategory").value.trim();
  const sellingPrice = Number($("sellingPrice").value);
  const costPrice = Number($("costPrice").value);
  const stock = Number($("productStock").value);
  const lowStockThreshold = Number($("lowStockThreshold").value);
  const description = $("productDescription").value.trim();

  if (!name) throw new Error("Product name is required.");

  if (
    $("sellingPrice").value.trim() === "" ||
    !Number.isFinite(sellingPrice) || sellingPrice < 0
  ) {
    throw new Error("Enter a valid selling price.");
  }

  if (
    $("costPrice").value.trim() === "" ||
    !Number.isFinite(costPrice) || costPrice < 0
  ) {
    throw new Error("Enter a valid cost price.");
  }

  if (
    $("productStock").value.trim() === "" ||
    !Number.isInteger(stock) || stock < 0
  ) {
    throw new Error("Stock must be a whole number of zero or more.");
  }

  if (
    $("lowStockThreshold").value.trim() === "" ||
    !Number.isInteger(lowStockThreshold) || lowStockThreshold < 0
  ) {
    throw new Error("Low-stock threshold must be a whole number of zero or more.");
  }

  return {
    name,
    sku,
    category,
    sellingPrice,
    costPrice,
    stock,
    lowStockThreshold,
    description,
    updatedAt: serverTimestamp()
  };
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (isSaving) return;

  $("formError").hidden = true;

  try {
    if (!currentUser) throw new Error("Please sign in again.");

    const data = getFormData();
    const productId = $("productId").value;

    // Avoid duplicate SKU values within this seller's catalog.
    if (data.sku) {
      const duplicate = products.some((item) =>
        item.sku?.toLowerCase() === data.sku.toLowerCase() &&
        item.id !== productId
      );

      if (duplicate) {
        throw new Error("This SKU is already used by another product.");
      }
    }

    isSaving = true;
    saveButton.disabled = true;
    saveButton.textContent = productId ? "Updating..." : "Saving...";

    if (productId) {
      await updateDoc(productDocument(productId), data);
    } else {
      await addDoc(productCollection(), {
        ...data,
        createdAt: serverTimestamp()
      });
    }

    modal.hidden = true;
    showMessage(productId ? "Product updated successfully." : "Product added successfully.");
    await loadProducts();
  } catch (error) {
    console.error("Saving product failed:", error);
    $("formError").textContent =
      error.message || "Could not save the product. Please try again.";
    $("formError").hidden = false;
  } finally {
    isSaving = false;
    saveButton.disabled = false;
    saveButton.textContent = $("productId").value ? "Update product" : "Save product";
  }
});

tableBody.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;

  const product = products.find((item) => item.id === button.dataset.id);
  if (!product) return;

  if (button.dataset.action === "edit") {
    openModal(product);
    return;
  }

  if (button.dataset.action === "delete") {
    const confirmed = window.confirm(
      `Delete "${product.name}"? This action cannot be undone.`
    );
    if (!confirmed) return;

    button.disabled = true;

    try {
      await deleteDoc(productDocument(product.id));
      products = products.filter((item) => item.id !== product.id);
      renderProducts();
      showMessage("Product deleted successfully.");
    } catch (error) {
      console.error("Deleting product failed:", error);
      showMessage("Could not delete this product. Check your Firestore rules.", "error");
      button.disabled = false;
    }
  }
});

$("addProductBtn").addEventListener("click", () => openModal());
$("emptyAddBtn").addEventListener("click", () => openModal());
$("closeModalBtn").addEventListener("click", closeModal);
$("cancelBtn").addEventListener("click", closeModal);

modal.addEventListener("click", (event) => {
  if (event.target === modal) closeModal();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !modal.hidden) closeModal();
});

$("searchInput").addEventListener("input", (event) => {
  searchTerm = event.target.value.trim().toLowerCase();
  renderProducts();
});

$("logoutBtn").addEventListener("click", async () => {
  $("logoutBtn").disabled = true;

  try {
    await logoutUser();
    window.location.replace("../auth/login.html");
  } catch (error) {
    console.error("Logout failed:", error);
    showMessage("Logout failed. Please try again.", "error");
    $("logoutBtn").disabled = false;
  }
});

document.querySelectorAll("[data-coming-soon]").forEach((element) => {
  element.addEventListener("click", (event) => {
    event.preventDefault();
    showMessage(`${element.dataset.comingSoon} page will be connected in a later step.`, "info");
  });
});

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.replace("../auth/login.html");
    return;
  }

  currentUser = user;
  $("userName").textContent = user.displayName || user.email || "Seller";
  $("userAvatar").textContent =
    ($("userName").textContent.trim().charAt(0) || "S").toUpperCase();

  try {
    const profileSnapshot = await getDocs(
      collection(db, "users", user.uid, "profileCheckUnused")
    );
    // The profile itself is loaded below from users/{uid}.
    void profileSnapshot;
  } catch {
    // No action needed; the profile document is not a subcollection.
  }

  try {
    const { getDoc } = await import(
      "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js"
    );
    const profileSnapshot = await getDoc(doc(db, "users", user.uid));

    if (profileSnapshot.exists()) {
      const profile = profileSnapshot.data();
      $("userName").textContent = profile.name || user.displayName || user.email || "Seller";
      $("userBusiness").textContent = profile.businessName || "My business";
      $("userAvatar").textContent =
        $("userName").textContent.trim().charAt(0).toUpperCase() || "S";
    }
  } catch (error) {
    console.error("Loading seller profile failed:", error);
  }

  await loadProducts();
});

/* Mobile sidebar navigation */
const productSidebar = document.getElementById("productSidebar");
const productMenuToggle = document.getElementById("menuToggle");
const productSidebarOverlay = document.getElementById("sidebarOverlay");

function closeProductSidebar() {
  productSidebar?.classList.remove("open");
  productSidebarOverlay?.classList.remove("show");
  productMenuToggle?.setAttribute("aria-expanded", "false");
}

productMenuToggle?.addEventListener("click", () => {
  const isOpen = productSidebar?.classList.toggle("open");

  productSidebarOverlay?.classList.toggle("show", Boolean(isOpen));
  productMenuToggle.setAttribute("aria-expanded", String(Boolean(isOpen)));
});

productSidebarOverlay?.addEventListener("click", closeProductSidebar);

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeProductSidebar();
  }
});

productSidebar?.querySelectorAll(".side-nav .nav-link").forEach((link) => {
  link.addEventListener("click", () => {
    if (window.innerWidth <= 700 && !link.hasAttribute("data-coming-soon")) {
      closeProductSidebar();
    }
  });
});
