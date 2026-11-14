/*
 * Shared widget for every seller page:
 *  - live "Order requests" badge / counters
 *  - Smart order link: copy / open / share / accept-orders switch
 *
 * It owns the ONLY realtime listener on publicStores/{uid}/orderRequests and
 * re-broadcasts the data with a "sellerspro:requests" event for other modules.
 */

import { auth, db } from "../config/firebase.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";

import {
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  query
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

import {
  getSmartLink,
  setAcceptingOrders,
  syncPublicStore
} from "./public-store.js";

const LISTEN_LIMIT = 100;

let currentUid = null;
let stopRequests = null;
let toastTimer = null;

const all = (selector) => [...document.querySelectorAll(selector)];

function toast(message) {
  all("[data-smart-link-feedback]").forEach((element) => {
    element.textContent = message;
    element.hidden = !message;
  });

  clearTimeout(toastTimer);
  if (message) {
    toastTimer = setTimeout(() => toast(""), 3500);
  }
}

function renderCount(count, capped) {
  const label = capped ? `${count}+` : String(count);

  all("[data-requests-count]").forEach((element) => {
    element.textContent = label;
    element.hidden = count === 0 && element.hasAttribute("data-hide-zero");
    element.classList.toggle("has-requests", count > 0);
  });

  all("[data-requests-summary]").forEach((element) => {
    element.textContent = count === 0
      ? "No pending requests right now."
      : `${label} request${count === 1 ? "" : "s"} waiting for your review.`;
  });
}

function startListener(uid) {
  if (stopRequests) stopRequests();

  stopRequests = onSnapshot(
    query(collection(db, "publicStores", uid, "orderRequests"), limit(LISTEN_LIMIT)),
    (snapshot) => {
      const requests = snapshot.docs.map((item) => ({
        id: item.id,
        ...item.data()
      }));

      window.__sellersProRequests = requests;
      renderCount(requests.length, requests.length >= LISTEN_LIMIT);

      window.dispatchEvent(
        new CustomEvent("sellerspro:requests", { detail: { requests } })
      );
    },
    (error) => {
      console.warn("Order requests listener failed:", error);
      renderCount(0, false);
      window.dispatchEvent(
        new CustomEvent("sellerspro:requests-error", { detail: { error } })
      );
    }
  );
}

async function prepareSmartLink(uid) {
  const link = getSmartLink(uid);

  all("[data-smart-link-input]").forEach((input) => {
    input.value = link;
  });

  // Dashboard / orders page: make sure the public catalog exists and is fresh.
  if (!document.querySelector("[data-smart-link-panel]")) return;

  try {
    await syncPublicStore(uid);

    const store = await getDoc(doc(db, "publicStores", uid));
    const accepting = store.exists() ? store.data().acceptingOrders !== false : true;

    all("[data-accepting-toggle]").forEach((toggle) => {
      toggle.checked = accepting;
      toggle.disabled = false;
    });

    all("[data-accepting-label]").forEach((label) => {
      label.textContent = accepting ? "Accepting requests" : "Link paused";
    });
  } catch (error) {
    console.warn("Smart order link setup failed:", error);
    toast("Could not prepare your order link. Check your Firestore rules.");
  }
}

/* ---------- UI actions ---------- */

document.addEventListener("click", async (event) => {
  const copyButton = event.target.closest("[data-copy-smart-link]");
  const openButton = event.target.closest("[data-open-smart-link]");
  const shareButton = event.target.closest("[data-share-smart-link]");

  if (!copyButton && !openButton && !shareButton) return;
  if (!currentUid) return;

  const link = getSmartLink(currentUid);

  if (copyButton) {
    try {
      await navigator.clipboard.writeText(link);
      toast("Smart order link copied. Send it to your customer.");
    } catch {
      const input = document.querySelector("[data-smart-link-input]");
      if (input) {
        input.focus();
        input.select();
      }
      toast("Press Ctrl+C to copy the link.");
    }
  }

  if (openButton) {
    window.open(link, "_blank", "noopener");
  }

  if (shareButton) {
    if (navigator.share) {
      try {
        await navigator.share({
          title: "Place your order",
          text: "Fill this short form to place your order:",
          url: link
        });
      } catch {
        /* user closed the share sheet */
      }
    } else {
      try {
        await navigator.clipboard.writeText(link);
        toast("Sharing is not supported here, so the link was copied instead.");
      } catch {
        toast("Copy the link from the box above.");
      }
    }
  }
});

document.addEventListener("change", async (event) => {
  const toggle = event.target.closest("[data-accepting-toggle]");
  if (!toggle || !currentUid) return;

  const accepting = toggle.checked;
  toggle.disabled = true;

  try {
    await syncPublicStore(currentUid);
    await setAcceptingOrders(currentUid, accepting);

    all("[data-accepting-toggle]").forEach((item) => {
      item.checked = accepting;
    });
    all("[data-accepting-label]").forEach((label) => {
      label.textContent = accepting ? "Accepting requests" : "Link paused";
    });

    toast(accepting
      ? "Your order link is live again."
      : "Your order link is paused. Customers will see a closed message.");
  } catch (error) {
    console.error("Could not update link status:", error);
    toggle.checked = !accepting;
    toast("Could not update the link status. Please try again.");
  } finally {
    toggle.disabled = false;
  }
});

onAuthStateChanged(auth, (user) => {
  if (!user) {
    if (stopRequests) stopRequests();
    stopRequests = null;
    currentUid = null;
    return;
  }

  currentUid = user.uid;
  startListener(user.uid);
  prepareSmartLink(user.uid);
});
