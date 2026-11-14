/*
 * Orders page: "Order requests" inbox.
 *
 * Customers submit the public Smart Order Link form -> publicStores/{uid}/orderRequests.
 * Nothing touches orders / customers / stock / analytics until the seller approves.
 *
 * Approve  = ONE atomic transaction: create order + items, add (or reuse) customer,
 *            reduce stock, count monthly usage (Free plan limit), notify, delete request.
 * Reject   = delete the request.
 */

import { auth, db } from "../config/firebase.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";

import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  runTransaction,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

import { syncPublicStore } from "../services/public-store.js";

const $ = (id) => document.getElementById(id);

const FREE_MONTHLY_ORDER_LIMIT = 10;
const MAX_LINE_QTY = 100;

let currentUser = null;
let requests = [];
let products = [];
let customers = [];
let activeRequestId = null;
let noticeTimer = null;
let busy = false;

/* ---------- helpers ---------- */

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

function getDateValue(value) {
  if (!value) return null;
  const date = typeof value.toDate === "function" ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value) {
  const date = getDateValue(value);
  if (!date) return "Just now";

  return date.toLocaleString("en-BD", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true
  });
}

function monthKeyOf(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

const normalizePhone = (value) => {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
};

const normalizeEmail = (value) => String(value || "").trim().toLowerCase();

/**
 * Same person = same phone number OR same email.
 * Phone is compared by its last 10 digits (so 01712..., +88 01712... and 880 1712... match).
 * Phone match wins over email match. Empty values never match.
 */
function findExistingCustomer(list, { phone, email }) {
  const phoneKey = normalizePhone(phone);
  const emailKey = normalizeEmail(email);

  if (phoneKey.length >= 7) {
    const byPhone = list.find((customer) => normalizePhone(customer.phone) === phoneKey);
    if (byPhone) return { customer: byPhone, by: "phone number" };
  }

  if (emailKey) {
    const byEmail = list.find((customer) => normalizeEmail(customer.email) === emailKey);
    if (byEmail) return { customer: byEmail, by: "email" };
  }

  return null;
}

const userCollection = (name) => collection(db, "users", currentUser.uid, name);
const userDocument = (name, id) => doc(db, "users", currentUser.uid, name, id);
const requestDocument = (id) =>
  doc(db, "publicStores", currentUser.uid, "orderRequests", id);

function showNotice(message, type = "warning") {
  const element = $("ordersNotice");
  if (!element) return;

  element.textContent = message;
  element.hidden = false;
  element.classList.toggle("notice-success", type === "success");
  element.classList.toggle("notice-error", type === "error");

  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => {
    element.hidden = true;
  }, 5000);
}

function showFeedback(message, { upgrade = false } = {}) {
  const element = $("requestFeedback");
  element.textContent = message;
  element.hidden = !message;

  if (message && upgrade) {
    const link = document.createElement("a");
    link.href = "../subscription/subscription.html";
    link.textContent = " Upgrade to Pro";
    link.className = "request-upgrade-link";
    element.appendChild(link);
  }
}

/* ---------- plan check (same rule as the manual order form) ---------- */

async function syncExpiredSubscription() {
  const profileRef = doc(db, "users", currentUser.uid);

  return runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(profileRef);
    if (!snapshot.exists()) throw new Error("Seller profile not found.");

    const profile = snapshot.data();
    const plan = String(profile.plan || "free").toLowerCase();
    const status = String(profile.subscriptionStatus || "").toLowerCase();
    const expiry = getDateValue(
      profile.subscriptionEnd || profile.subscriptionEndDate || profile.currentPeriodEnd
    );

    const validPro =
      plan === "pro" && status === "active" && expiry && expiry.getTime() > Date.now();

    if (plan === "pro" && !validPro) {
      const newStatus = status === "active" ? "expired" : (status || "inactive");

      transaction.update(profileRef, {
        plan: "free",
        subscriptionStatus: newStatus,
        updatedAt: serverTimestamp()
      });
    }

    return profile;
  });
}

/* ---------- data ---------- */

async function loadSellerData() {
  const [productSnap, customerSnap] = await Promise.all([
    getDocs(userCollection("products")),
    getDocs(userCollection("customers"))
  ]);

  products = productSnap.docs.map((item) => ({ id: item.id, ...item.data() }));
  customers = customerSnap.docs.map((item) => ({ id: item.id, ...item.data() }));
}

const findProduct = (id) => products.find((product) => product.id === id);

/** Never trust request data: keep only well-formed lines, merge duplicates. */
function cleanRequestItems(request) {
  const merged = new Map();

  (Array.isArray(request.items) ? request.items : []).forEach((item) => {
    const productId = typeof item?.productId === "string" ? item.productId : "";
    const quantity = Number(item?.quantity);

    if (!productId || !Number.isInteger(quantity) || quantity < 1) return;

    const entry = merged.get(productId) || {
      productId,
      quantity: 0,
      fallbackName: String(item.productName || "").slice(0, 120)
    };

    entry.quantity = Math.min(MAX_LINE_QTY, entry.quantity + quantity);
    merged.set(productId, entry);
  });

  return [...merged.values()];
}

/* ---------- tabs ---------- */

function setTab(name) {
  const showRequests = name === "requests";

  $("ordersTabPanel").hidden = showRequests;
  $("requestsTabPanel").hidden = !showRequests;

  $("ordersTabBtn").classList.toggle("active", !showRequests);
  $("requestsTabBtn").classList.toggle("active", showRequests);
  $("ordersTabBtn").setAttribute("aria-selected", String(!showRequests));
  $("requestsTabBtn").setAttribute("aria-selected", String(showRequests));

  document.querySelector('a.nav-link[href="orders.html"]')?.classList.toggle("active", !showRequests);
  $("navRequestsLink")?.classList.toggle("active", showRequests);

  const hash = showRequests ? "#requests" : "";
  if (window.location.hash !== hash) {
    history.replaceState(null, "", `${window.location.pathname}${window.location.search}${hash}`);
  }
}

$("ordersTabBtn").addEventListener("click", () => setTab("orders"));
$("requestsTabBtn").addEventListener("click", () => setTab("requests"));
window.addEventListener("hashchange", () =>
  setTab(window.location.hash === "#requests" ? "requests" : "orders")
);

/* ---------- inbox list ---------- */

function estimateTotal(items) {
  return items.reduce((sum, item) => {
    const product = findProduct(item.productId);
    return sum + (product ? (Number(product.sellingPrice) || 0) * item.quantity : 0);
  }, 0);
}

function renderRequests() {
  const list = $("requestsList");

  const sorted = [...requests].sort((a, b) => {
    const timeA = getDateValue(a.createdAt)?.getTime() ?? Date.now();
    const timeB = getDateValue(b.createdAt)?.getTime() ?? Date.now();
    return timeB - timeA;
  });

  if (!sorted.length) {
    list.innerHTML = `
      <div class="requests-empty">
        <span class="requests-empty-icon"><i class="bi bi-inbox"></i></span>
        <strong>No order requests yet</strong>
        <p>Share your smart order link with customers. Their requests will appear here for your approval.</p>
      </div>`;
    return;
  }

  list.innerHTML = sorted.map((request) => {
    const items = cleanRequestItems(request);

    const summary = items.map((item) => {
      const product = findProduct(item.productId);
      const name = product?.name || item.fallbackName || "Unavailable product";
      return `${escapeHTML(name)} × ${item.quantity}`;
    }).join(", ");

    const estimate = estimateTotal(items);

    return `
      <article class="request-card">
        <div class="request-card-top">
          <div class="request-customer">
            <strong>${escapeHTML(request.customerName || "Customer")}</strong>
            <small><i class="bi bi-telephone"></i> ${escapeHTML(request.customerPhone || "—")}</small>
          </div>
          <span class="request-pill"><i class="bi bi-clock-history"></i> New</span>
        </div>

        <p class="request-items">${summary || "No valid items"}</p>

        <div class="request-meta">
          <span><i class="bi bi-geo-alt"></i> ${request.deliveryArea === "outside" ? "Outside Dhaka" : "Inside Dhaka"}</span>
          <span><i class="bi bi-calendar3"></i> ${escapeHTML(formatDate(request.createdAt))}</span>
          <strong>${escapeHTML(money(estimate))} <small>+ delivery</small></strong>
        </div>

        <div class="request-actions">
          <button type="button" class="primary-btn request-review-btn" data-review-request="${escapeHTML(request.id)}">
            <i class="bi bi-eye"></i> Review
          </button>
          <button type="button" class="order-icon-btn danger" data-reject-request="${escapeHTML(request.id)}" aria-label="Remove request" title="Remove request">
            <i class="bi bi-trash"></i>
          </button>
        </div>
      </article>`;
  }).join("");
}

window.addEventListener("sellerspro:requests", (event) => {
  requests = event.detail.requests;
  renderRequests();

  if (activeRequestId && !requests.some((item) => item.id === activeRequestId)) {
    // Removed elsewhere (other tab/device). Close the dialog.
    if (!busy) closeReview();
  }
});

window.addEventListener("sellerspro:requests-error", () => {
  $("requestsList").innerHTML = `
    <div class="requests-empty">
      <span class="requests-empty-icon"><i class="bi bi-exclamation-triangle"></i></span>
      <strong>Could not load requests</strong>
      <p>Check that the publicStores Firestore rules are published.</p>
    </div>`;
});

if (Array.isArray(window.__sellersProRequests)) {
  requests = window.__sellersProRequests;
}

/* ---------- review dialog ---------- */

function openReview(requestId) {
  const request = requests.find((item) => item.id === requestId);
  if (!request) return;

  activeRequestId = requestId;
  showFeedback("");

  $("requestCustomerInfo").innerHTML = `
    <div class="details-cell"><span>Customer</span><strong>${escapeHTML(request.customerName || "—")}</strong></div>
    <div class="details-cell"><span>Phone</span><strong>${escapeHTML(request.customerPhone || "—")}</strong></div>
    <div class="details-cell"><span>Email</span><strong>${escapeHTML(request.customerEmail || "—")}</strong></div>
    <div class="details-cell"><span>Delivery area</span><strong>${request.deliveryArea === "outside" ? "Outside Dhaka" : "Inside Dhaka"}</strong></div>
    <div class="details-cell request-wide"><span>Address</span><strong>${escapeHTML(request.customerAddress || "—")}</strong></div>
    ${request.notes ? `<div class="details-cell request-wide"><span>Customer note</span><strong>${escapeHTML(request.notes)}</strong></div>` : ""}
  `;

  const found = findExistingCustomer(customers, {
    phone: request.customerPhone,
    email: request.customerEmail
  });

  $("requestCustomerHint").textContent = found
    ? `Existing customer found by ${found.by}: ${found.customer.name || "Unnamed"}. No new customer will be added; the order will be linked to them.`
    : "New customer. They will be added to your Customers list when you approve.";

  $("requestDeliveryCharge").value = "0";

  const container = $("requestItemsContainer");
  container.innerHTML = "";

  const items = cleanRequestItems(request);
  items.forEach((item) => container.appendChild(buildReviewRow(item)));

  if (!items.length) {
    container.innerHTML = '<p class="muted">This request has no valid items. Remove it.</p>';
  }

  updateReviewTotals();
  $("requestModal").hidden = false;
}

function buildReviewRow(item) {
  const product = findProduct(item.productId);
  const stock = product ? Number(product.stock) || 0 : 0;
  const unavailable = !product;
  const short = product && stock < item.quantity;

  const row = document.createElement("div");
  row.className = "order-item-row request-item-row";
  row.dataset.productId = item.productId;

  const name = document.createElement("div");
  name.className = "order-field request-item-name";

  const label = document.createElement("label");
  label.textContent = "Product";

  const title = document.createElement("strong");
  title.textContent = product?.name || item.fallbackName || "Unavailable product";

  const hint = document.createElement("small");
  hint.className = "request-stock-hint";

  if (unavailable) {
    hint.textContent = "This product was deleted. Remove this line.";
    hint.classList.add("bad");
  } else if (short) {
    hint.textContent = `Only ${stock} in stock. Lower the quantity.`;
    hint.classList.add("bad");
  } else {
    hint.textContent = `In stock: ${stock}`;
  }

  name.append(label, title, hint);

  const qtyField = document.createElement("div");
  qtyField.className = "order-field item-quantity-field";
  const qtyLabel = document.createElement("label");
  qtyLabel.textContent = "Quantity";
  const qty = document.createElement("input");
  qty.type = "number";
  qty.className = "item-quantity";
  qty.min = "1";
  qty.step = "1";
  qty.max = String(Math.max(1, stock));
  qty.value = String(item.quantity);
  qty.disabled = unavailable;
  qtyField.append(qtyLabel, qty);

  const priceField = document.createElement("div");
  priceField.className = "order-field item-price-field";
  const priceLabel = document.createElement("label");
  priceLabel.textContent = "Unit price";
  const price = document.createElement("input");
  price.type = "number";
  price.className = "item-price";
  price.min = "0";
  price.step = "0.01";
  price.value = String(Math.max(0, Number(product?.sellingPrice) || 0));
  price.disabled = unavailable;
  priceField.append(priceLabel, price);

  const lineTotal = document.createElement("div");
  lineTotal.className = "item-line-total";

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "remove-order-item";
  remove.setAttribute("aria-label", "Remove item");
  remove.innerHTML = '<i class="bi bi-trash"></i>';

  [qty, price].forEach((input) => input.addEventListener("input", updateReviewTotals));

  remove.addEventListener("click", () => {
    row.remove();
    updateReviewTotals();
  });

  row.append(name, qtyField, priceField, lineTotal, remove);
  return row;
}

function readReviewRows() {
  return [...$("requestItemsContainer").querySelectorAll(".request-item-row")].map((row) => ({
    productId: row.dataset.productId,
    quantity: Number(row.querySelector(".item-quantity").value),
    unitPrice: Number(row.querySelector(".item-price").value)
  }));
}

function updateReviewTotals() {
  let subtotal = 0;

  $("requestItemsContainer").querySelectorAll(".request-item-row").forEach((row) => {
    const quantity = Number(row.querySelector(".item-quantity").value) || 0;
    const price = Number(row.querySelector(".item-price").value) || 0;
    const line = quantity * price;

    subtotal += line;
    row.querySelector(".item-line-total").textContent = money(line);
  });

  const delivery = Math.max(0, Number($("requestDeliveryCharge").value) || 0);

  $("requestSubtotal").textContent = money(subtotal);
  $("requestDelivery").textContent = money(delivery);
  $("requestGrandTotal").textContent = money(subtotal + delivery);
}

$("requestDeliveryCharge").addEventListener("input", updateReviewTotals);

function closeReview() {
  $("requestModal").hidden = true;
  activeRequestId = null;
  showFeedback("");
}

$("closeRequestBtn").addEventListener("click", closeReview);
$("cancelRequestBtn").addEventListener("click", closeReview);
document.querySelectorAll("[data-close-request]").forEach((element) =>
  element.addEventListener("click", closeReview)
);

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !$("requestModal").hidden) closeReview();
});

/* ---------- reject ---------- */

async function rejectRequest(requestId) {
  const request = requests.find((item) => item.id === requestId);
  if (!request || busy) return;

  const ok = window.confirm(
    `Remove the request from ${request.customerName || "this customer"}? ` +
    "No order or customer will be created."
  );
  if (!ok) return;

  busy = true;

  try {
    await deleteDoc(requestDocument(requestId));
    if (activeRequestId === requestId) closeReview();
    showNotice("Request removed.", "success");
  } catch (error) {
    console.error("Removing request failed:", error);
    showNotice("Could not remove the request. Please try again.", "error");
  } finally {
    busy = false;
  }
}

$("rejectRequestBtn").addEventListener("click", () => {
  if (activeRequestId) rejectRequest(activeRequestId);
});

document.addEventListener("click", (event) => {
  const review = event.target.closest("[data-review-request]");
  if (review) {
    openReview(review.dataset.reviewRequest);
    return;
  }

  const reject = event.target.closest("[data-reject-request]");
  if (reject) rejectRequest(reject.dataset.rejectRequest);
});

/* ---------- approve (single atomic transaction) ---------- */

async function approveRequest() {
  if (busy || !activeRequestId) return;
  showFeedback("");

  const requestId = activeRequestId;
  const rows = readReviewRows();
  const deliveryInput = $("requestDeliveryCharge").value.trim();
  const deliveryCharge = Number(deliveryInput);

  if (deliveryInput === "" || !Number.isFinite(deliveryCharge) || deliveryCharge < 0) {
    showFeedback("Enter a valid delivery charge.");
    return;
  }

  if (!rows.length) {
    showFeedback("Keep at least one item, or remove the request.");
    return;
  }

  if (rows.some((row) =>
    !Number.isInteger(row.quantity) || row.quantity < 1 || row.quantity > MAX_LINE_QTY ||
    !Number.isFinite(row.unitPrice) || row.unitPrice < 0
  )) {
    showFeedback("Check the quantity and unit price of every item.");
    return;
  }

  busy = true;
  const button = $("approveRequestBtn");
  button.disabled = true;
  $("rejectRequestBtn").disabled = true;

  try {
    // Fresh data so stock / customers are never stale.
    await loadSellerData();
    await syncExpiredSubscription();

    const profileRef = doc(db, "users", currentUser.uid);
    const monthKey = monthKeyOf(new Date());

    const ordersSnapshot = await getDocs(userCollection("orders"));
    const existingMonthlyCount = ordersSnapshot.docs.filter((item) => {
      const created = getDateValue(item.data().createdAt);
      return created && monthKeyOf(created) === monthKey;
    }).length;

    const requestRef = requestDocument(requestId);
    const orderRef = doc(userCollection("orders"));
    const itemRefs = rows.map(() => doc(collection(orderRef, "items")));

    const quantityByProduct = new Map();
    rows.forEach((row) => {
      quantityByProduct.set(
        row.productId,
        (quantityByProduct.get(row.productId) || 0) + row.quantity
      );
    });

    let createdOrderNumber = "";
    let customerResult = null;

    await runTransaction(db, async (transaction) => {
      /* ---- all reads first ---- */
      const requestSnap = await transaction.get(requestRef);

      if (!requestSnap.exists()) {
        throw new Error("This request was already approved or removed.");
      }

      const request = requestSnap.data();
      const allowedIds = new Set(cleanRequestItems(request).map((item) => item.productId));

      if (rows.some((row) => !allowedIds.has(row.productId))) {
        throw new Error("Items do not match the customer's request. Reopen the request.");
      }

      const profileSnap = await transaction.get(profileRef);
      if (!profileSnap.exists()) throw new Error("Seller profile not found.");

      const profile = profileSnap.data();
      const plan = String(profile.plan || "free").toLowerCase();
      const status = String(profile.subscriptionStatus || "").toLowerCase();
      const expiry = getDateValue(
        profile.subscriptionEnd || profile.subscriptionEndDate || profile.currentPeriodEnd
      );

      const proActive =
        plan === "pro" && status === "active" && expiry !== null && expiry.getTime() > Date.now();

      if (plan === "pro" && !proActive) {
        throw new Error(
          "Your Pro subscription has expired. Your account was switched to Free. Please approve again."
        );
      }

      const storedCount =
        profile.orderUsageMonth === monthKey ? Number(profile.monthlyOrderCount) || 0 : 0;
      const monthCount = Math.max(existingMonthlyCount, storedCount);

      if (!proActive && monthCount >= FREE_MONTHLY_ORDER_LIMIT) {
        const error = new Error(
          `Free plan limit reached (${FREE_MONTHLY_ORDER_LIMIT} orders this month). The request stays in your inbox.`
        );
        error.upgrade = true;
        throw error;
      }

      const prefs = profile.notificationPreferences || {};
      const productSnaps = new Map();

      for (const [productId, needed] of quantityByProduct.entries()) {
        const productRef = userDocument("products", productId);
        const snap = await transaction.get(productRef);

        if (!snap.exists()) {
          throw new Error("A product in this request no longer exists. Remove that line.");
        }

        const data = snap.data();
        const available = Number(data.stock) || 0;

        if (available < needed) {
          throw new Error(
            `Insufficient stock for "${data.name || "a product"}". Available: ${available}.`
          );
        }

        productSnaps.set(productId, { ref: productRef, data, available });
      }

      const found = findExistingCustomer(customers, {
        phone: request.customerPhone,
        email: request.customerEmail
      });

      const customerRef = found
        ? userDocument("customers", found.customer.id)
        : doc(userCollection("customers"));

      const customerSnap = found ? await transaction.get(customerRef) : null;
      const customerExists = Boolean(customerSnap && customerSnap.exists());

      customerResult = {
        id: customerRef.id,
        created: !customerExists,
        name: String(request.customerName || "").trim(),
        existingName: found ? (found.customer.name || "Unnamed") : "",
        by: found ? found.by : ""
      };

      /* ---- writes ---- */
      const now = serverTimestamp();

      const savedItems = rows.map((row) => {
        const product = productSnaps.get(row.productId).data;
        return {
          productId: row.productId,
          productName: product.name || "Product",
          sku: product.sku || "",
          quantity: row.quantity,
          unitPrice: row.unitPrice,
          lineTotal: row.quantity * row.unitPrice
        };
      });

      const subtotal = savedItems.reduce((sum, item) => sum + item.lineTotal, 0);
      const total = subtotal + deliveryCharge;

      const orderNumber =
        `ORD-${Date.now().toString(36).toUpperCase()}-${orderRef.id.slice(0, 5).toUpperCase()}`;
      createdOrderNumber = orderNumber;

      // Customer: create new, or only fill blanks on an existing one.
      if (!customerExists) {
        transaction.set(customerRef, {
          name: String(request.customerName || "").trim(),
          phone: String(request.customerPhone || "").trim(),
          email: String(request.customerEmail || "").trim(),
          address: String(request.customerAddress || "").trim(),
          notes: "",
          source: "smart_link",
          createdAt: now,
          updatedAt: now
        });
      } else {
        const existing = customerSnap.data();
        const patch = {};
        if (!existing.phone && request.customerPhone) patch.phone = request.customerPhone;
        if (!existing.email && request.customerEmail) patch.email = request.customerEmail;
        if (!existing.address && request.customerAddress) patch.address = request.customerAddress;

        if (Object.keys(patch).length) {
          transaction.update(customerRef, { ...patch, updatedAt: now });
        }
      }

      transaction.set(orderRef, {
        orderNumber,
        customerId: customerRef.id,
        customerName: String(request.customerName || ""),
        customerPhone: String(request.customerPhone || ""),
        customerEmail: String(request.customerEmail || ""),
        customerAddress: String(request.customerAddress || ""),
        deliveryArea: request.deliveryArea === "outside" ? "outside" : "inside",
        deliveryCharge,
        items: savedItems,
        itemCount: savedItems.reduce((sum, item) => sum + item.quantity, 0),
        subtotal,
        total,
        status: "Pending",
        notes: String(request.notes || ""),
        stockRestored: false,
        source: "smart_link",
        requestId,
        createdAt: now,
        updatedAt: now
      });

      savedItems.forEach((item, index) => {
        transaction.set(itemRefs[index], { ...item, createdAt: now });
      });

      for (const [productId, needed] of quantityByProduct.entries()) {
        const product = productSnaps.get(productId);
        transaction.update(product.ref, {
          stock: product.available - needed,
          updatedAt: now
        });
      }

      transaction.update(profileRef, {
        orderUsageMonth: monthKey,
        monthlyOrderCount: monthCount + 1,
        updatedAt: now
      });

      if (prefs.orderAlerts !== false) {
        transaction.set(
          doc(db, "users", currentUser.uid, "notifications", `new_order_${orderRef.id}`),
          {
            type: "new_order",
            title: "Order request approved",
            message: `Order ${orderNumber} from ${request.customerName || "Customer"} has been created.`,
            relatedId: orderRef.id,
            read: false,
            createdAt: now
          }
        );
      }

      if (prefs.lowStockAlerts !== false) {
        for (const [productId, needed] of quantityByProduct.entries()) {
          const product = productSnaps.get(productId);
          const newStock = product.available - needed;
          const threshold = Number(product.data.lowStockThreshold ?? 5);

          if (product.available > threshold && newStock <= threshold) {
            transaction.set(
              doc(db, "users", currentUser.uid, "notifications", `low_stock_${productId}`),
              {
                type: "low_stock",
                title: "Low stock alert",
                message: `${product.data.name || "A product"} has only ${newStock} item(s) left.`,
                relatedId: productId,
                read: false,
                createdAt: now
              }
            );
          }
        }
      }

      // Same transaction: the request can never be approved twice.
      transaction.delete(requestRef);
    });

    closeReview();

    // Double-check the customer document really exists before telling the seller.
    const customerSaved = customerResult
      ? (await getDoc(userDocument("customers", customerResult.id))).exists()
      : false;

    const customerMessage = !customerSaved
      ? "but the customer record could not be confirmed. Check the Customers page."
      : customerResult.created
        ? `and new customer "${customerResult.name}" was added.`
        : `and linked to existing customer "${customerResult.existingName}" (same ${customerResult.by}).`;

    showNotice(
      `Order ${createdOrderNumber} created ${customerMessage}`,
      customerSaved ? "success" : "error"
    );

    window.dispatchEvent(new CustomEvent("sellerspro:inventory-changed"));
    await loadSellerData();
    renderRequests();
    syncPublicStore(currentUser.uid, { products }).catch((error) =>
      console.warn("Public catalog sync failed:", error)
    );
  } catch (error) {
    console.error("Approving request failed:", error);
    showFeedback(error.message || "Could not approve the request.", {
      upgrade: Boolean(error.upgrade)
    });
  } finally {
    busy = false;
    button.disabled = false;
    $("rejectRequestBtn").disabled = false;
  }
}

$("approveRequestBtn").addEventListener("click", approveRequest);

/* ---------- init ---------- */

onAuthStateChanged(auth, async (user) => {
  if (!user) return;

  currentUser = user;

  try {
    await loadSellerData();
  } catch (error) {
    console.error("Loading seller data for requests failed:", error);
  }

  renderRequests();
  setTab(window.location.hash === "#requests" ? "requests" : "orders");
});

window.addEventListener("sellerspro:inventory-changed", async () => {
  if (!currentUser) return;
  try {
    await loadSellerData();
    renderRequests();
  } catch (error) {
    console.warn(error);
  }
});
