
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
  onSnapshot,
  runTransaction,
  serverTimestamp,
  updateDoc
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

const $ = (id) => document.getElementById(id);

const sidebar = $("sidebar");
const sidebarOverlay = $("sidebarOverlay");

let currentUser = null;
let customers = [];
let products = [];
let orders = [];
let stopOrdersListener = null;
let noticeTimer = null;

function getDeliveryCharge() {
  const input = $("deliveryCharge");
  const value = input.value.trim();

  if (value === "") return 0;

  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? amount : 0;
}

const VALID_STATUSES = ["Pending", "Processing", "Delivered", "Cancelled"];

const money = (value) =>
  new Intl.NumberFormat("en-BD", {
    style: "currency",
    currency: "BDT",
    maximumFractionDigits: 2
  }).format(Number(value) || 0);

const escapeHTML = (value = "") =>
  String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);

function userCollection(name) {
  if (!currentUser) throw new Error("Please sign in again.");
  return collection(db, "users", currentUser.uid, name);
}

function userDocument(name, id) {
  if (!currentUser) throw new Error("Please sign in again.");
  return doc(db, "users", currentUser.uid, name, id);
}

function showNotice(message, type = "warning") {
  const element = $("ordersNotice");
  element.textContent = message;
  element.hidden = false;
  element.classList.toggle("notice-success", type === "success");
  element.classList.toggle("notice-error", type === "error");

  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => {
    element.hidden = true;
  }, 5000);
}

function showFormFeedback(message, type = "error") {
  const element = $("orderFormFeedback");
  element.textContent = message;
  element.hidden = !message;
  element.classList.toggle("success", type === "success");
}

function showProfileFeedback(message, type = "error") {
  const element = $("profileFeedback");
  element.textContent = message;
  element.hidden = !message;
  element.classList.toggle("success", type === "success");
  element.classList.toggle("error", type === "error");
}

function formatDate(value) {
if (!value) return "—";

  const date = typeof value.toDate === "function"
    ? value.toDate()
    : new Date(value);

  if (Number.isNaN(date.getTime())) return "—";

  return date.toLocaleString("en-BD", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true
  });
}

function orderDate(order) {
  return order.createdAt || order.updatedAt || null;
}

function getOrderNumber(order) {
  return order.orderNumber || order.id;
}

function getOrderItems(order) {
  if (Array.isArray(order.items)) return order.items;
  return [];
}

function getOrderTotal(order) {
  return Number(order.total) || 0;
}

// print function for printing the receipt of the order

function printReceipt(orderId) {
  const order = orders.find((item) => item.id === orderId);

  if (!order) {
    showNotice("Order not found.", "error");
    return;
  }

  const items = getOrderItems(order);
  const printWindow = window.open("", "_blank", "width=800,height=700");

  if (!printWindow) {
    showNotice("Please allow pop-ups to print the receipt.", "error");
    return;
  }

  const itemRows = items.map((item) => `
    <tr>
      <td>${escapeHTML(item.productName || "Product")}</td>
      <td>${Number(item.quantity) || 0}</td>
      <td>${escapeHTML(money(item.unitPrice))}</td>
      <td>${escapeHTML(money(item.lineTotal ??
        (Number(item.quantity || 0) * Number(item.unitPrice || 0))))}</td>
    </tr>
  `).join("");

  printWindow.document.write(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>Order Receipt</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          max-width: 720px;
          margin: 30px auto;
          padding: 20px;
          color: #24334d;
        }
        h2 { margin-bottom: 5px; }
        .muted { color: #64748b; font-size: 13px; }
        table {
          width: 100%;
          border-collapse: collapse;
          margin: 24px 0;
        }
        th, td {
          padding: 10px 6px;
          border-bottom: 1px solid #e5e7eb;
          text-align: left;
        }
        .total {
          text-align: right;
          font-size: 18px;
          font-weight: bold;
        }
        @media print {
          body { margin: 0; padding: 10px; }
        }
      </style>
    </head>
    <body>
      <h2>${escapeHTML($("userBusiness").textContent)}</h2>
      <p class="muted">Order receipt</p>
      <hr>
      <p>
        <strong>Order:</strong> ${escapeHTML(getOrderNumber(order))}<br>
        <strong>Date:</strong> ${escapeHTML(formatDate(orderDate(order)))}<br>
        <strong>Customer:</strong> ${escapeHTML(order.customerName || "Customer")}<br>
        <strong>Phone:</strong> ${escapeHTML(order.customerPhone || "—")}<br>
        <strong>Status:</strong> ${escapeHTML(order.status || "Pending")}
      </p>
      <table>
        <thead>
          <tr><th>Product</th><th>Qty</th><th>Price</th><th>Total</th></tr>
        </thead>
        <tbody>${itemRows}</tbody>
      </table>
      <p>Subtotal: ${escapeHTML(money(order.subtotal))}</p>
      <p>Delivery charge: ${escapeHTML(money(order.deliveryCharge))}</p>
      <p class="total">Grand total: ${escapeHTML(money(order.total))}</p>
      <p style="text-align:center;margin-top:35px">Thank you for your order!</p>
      <script>
        window.onload = () => window.print();
      <\/script>
    </body>
    </html>
  `);

  printWindow.document.close();
}

function getStatusClass(status) {
  return ({
    Pending: "status-pending",
    Processing: "status-processing",
    Delivered: "status-delivered",
    Cancelled: "status-cancelled"
  })[status] || "status-pending";
}

function statusBadge(status) {
  return `<span class="order-status ${getStatusClass(status)}">${escapeHTML(status || "Pending")}</span>`;
}

/* Shared responsive sidebar */
$("menuToggle").addEventListener("click", () => {
  sidebar.classList.toggle("open");
  sidebarOverlay.classList.toggle("show");
});

sidebarOverlay.addEventListener("click", closeSidebar);

function closeSidebar() {
  sidebar.classList.remove("open");
  sidebarOverlay.classList.remove("show");
}

/* Coming-soon navigation items */
document.querySelectorAll("[data-coming-soon]").forEach((link) => {
  link.addEventListener("click", (event) => {
    event.preventDefault();
    showNotice(`${link.dataset.comingSoon} will be available in a future update.`);
  });
});

/* Authentication and initialization */
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    if (stopOrdersListener) stopOrdersListener();
    window.location.replace("../auth/login.html");
    return;
  }

  currentUser = user;

  try {
    await loadProfile();
    await loadCustomers();
    await loadProducts();
    startOrdersListener();
  } catch (error) {
    console.error("Orders initialization failed:", error);
    showNotice("Some order data could not be loaded. Check Firebase configuration and Firestore rules.", "error");
  }
});

$("logoutBtn").addEventListener("click", async () => {
  try {
    if (stopOrdersListener) stopOrdersListener();
    await signOut(auth);
    window.location.replace("../auth/login.html");
  } catch (error) {
    console.error(error);
    showNotice("Could not log out. Please try again.", "error");
  }
});

/* Seller profile: same users/{uid} document as the other pages */
async function loadProfile() {
  const profileRef = userDocument("", "");
  // Use the user document directly rather than a nested collection.
  const sellerRef = doc(db, "users", currentUser.uid);
  const snapshot = await getDoc(sellerRef);
  const profile = snapshot.exists() ? snapshot.data() : {};

  const name = profile.name || profile.fullName || currentUser.displayName || "Seller";
  const businessName = profile.businessName || "Your business";

  $("userName").textContent = name;
  $("userBusiness").textContent = businessName;
  $("userAvatar").textContent = name.trim().charAt(0).toUpperCase() || "S";

  $("profileName").value = profile.name || profile.fullName || currentUser.displayName || "";
  $("profileBusinessName").value = profile.businessName || "";
  $("profileEmail").value = currentUser.email || "";
  $("profilePhone").value = profile.phone || "";
}

$("profileTrigger").addEventListener("click", () => {
  $("profileModal").hidden = false;
});

function closeProfile() {
  $("profileModal").hidden = true;
  showProfileFeedback("");
}

$("closeProfileBtn").addEventListener("click", closeProfile);
$("cancelProfileBtn").addEventListener("click", closeProfile);

document.querySelectorAll("[data-close-profile]").forEach((element) => {
  element.addEventListener("click", closeProfile);
});

$("profileForm").addEventListener("submit", async (event) => {
  event.preventDefault();

  const name = $("profileName").value.trim();
  const businessName = $("profileBusinessName").value.trim();
  const phone = $("profilePhone").value.trim();

  if (!name || !businessName) {
    showProfileFeedback("Name and business name are required.");
    return;
  }

  const button = $("saveProfileBtn");
  button.disabled = true;

  try {
    await updateDoc(doc(db, "users", currentUser.uid), {
      name,
      businessName,
      phone,
      updatedAt: serverTimestamp()
    });

    $("userName").textContent = name;
    $("userBusiness").textContent = businessName;
    $("userAvatar").textContent = name.charAt(0).toUpperCase();

    showProfileFeedback("Profile updated successfully.", "success");
  } catch (error) {
    console.error("Profile update failed:", error);
    showProfileFeedback("Could not save the profile. Check your Firestore rules.");
  } finally {
    button.disabled = false;
  }
});

/* Load customers */
async function loadCustomers() {
  const snapshot = await getDocs(userCollection("customers"));

  customers = snapshot.docs.map((item) => ({
    id: item.id,
    ...item.data()
  })).sort((a, b) =>
    String(a.name || "").localeCompare(String(b.name || ""))
  );

  renderCustomerOptions();
}

/* Load products */
async function loadProducts() {
  const snapshot = await getDocs(userCollection("products"));

  products = snapshot.docs.map((item) => ({
    id: item.id,
    ...item.data()
  }));

  renderProductOptions();
}

function renderCustomerOptions() {
  const select = $("orderCustomer");
  const previousValue = select.value;

  select.innerHTML = '<option value="">Select a customer</option>';

  customers.forEach((customer) => {
    const option = document.createElement("option");
    option.value = customer.id;
    option.textContent = `${customer.name || "Unnamed customer"}${customer.phone ? ` — ${customer.phone}` : ""}`;
    select.appendChild(option);
  });

  if (customers.some((customer) => customer.id === previousValue)) {
    select.value = previousValue;
  }

  $("customerHelp").textContent = customers.length
    ? `${customers.length} customer(s) available.`
    : "Add a customer on the Customers page before creating an order.";
}

function renderProductOptions(select, selectedId = "") {
  
  if (!select) {
    document.querySelectorAll("#orderItemsContainer .item-product")
      .forEach((productSelect) => {
        const currentValue = productSelect.value;
        renderProductOptions(productSelect, currentValue);
      });
    return;
  }

  select.innerHTML = '<option value="">Select a product</option>';

  products.forEach((product) => {
    const stock = Number(product.stock) || 0;
    const price = Number(product.sellingPrice) || 0;

    const option = document.createElement("option");
    option.value = product.id;
    option.disabled = stock <= 0;
    option.textContent =
      `${product.name || "Unnamed product"} — ${money(price)} · Stock: ${stock}`;

    select.appendChild(option);
  });

  if (products.some((product) => product.id === selectedId)) {
    select.value = selectedId;
  }
}

/* Order form */
function openOrderModal() {
  if (!customers.length) {
    showNotice("Please add a customer before creating an order.");
    return;
  }

  if (!products.some((product) => Number(product.stock) > 0)) {
    showNotice("Add a product with available stock before creating an order.");
    return;
  }

  $("orderForm").reset();
  $("orderStatus").value = "Pending";
  $("deliveryArea").value = "inside";
  $("orderItemsContainer").innerHTML = "";
  showFormFeedback("");

  addOrderItemRow();
  updateOrderTotals();
  $("orderModal").hidden = false;
}

function closeOrderModal() {
  $("orderModal").hidden = true;
  showFormFeedback("");
}

$("createOrderBtn").addEventListener("click", openOrderModal);
$("closeOrderBtn").addEventListener("click", closeOrderModal);
$("cancelOrderBtn").addEventListener("click", closeOrderModal);

document.querySelectorAll("[data-close-order]").forEach((element) => {
  element.addEventListener("click", closeOrderModal);
});

$("addOrderItemBtn").addEventListener("click", () => {
  addOrderItemRow();
});

function addOrderItemRow() {
  const row = document.createElement("div");
  row.className = "order-item-row";

  const productField = document.createElement("div");
  productField.className = "order-field";
  const productLabel = document.createElement("label");
  productLabel.textContent = "Product";
  const productSelect = document.createElement("select");
  productSelect.className = "item-product";
  productSelect.required = true;
  renderProductOptions(productSelect);
  productField.append(productLabel, productSelect);

  const quantityField = document.createElement("div");
  quantityField.className = "order-field item-quantity-field";
  const quantityLabel = document.createElement("label");
  quantityLabel.textContent = "Quantity";
  const quantityInput = document.createElement("input");
  quantityInput.className = "item-quantity";
  quantityInput.type = "number";
  quantityInput.min = "1";
  quantityInput.step = "1";
  quantityInput.value = "1";
  quantityInput.required = true;
  quantityField.append(quantityLabel, quantityInput);

  const priceField = document.createElement("div");
  priceField.className = "order-field item-price-field";
  const priceLabel = document.createElement("label");
  priceLabel.textContent = "Unit price";
  const priceInput = document.createElement("input");
  priceInput.className = "item-price";
  priceInput.type = "number";
  priceInput.min = "0";
  priceInput.step = "0.01";
  priceInput.required = true;
  priceInput.placeholder = "0.00";
  priceField.append(priceLabel, priceInput);

  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.className = "remove-order-item";
  removeButton.setAttribute("aria-label", "Remove item");
  removeButton.innerHTML = '<i class="bi bi-trash"></i>';

  const lineTotal = document.createElement("div");
  lineTotal.className = "item-line-total";
  lineTotal.textContent = money(0);

  productSelect.addEventListener("change", () => {
    const product = products.find((item) => item.id === productSelect.value);

    if (product) {
      priceInput.value = String(Math.max(0, Number(product.sellingPrice) || 0));
      quantityInput.max = String(Number(product.stock) || 0);
    } else {
      priceInput.value = "";
      quantityInput.removeAttribute("max");
    }

    updateOrderTotals();
  });

  [quantityInput, priceInput].forEach((input) => {
    input.addEventListener("input", updateOrderTotals);
  });

  removeButton.addEventListener("click", () => {
    row.remove();

    if (!$("orderItemsContainer").children.length) {
      addOrderItemRow();
    }

    updateOrderTotals();
  });

  row.append(productField, quantityField, priceField, lineTotal, removeButton);
  $("orderItemsContainer").appendChild(row);
  updateOrderTotals();
}


function readFormItems() {
  return [...$("orderItemsContainer").querySelectorAll(".order-item-row")].map((row) => {
    const productId = row.querySelector(".item-product").value;
    const quantity = Number(row.querySelector(".item-quantity").value);
    const unitPrice = Number(row.querySelector(".item-price").value);

    return {
      productId,
      quantity,
      unitPrice
    };
  });
}


function updateOrderTotals() {
  let subtotal = 0;

  $("orderItemsContainer")
    .querySelectorAll(".order-item-row")
    .forEach((row) => {
      const quantity =
        Number(row.querySelector(".item-quantity").value) || 0;

      const price =
        Number(row.querySelector(".item-price").value) || 0;

      const lineTotal = quantity * price;
      subtotal += lineTotal;

      const totalElement = row.querySelector(".item-line-total");

      if (totalElement) {
        totalElement.textContent = money(lineTotal);
      }
    });

  const delivery = getDeliveryCharge();
  const grandTotal = subtotal + delivery;

  $("orderSubtotal").textContent = money(subtotal);
  $("orderDeliveryCharge").textContent = money(delivery);
  $("orderGrandTotal").textContent = money(grandTotal);
}

$("deliveryArea").addEventListener("change", updateOrderTotals);

$("deliveryCharge").addEventListener("input", updateOrderTotals);

$("deliveryArea").addEventListener("change", updateOrderTotals);

/* Create an order and decrement stock atomically */
$("orderForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  showFormFeedback("");

  const customerId = $("orderCustomer").value;
  const deliveryArea = $("deliveryArea").value;
  const notes = $("orderNotes").value.trim();
  const submittedItems = readFormItems();
  const deliveryInput = $("deliveryCharge").value.trim();
  const deliveryCharge = Number(deliveryInput);

  if (
    deliveryInput === "" ||
    !Number.isFinite(deliveryCharge) ||
    deliveryCharge < 0
  ) {
    showFormFeedback("Please enter a valid delivery charge.");
    $("deliveryCharge").focus();
    return;
  }

  const customer = customers.find((item) => item.id === customerId);

  if (!customer) {
    showFormFeedback("Please select a valid customer.");
    return;
  }

  if (!submittedItems.length || submittedItems.some((item) =>
    !item.productId ||
    !Number.isInteger(item.quantity) ||
    item.quantity < 1 ||
    !Number.isFinite(item.unitPrice) ||
    item.unitPrice < 0
  )) {
    showFormFeedback("Select a product and enter a valid quantity and unit price for every item.");
    return;
  }

  // Prevent duplicate product lines from bypassing stock validation.
  const quantityByProduct = new Map();

  for (const item of submittedItems) {
    quantityByProduct.set(
      item.productId,
      (quantityByProduct.get(item.productId) || 0) + item.quantity
    );
  }

  const button = $("saveOrderBtn");
  button.disabled = true;

  try {
    const orderRef = doc(userCollection("orders"));
    const itemRefs = submittedItems.map(() => doc(collection(orderRef, "items")));
    const deliveryCharge = getDeliveryCharge();

    await runTransaction(db, async (transaction) => {
      const productSnapshots = new Map();

      // All reads occur before writes inside this transaction.
      for (const productId of quantityByProduct.keys()) {
        const productRef = userDocument("products", productId);
        const snapshot = await transaction.get(productRef);

        if (!snapshot.exists()) {
          throw new Error("A selected product no longer exists. Reload products and try again.");
        }

        const productData = snapshot.data();
        const availableStock = Number(productData.stock) || 0;
        const requiredQuantity = quantityByProduct.get(productId);

        if (availableStock < requiredQuantity) {
          throw new Error(
            `Insufficient stock for "${productData.name || "a selected product"}". Available: ${availableStock}.`
          );
        }

        productSnapshots.set(productId, {
          ref: productRef,
          data: productData,
          availableStock
        });
      }

      const savedItems = submittedItems.map((item, index) => {
        const product = productSnapshots.get(item.productId).data;

        return {
          productId: item.productId,
          productName: product.name || "Product",
          sku: product.sku || "",
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          lineTotal: item.quantity * item.unitPrice
        };
      });

      const subtotal = savedItems.reduce((sum, item) => sum + item.lineTotal, 0);
      const total = subtotal + deliveryCharge;
      const now = serverTimestamp();

      const orderNumber = `ORD-${Date.now().toString(36).toUpperCase()}-${orderRef.id.slice(0, 5).toUpperCase()}`;

      transaction.set(orderRef, {
        orderNumber,
        customerId: customer.id,
        customerName: customer.name || "",
        customerPhone: customer.phone || "",
        customerEmail: customer.email || "",
        customerAddress: customer.address || "",
        deliveryArea,
        deliveryCharge,
        items: savedItems,
        itemCount: savedItems.reduce((sum, item) => sum + item.quantity, 0),
        subtotal,
        total,
        status: "Pending",
        notes,
        stockRestored: false,
        createdAt: now,
        updatedAt: now
      });

      savedItems.forEach((item, index) => {
        transaction.set(itemRefs[index], {
          ...item,
          createdAt: now
        });
      });

      for (const [productId, requiredQuantity] of quantityByProduct.entries()) {
        const productSnapshot = productSnapshots.get(productId);

        transaction.update(productSnapshot.ref, {
          stock: productSnapshot.availableStock - requiredQuantity,
          updatedAt: now
        });
      }
    });

    closeOrderModal();
    showNotice("Order created and stock updated successfully.", "success");

    await Promise.all([loadProducts()]);
  } catch (error) {
    console.error("Order creation failed:", error);
    showFormFeedback(error.message || "Could not create the order. Please try again.");
  } finally {
    button.disabled = false;
  }
});

/* Realtime order list */
function startOrdersListener() {
  if (stopOrdersListener) stopOrdersListener();

  stopOrdersListener = onSnapshot(
    userCollection("orders"),
    (snapshot) => {
      orders = snapshot.docs.map((item) => ({
        id: item.id,
        ...item.data()
      }));

      orders.sort((a, b) => {
        const dateA = orderDate(a);
        const dateB = orderDate(b);

        const timeA = dateA?.toMillis
          ? dateA.toMillis()
          : new Date(dateA || 0).getTime();

        const timeB = dateB?.toMillis
          ? dateB.toMillis()
          : new Date(dateB || 0).getTime();

        return timeB - timeA;
      });

      renderOrders();
    },
    (error) => {
      console.error("Orders listener failed:", error);
      showNotice("Could not load orders. Check your Firestore rules.", "error");
      $("ordersTableBody").innerHTML =
        '<tr><td colspan="7" class="orders-empty">Could not load orders.</td></tr>';
    }
  );
}

function getFilteredOrders() {
  const query = $("orderSearch").value.trim().toLowerCase();
  const status = $("statusFilter").value;

  return orders.filter((order) => {
    const searchable = [
      getOrderNumber(order),
      order.customerName,
      order.customerPhone
    ].join(" ").toLowerCase();

    return (!query || searchable.includes(query)) &&
      (status === "all" || order.status === status);
  });
}

$("orderSearch").addEventListener("input", renderOrders);
$("statusFilter").addEventListener("change", renderOrders);

function renderOrders() {
  const filteredOrders = getFilteredOrders();

  const now = new Date();
  const monthStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    1
  );
  const nextMonthStart = new Date(
    now.getFullYear(),
    now.getMonth() + 1,
    1
  );

  const getTimestamp = (value) => {
    if (!value) return 0;

    if (typeof value.toMillis === "function") {
      return value.toMillis();
    }

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 0 : date.getTime();
  };

  const monthlyOrders = orders.filter((order) => {
    const timestamp = getTimestamp(order.createdAt);

    return timestamp >= monthStart.getTime() &&
      timestamp < nextMonthStart.getTime();
  });

  $("totalOrders").textContent = String(orders.length);

  $("pendingOrders").textContent = String(
    orders.filter((order) => order.status === "Pending").length
  );

  $("deliveredOrders").textContent = String(
    orders.filter((order) => order.status === "Delivered").length
  );

  $("cancelledOrders").textContent = String(
    orders.filter((order) => order.status === "Cancelled").length
  );

  const monthlyValue = monthlyOrders
    .filter((order) => order.status !== "Cancelled")
    .reduce((sum, order) => sum + getOrderTotal(order), 0);

  $("orderValue").textContent = money(monthlyValue);

  if (!filteredOrders.length) {
    const message = orders.length
      ? "No orders match your search."
      : "No orders yet. Create your first order.";

    $("ordersTableBody").innerHTML =
      `<tr><td colspan="7" class="orders-empty">${escapeHTML(message)}</td></tr>`;

    $("ordersMobileList").innerHTML =
      `<div class="orders-empty">${escapeHTML(message)}</div>`;

    return;
  }

  $("ordersTableBody").innerHTML = filteredOrders.map((order) => {
    const items = getOrderItems(order);

    return `
      <tr>
        <td><span class="order-number">${escapeHTML(getOrderNumber(order))}</span></td>
        <td>
          <div class="order-customer">
            <strong>${escapeHTML(order.customerName || "Customer")}</strong>
            <small>${escapeHTML(order.customerPhone || "")}</small>
          </div>
        </td>
        <td>${escapeHTML(formatDate(orderDate(order)))}</td>
        <td>${Number(order.itemCount) || items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0)}</td>
        <td><strong>${escapeHTML(money(getOrderTotal(order)))}</strong></td>
        <td>${statusBadge(order.status || "Pending")}</td>
        <td>
          <div class="order-actions">
            <button class="order-icon-btn" type="button" data-view-order="${escapeHTML(order.id)}" aria-label="View order">
              <i class="bi bi-eye"></i>
            </button>
            <button
              class="order-icon-btn"
              type="button"
              data-print-order="${escapeHTML(order.id)}"
              aria-label="Print receipt"
              title="Print receipt"
              >
              <i class="bi bi-printer"></i>
            </button>
            ${canCancel(order) ? `
              <button class="order-icon-btn danger" type="button" data-cancel-order="${escapeHTML(order.id)}" aria-label="Cancel order">
                <i class="bi bi-x-circle"></i>
              </button>` : ""}
          </div>
        </td>
      </tr>`;
  }).join("");

  $("ordersMobileList").innerHTML = filteredOrders.map((order) => `
    <article class="order-mobile-card">
      <div class="order-mobile-top">
        <strong class="order-number">${escapeHTML(getOrderNumber(order))}</strong>
        ${statusBadge(order.status || "Pending")}
      </div>
      <div class="order-mobile-customer">
        <strong>${escapeHTML(order.customerName || "Customer")}</strong>
        <small>${escapeHTML(order.customerPhone || "")}</small>
      </div>
      <div class="order-mobile-row">
        <span>Date</span><strong>${escapeHTML(formatDate(orderDate(order)))}</strong>
      </div>
      <div class="order-mobile-row">
        <span>Items</span><strong>${Number(order.itemCount) || getOrderItems(order).reduce((sum, item) => sum + (Number(item.quantity) || 0), 0)}</strong>
      </div>
      <div class="order-mobile-row">
        <span>Total</span><strong>${escapeHTML(money(getOrderTotal(order)))}</strong>
      </div>
      <div class="order-mobile-actions">
        <button class="order-icon-btn" type="button" data-view-order="${escapeHTML(order.id)}" aria-label="View order">
          <i class="bi bi-eye"></i> View
        </button>
        <button
            class="order-icon-btn"
            type="button"
            data-print-order="${escapeHTML(order.id)}"
            aria-label="Print receipt"
            title="Print receipt"
          >
            <i class="bi bi-printer"></i>
        </button>
        ${canCancel(order) ? `
          <button class="order-icon-btn danger" type="button" data-cancel-order="${escapeHTML(order.id)}" aria-label="Cancel order">
            <i class="bi bi-x-circle"></i> Cancel
          </button>` : ""}
      </div>
    </article>
  `).join("");
}

function canCancel(order) {
  return ["Pending", "Processing","Delivered"].includes(order.status) &&
    order.stockRestored !== true;
}

/* Delegate buttons for both desktop and mobile order lists */
document.addEventListener("click", async (event) => {
  const viewButton = event.target.closest("[data-view-order]");
  if (viewButton) {
    openOrderDetails(viewButton.dataset.viewOrder);
    return;
  }
  const printButton = event.target.closest("[data-print-order]");

  if (printButton) {
    printReceipt(printButton.dataset.printOrder);
    return;
  }

  const cancelButton = event.target.closest("[data-cancel-order]");
  if (cancelButton) {
    await cancelOrder(cancelButton.dataset.cancelOrder);
  }
});

/* Order detail view */
function openOrderDetails(orderId) {
  const order = orders.find((item) => item.id === orderId);
  if (!order) return;

  const items = getOrderItems(order);

  $("orderDetailsContent").innerHTML = `
    <div class="details-grid">
      <div class="details-cell">
        <span>Order ID</span>
        <strong>${escapeHTML(getOrderNumber(order))}</strong>
      </div>
      <div class="details-cell">
        <span>Status</span>
        ${statusBadge(order.status || "Pending")}
      </div>
      <div class="details-cell">
        <span>Customer</span>
        <strong>${escapeHTML(order.customerName || "Customer")}</strong>
      </div>
      <div class="details-cell">
        <span>Phone</span>
        <strong>${escapeHTML(order.customerPhone || "—")}</strong>
      </div>
      <div class="details-cell">
        <span>Order date</span>
        <strong>${escapeHTML(formatDate(orderDate(order)))}</strong>
      </div>
      <div class="details-cell">
        <span>Delivery area</span>
        <strong>${order.deliveryArea === "outside" ? "Outside Dhaka" : "Inside Dhaka"}</strong>
      </div>
    </div>

    <h3 style="font-size:14px;font-weight:750;">Items</h3>
    <div class="orders-table-wrap">
      <table class="details-items">
        <thead>
          <tr><th>Product</th><th>Qty</th><th>Unit price</th><th>Total</th></tr>
        </thead>
        <tbody>
          ${items.map((item) => `
            <tr>
              <td>${escapeHTML(item.productName || "Product")}</td>
              <td>${Number(item.quantity) || 0}</td>
              <td>${escapeHTML(money(item.unitPrice))}</td>
              <td>${escapeHTML(money(item.lineTotal ?? ((Number(item.quantity) || 0) * (Number(item.unitPrice) || 0))))}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>

    <div class="order-totals">
      <div><span>Subtotal</span><strong>${escapeHTML(money(order.subtotal))}</strong></div>
      <div><span>Delivery charge</span><strong>${escapeHTML(money(order.deliveryCharge))}</strong></div>
      <div class="order-grand-total"><span>Total</span><strong>${escapeHTML(money(order.total))}</strong></div>
    </div>

    ${order.notes ? `
      <div class="details-cell">
        <span>Notes</span><strong>${escapeHTML(order.notes)}</strong>
      </div>` : ""}

    ${["Pending", "Processing"].includes(order.status) ? `
      <div class="details-actions">
        <select id="detailStatusSelect" aria-label="Update order status">
          <option value="Pending" ${order.status === "Pending" ? "selected" : ""}>Pending</option>
          <option value="Processing" ${order.status === "Processing" ? "selected" : ""}>Processing</option>
          <option value="Delivered" ${order.status === "Delivered" ? "selected" : ""}>Delivered</option>
        </select>
        <button class="primary-btn" type="button" id="saveOrderStatusBtn" data-status-order="${escapeHTML(order.id)}">
          Update status
        </button>
      </div>` : ""}
  `;

  $("orderDetailsModal").hidden = false;
}

function closeDetailsModal() {
  $("orderDetailsModal").hidden = true;
}

$("closeDetailsBtn").addEventListener("click", closeDetailsModal);

document.querySelectorAll("[data-close-details]").forEach((element) => {
  element.addEventListener("click", closeDetailsModal);
});

document.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-status-order]");
  if (!button) return;

  const orderId = button.dataset.statusOrder;
  const nextStatus = $("detailStatusSelect")?.value;

  if (!VALID_STATUSES.includes(nextStatus) || nextStatus === "Cancelled") {
    showNotice("Choose a valid status.", "error");
    return;
  }

  button.disabled = true;

  try {
    await runTransaction(db, async (transaction) => {
      const orderRef = userDocument("orders", orderId);
      const snapshot = await transaction.get(orderRef);

      if (!snapshot.exists()) throw new Error("Order no longer exists.");

      const order = snapshot.data();

      if (!["Pending", "Processing"].includes(order.status)) {
        throw new Error("This order can no longer be updated.");
      }

      if (!["Pending", "Processing", "Delivered"].includes(nextStatus)) {
        throw new Error("Invalid order status.");
      }

      transaction.update(orderRef, {
        status: nextStatus,
        updatedAt: serverTimestamp()
      });
    });

    closeDetailsModal();
    showNotice("Order status updated.", "success");
  } catch (error) {
    console.error("Status update failed:", error);
    showNotice(error.message || "Could not update order status.", "error");
  } finally {
    button.disabled = false;
  }
});

/* Cancel only Pending or Processing orders; restore stock in the same transaction */
async function cancelOrder(orderId) {
  const existingOrder = orders.find((item) => item.id === orderId);
  if (!existingOrder || !canCancel(existingOrder)) {
    showNotice("This order can no longer be cancelled.", "error");
    return;
  }

const confirmed = window.confirm(
  `Cancel order ${getOrderNumber(existingOrder)}? ` +
  `Stock will be restored. For delivered orders, confirm that ` +
  `the returned products are being added back to inventory.`
);

  if (!confirmed) return;

  try {
    await runTransaction(db, async (transaction) => {
      const orderRef = userDocument("orders", orderId);
      const orderSnapshot = await transaction.get(orderRef);

      if (!orderSnapshot.exists()) {
        throw new Error("Order no longer exists.");
      }

      const order = orderSnapshot.data();

      if (!["Pending", "Processing","Delivered"].includes(order.status)) {
        throw new Error("This order can no longer be cancelled.");
      }

      if (order.stockRestored === true) {
        throw new Error("Stock has already been restored for this order.");
      }

      const items = Array.isArray(order.items) ? order.items : [];

      if (!items.length) {
        throw new Error("This order has no saved items. Stock was not changed.");
      }

      const restoreByProduct = new Map();

      for (const item of items) {
        const productId = item.productId;
        const quantity = Number(item.quantity);

        if (!productId || !Number.isInteger(quantity) || quantity < 1) {
          throw new Error("Order item data is invalid. Stock was not changed.");
        }

        restoreByProduct.set(
          productId,
          (restoreByProduct.get(productId) || 0) + quantity
        );
      }

      const productSnapshots = new Map();

      // Complete all reads before writing.
      for (const productId of restoreByProduct.keys()) {
        const productRef = userDocument("products", productId);
        const productSnapshot = await transaction.get(productRef);

        if (!productSnapshot.exists()) {
          throw new Error(
            "A product in this order no longer exists. Cancellation stopped to avoid an incomplete stock restoration."
          );
        }

        productSnapshots.set(productId, {
          ref: productRef,
          data: productSnapshot.data()
        });
      }

      const now = serverTimestamp();

      for (const [productId, quantity] of restoreByProduct.entries()) {
        const product = productSnapshots.get(productId);

        transaction.update(product.ref, {
          stock: (Number(product.data.stock) || 0) + quantity,
          updatedAt: now
        });
      }

      transaction.update(orderRef, {
        status: "Cancelled",
        stockRestored: true,
        updatedAt: now
      });
    });

    showNotice("Order cancelled and stock restored.", "success");
    await loadProducts();
  } catch (error) {
    console.error("Order cancellation failed:", error);
    showNotice(error.message || "Could not cancel the order.", "error");
  }
}

/* Escape key closes the topmost modal */
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;

  if (!$("orderDetailsModal").hidden) {
    closeDetailsModal();
  } else if (!$("orderModal").hidden) {
    closeOrderModal();
  } else if (!$("profileModal").hidden) {
    closeProfile();
  } else {
    closeSidebar();
  }
});
