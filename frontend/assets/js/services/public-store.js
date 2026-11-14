/*
 * Smart Order Link: public catalog helper.
 *
 * Firestore layout (everything public lives OUTSIDE users/{uid}):
 *   publicStores/{sellerUid}                      -> safe public catalog (name, price, inStock only)
 *   publicStores/{sellerUid}/orderRequests/{id}   -> customer requests (customers can only CREATE)
 *
 * Private seller data (users/{uid}/products, customers, orders ...) is never exposed.
 * Cost price, exact stock, SKU, notes and customer lists are never copied here.
 */

import { db } from "../config/firebase.js";

import {
  doc,
  getDoc,
  getDocs,
  collection,
  setDoc,
  updateDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

export const MAX_PUBLIC_PRODUCTS = 300;

/** Public order link for a seller. Works from any page inside /pages/<folder>/ */
export function getSmartLink(uid) {
  const url = new URL("../order-form/order.html", window.location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("s", uid);
  return url.toString();
}

function buildCatalog(products) {
  return products
    .filter((product) => String(product.name || "").trim())
    .map((product) => ({
      id: String(product.id),
      name: String(product.name).trim().slice(0, 120),
      price: Math.max(0, Number(product.sellingPrice) || 0),
      inStock: (Number(product.stock) || 0) > 0,
      category: String(product.category || "").trim().slice(0, 60)
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, MAX_PUBLIC_PRODUCTS);
}

/**
 * Mirror the seller's sellable products into publicStores/{uid}.
 * Writes only when something changed (signature check), so it is cheap to call often.
 */
export async function syncPublicStore(uid, { products } = {}) {
  if (!uid) return null;

  const [profileSnap, storeSnap] = await Promise.all([
    getDoc(doc(db, "users", uid)),
    getDoc(doc(db, "publicStores", uid))
  ]);

  const profile = profileSnap.exists() ? profileSnap.data() : {};
  const businessName = String(
    profile.businessName || profile.name || "Online store"
  ).trim().slice(0, 120);

  let productList = products;

  if (!Array.isArray(productList)) {
    const snapshot = await getDocs(collection(db, "users", uid, "products"));
    productList = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
  }

  const catalog = buildCatalog(productList);
  const signature = JSON.stringify({ businessName, catalog });
  const existing = storeSnap.exists() ? storeSnap.data() : null;

  if (existing && existing.signature === signature) {
    return existing;
  }

  const data = {
    ownerId: uid,
    businessName,
    acceptingOrders: existing ? existing.acceptingOrders !== false : true,
    products: catalog,
    signature,
    updatedAt: serverTimestamp()
  };

  await setDoc(doc(db, "publicStores", uid), data);
  return data;
}

/** Turn the public order link on/off without deleting anything. */
export async function setAcceptingOrders(uid, accepting) {
  await updateDoc(doc(db, "publicStores", uid), {
    acceptingOrders: Boolean(accepting),
    updatedAt: serverTimestamp()
  });
}
