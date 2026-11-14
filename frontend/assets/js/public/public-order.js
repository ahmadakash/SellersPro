/*
 * Public Smart Order Link form (no login).
 *
 * Reads : publicStores/{sellerUid}                     (safe catalog only)
 * Writes: publicStores/{sellerUid}/orderRequests/{id}  (create only, validated by rules)
 *
 * It never reads or writes users/{uid}/..., so customers can't reach any private data.
 */

import { db } from "../config/firebase.js";

import {
  addDoc,
  collection,
  doc,
  getDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

const $ = (id) => document.getElementById(id);

const MAX_ITEMS = 10;
const MAX_QTY = 20;
const COOLDOWN_MS = 30000;
const COOLDOWN_KEY = "sellerspro_last_request";

const params = new URLSearchParams(window.location.search);
const storeId = (params.get("s") || "").trim();

let store = null;
let sending = false;

const money = (value) =>
  new Intl.NumberFormat("en-BD", {
    style: "currency",
    currency: "BDT",
    maximumFractionDigits: 2
  }).format(Number(value) || 0);

function showState(icon, title, text) {
  $("stateIcon").className = `bi ${icon}`;
  $("stateTitle").textContent = title;
  $("stateText").textContent = text;
  $("stateCard").hidden = false;
  $("orderForm").hidden = true;
  $("successCard").hidden = true;
}

function showFeedback(message) {
  $("formFeedback").textContent = message;
  $("formFeedback").hidden = !message;
}

/* ---------- load store ---------- */

async function init() {
  if (!/^[A-Za-z0-9]{10,40}$/.test(storeId)) {
    $("storeName").textContent = "Order form";
    showState("bi-link-45deg", "Invalid link", "Please ask the seller to send you the order link again.");
    return;
  }

  try {
    const snapshot = await getDoc(doc(db, "publicStores", storeId));

    if (!snapshot.exists()) {
      $("storeName").textContent = "Order form";
      showState("bi-shop", "Store not found", "This order link is not active. Please contact the seller.");
      return;
    }

    store = snapshot.data();
    $("storeName").textContent = store.businessName || "Online store";
    document.title = `Order from ${store.businessName || "our store"}`;

    if (store.acceptingOrders === false) {
      showState("bi-pause-circle", "Orders are paused", "This store is not accepting new requests right now. Please try again later.");
      return;
    }

    const products = Array.isArray(store.products) ? store.products : [];

    if (!products.some((product) => product.inStock)) {
      showState("bi-box-seam", "Nothing available", "All products are out of stock at the moment. Please check back soon.");
      return;
    }

    $("stateCard").hidden = true;
    $("orderForm").hidden = false;
    resetItems();
  } catch (error) {
    console.error("Could not load store:", error);
    $("storeName").textContent = "Order form";
    showState("bi-wifi-off", "Could not load the store", "Check your internet connection and try again.");
  }
}

/* ---------- items ---------- */

function productOptions(select) {
  select.innerHTML = '<option value="">Select a product</option>';

  store.products.forEach((product) => {
    const option = document.createElement("option");
    option.value = product.id;
    option.disabled = !product.inStock;
    option.textContent = `${product.name} — ${money(product.price)}${product.inStock ? "" : " (out of stock)"}`;
    select.appendChild(option);
  });
}

function addItemRow() {
  const container = $("itemsContainer");

  if (container.children.length >= MAX_ITEMS) {
    showFeedback(`You can add up to ${MAX_ITEMS} products per request.`);
    return;
  }

  const row = document.createElement("div");
  row.className = "po-item";

  const productField = document.createElement("div");
  productField.className = "po-field";
  const productLabel = document.createElement("label");
  productLabel.textContent = "Product";
  const select = document.createElement("select");
  select.className = "po-product";
  productOptions(select);
  productField.append(productLabel, select);

  const qtyField = document.createElement("div");
  qtyField.className = "po-field po-qty";
  const qtyLabel = document.createElement("label");
  qtyLabel.textContent = "Qty";
  const qty = document.createElement("input");
  qty.type = "number";
  qty.className = "po-quantity";
  qty.min = "1";
  qty.max = String(MAX_QTY);
  qty.step = "1";
  qty.value = "1";
  qtyField.append(qtyLabel, qty);

  const line = document.createElement("div");
  line.className = "po-line";
  line.textContent = money(0);

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "po-remove";
  remove.setAttribute("aria-label", "Remove product");
  remove.innerHTML = '<i class="bi bi-trash"></i>';

  remove.addEventListener("click", () => {
    row.remove();
    if (!container.children.length) addItemRow();
    updateTotals();
  });

  select.addEventListener("change", updateTotals);
  qty.addEventListener("input", updateTotals);

  row.append(productField, qtyField, line, remove);
  container.appendChild(row);
  updateTotals();
}

function resetItems() {
  $("itemsContainer").innerHTML = "";
  addItemRow();
}

function readItems() {
  return [...$("itemsContainer").querySelectorAll(".po-item")].map((row) => ({
    productId: row.querySelector(".po-product").value,
    quantity: Number(row.querySelector(".po-quantity").value)
  }));
}

function updateTotals() {
  let subtotal = 0;

  $("itemsContainer").querySelectorAll(".po-item").forEach((row) => {
    const product = store.products.find((item) => item.id === row.querySelector(".po-product").value);
    const quantity = Number(row.querySelector(".po-quantity").value) || 0;
    const line = product ? product.price * quantity : 0;

    subtotal += line;
    row.querySelector(".po-line").textContent = money(line);
  });

  $("subtotalText").textContent = money(subtotal);
}

$("addItemBtn").addEventListener("click", () => {
  showFeedback("");
  addItemRow();
});

/* ---------- submit ---------- */

$("orderForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (sending || !store) return;

  showFeedback("");

  // Bots fill hidden fields. Pretend success, send nothing.
  if ($("website").value.trim()) {
    showSuccess(Math.random().toString(36).slice(2, 10).toUpperCase());
    return;
  }

  let lastSent = 0;
  try { lastSent = Number(localStorage.getItem(COOLDOWN_KEY)) || 0; } catch { /* storage blocked */ }
  if (Date.now() - lastSent < COOLDOWN_MS) {
    showFeedback("Please wait a few seconds before sending another request.");
    return;
  }

  const customerName = $("customerName").value.trim();
  const customerPhone = $("customerPhone").value.trim();
  const customerEmail = $("customerEmail").value.trim();
  const customerAddress = $("customerAddress").value.trim();
  const deliveryArea = $("deliveryArea").value === "outside" ? "outside" : "inside";
  const notes = $("orderNotes").value.trim();

  if (customerName.length < 2) return showFeedback("Please enter your full name.");

  if (!/^[0-9+() -]{6,20}$/.test(customerPhone)) {
    return showFeedback("Please enter a valid phone number.");
  }

  if (customerEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(customerEmail)) {
    return showFeedback("Please enter a valid email or leave it empty.");
  }

  if (customerAddress.length < 5) return showFeedback("Please enter your delivery address.");

  // Merge duplicate product lines and validate against the public catalog.
  const merged = new Map();

  for (const item of readItems()) {
    const product = store.products.find((entry) => entry.id === item.productId);

    if (!product) return showFeedback("Please select a product for every line.");
    if (!product.inStock) return showFeedback(`"${product.name}" is out of stock.`);

    if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > MAX_QTY) {
      return showFeedback(`Quantity must be between 1 and ${MAX_QTY}.`);
    }

    merged.set(product.id, {
      productId: product.id,
      productName: product.name.slice(0, 120),
      quantity: Math.min(MAX_QTY, (merged.get(product.id)?.quantity || 0) + item.quantity)
    });
  }

  const items = [...merged.values()];
  if (!items.length) return showFeedback("Please add at least one product.");

  sending = true;
  const button = $("submitBtn");
  button.disabled = true;
  button.innerHTML = '<i class="bi bi-hourglass-split"></i> Sending...';

  try {
    const reference = await addDoc(
      collection(db, "publicStores", storeId, "orderRequests"),
      {
        customerName,
        customerPhone,
        customerEmail,
        customerAddress,
        deliveryArea,
        notes,
        items,
        status: "new",
        createdAt: serverTimestamp()
      }
    );

    try { localStorage.setItem(COOLDOWN_KEY, String(Date.now())); } catch { /* storage blocked */ }
    showSuccess(reference.id.slice(0, 8).toUpperCase());
  } catch (error) {
    console.error("Sending request failed:", error);

    showFeedback(
      error?.code === "permission-denied"
        ? "This store is not accepting requests right now. Please try again later."
        : "Could not send your request. Check your connection and try again."
    );
  } finally {
    sending = false;
    button.disabled = false;
    button.innerHTML = '<i class="bi bi-send"></i> Send order request';
  }
});

function showSuccess(reference) {
  $("successStore").textContent = store?.businessName || "The seller";
  $("successRef").textContent = reference;
  $("orderForm").hidden = true;
  $("stateCard").hidden = true;
  $("successCard").hidden = false;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

$("anotherBtn").addEventListener("click", () => {
  $("orderForm").reset();
  resetItems();
  showFeedback("");
  $("successCard").hidden = true;
  $("orderForm").hidden = false;
});

init();
