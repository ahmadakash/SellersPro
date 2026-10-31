import { onAuthStateChanged } from
  "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  orderBy,
  limit,
  serverTimestamp,
  updateDoc
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

import { auth, db } from "../config/firebase.js";
import { logoutUser } from "../services/auth-service.js";

const $ = (id) => document.getElementById(id);

const userName = $("userName");
const userBusiness = $("userBusiness");
const userAvatar = $("userAvatar");
const welcomeName = $("welcomeName");
const logoutBtn = $("logoutBtn");
const dashboardNotice = $("dashboardNotice");
const recentOrdersList = $("recentOrdersList");

const profileTrigger = $("profileTrigger");
const profileModal = $("profileModal");
const profileForm = $("profileForm");
const profileName = $("profileName");
const profileBusinessName = $("profileBusinessName");
const profileEmail = $("profileEmail");
const profilePhone = $("profilePhone");
const profileFeedback = $("profileFeedback");
const saveProfileBtn = $("saveProfileBtn");

let currentUser = null;
let currentProfile = {};

/* ---------------- Notifications ---------------- */

const notificationBtn = $("notificationBtn");
const notificationDropdown = $("notificationDropdown");
const notificationCount = $("notificationCount");
const notificationList = $("notificationList");
const notificationSummary = $("notificationSummary");
const markAllReadBtn = $("markAllReadBtn");

let stopNotificationsListener = null;
let currentNotifications = [];

function formatNotificationDate(timestamp) {
  if (!timestamp) return "Just now";

  const date = typeof timestamp.toDate === "function"
    ? timestamp.toDate()
    : new Date(timestamp);

  if (Number.isNaN(date.getTime())) return "Just now";

  return date.toLocaleString("en-BD", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit"
  });
}

function notificationIcon(type) {
  if (type === "new_order") return "bi-bag-check";
  if (type === "order_status") return "bi-arrow-repeat";
  if (type === "low_stock") return "bi-exclamation-triangle";

  return "bi-bell";
}

function renderNotifications(notifications) {
  currentNotifications = notifications;

  const unreadCount = notifications.filter(
    (item) => item.read !== true
  ).length;

  notificationCount.textContent =
    unreadCount > 99 ? "99+" : String(unreadCount);

  notificationCount.hidden = unreadCount === 0;

  notificationSummary.textContent = unreadCount
    ? `${unreadCount} unread notification${unreadCount === 1 ? "" : "s"}`
    : "You're all caught up";

  markAllReadBtn.disabled = unreadCount === 0;

  if (!notifications.length) {
    notificationList.innerHTML = `
      <div class="notification-empty">
        <i class="bi bi-bell-slash"></i>
        <p>No notifications yet</p>
      </div>
    `;
    return;
  }

  notificationList.innerHTML = notifications.map((item) => `
    <button
      type="button"
      class="notification-item ${item.read === true ? "" : "unread"}"
      data-notification-id="${escapeHtml(item.id)}"
    >
      <i class="bi ${notificationIcon(item.type)}"></i>

      <span class="notification-item-content">
        <strong>${escapeHtml(item.title || "Notification")}</strong>
        <span>${escapeHtml(item.message || "")}</span>
        <small>${escapeHtml(formatNotificationDate(item.createdAt))}</small>
      </span>
    </button>
  `).join("");
}

function startNotificationsListener(uid) {
  if (stopNotificationsListener) {
    stopNotificationsListener();
    stopNotificationsListener = null;
  }

  const notificationsRef = collection(
    db,
    "users",
    uid,
    "notifications"
  );

  const notificationsQuery = query(
    notificationsRef,
    orderBy("createdAt", "desc"),
    limit(30)
  );

  stopNotificationsListener = onSnapshot(
    notificationsQuery,
    (snapshot) => {
      const notifications = snapshot.docs.map((item) => ({
        id: item.id,
        ...item.data()
      }));

      renderNotifications(notifications);
    },
    (error) => {
      console.error("Notification listener failed:", error);

      notificationList.innerHTML = `
        <div class="notification-empty">
          <i class="bi bi-exclamation-circle"></i>
          <p>Could not load notifications. Check Firestore rules.</p>
        </div>
      `;
    }
  );
}

notificationBtn.addEventListener("click", () => {
  const willOpen = notificationDropdown.hidden === true;

  notificationDropdown.hidden = !willOpen;
  notificationBtn.setAttribute("aria-expanded", String(willOpen));
});

document.addEventListener("click", (event) => {
  if (
    !notificationDropdown.contains(event.target) &&
    !notificationBtn.contains(event.target)
  ) {
    notificationDropdown.hidden = true;
    notificationBtn.setAttribute("aria-expanded", "false");
  }
});

notificationList.addEventListener("click", async (event) => {
  const item = event.target.closest("[data-notification-id]");
  if (!item || !currentUser) return;

  const notificationId = item.dataset.notificationId;

  const notification = currentNotifications.find(
    (entry) => entry.id === notificationId
  );

  if (!notification || notification.read === true) return;

  try {
    await updateDoc(
      doc(
        db,
        "users",
        currentUser.uid,
        "notifications",
        notificationId
      ),
      {
        read: true,
        readAt: serverTimestamp()
      }
    );
  } catch (error) {
    console.error("Mark notification as read failed:", error);
    showNotice("Could not mark notification as read.");
  }
});

markAllReadBtn.addEventListener("click", async () => {
  if (!currentUser) return;

  const unreadNotifications = currentNotifications.filter(
    (item) => item.read !== true
  );

  if (!unreadNotifications.length) return;

  markAllReadBtn.disabled = true;

  try {
    await Promise.all(
      unreadNotifications.map((item) =>
        updateDoc(
          doc(
            db,
            "users",
            currentUser.uid,
            "notifications",
            item.id
          ),
          {
            read: true,
            readAt: serverTimestamp()
          }
        )
      )
    );
  } catch (error) {
    console.error("Mark all notifications read failed:", error);
    showNotice("Could not update all notifications.");
    markAllReadBtn.disabled = false;
  }
});

function showNotice(message, type = "error") {
  dashboardNotice.textContent = message;
  dashboardNotice.hidden = false;
  dashboardNotice.classList.toggle("error", type === "error");
}

function clearNotice() {
  dashboardNotice.hidden = true;
  dashboardNotice.textContent = "";
}

function showUserProfile(user, profile = {}) {
  const fullName =
    profile.name || user.displayName || user.email || "Seller";

  const businessName = profile.businessName || "My business";

  userName.textContent = fullName;
  userBusiness.textContent = businessName;
  welcomeName.textContent = fullName.trim().split(/\s+/)[0] || "Seller";
  userAvatar.textContent = fullName.trim().charAt(0).toUpperCase() || "S";
}

function showProfileFeedback(message, type = "error") {
  profileFeedback.textContent = message;
  profileFeedback.className = `profile-feedback ${type}`;
  profileFeedback.hidden = false;
}

function clearProfileFeedback() {
  profileFeedback.hidden = true;
  profileFeedback.textContent = "";
  profileFeedback.className = "profile-feedback";
}

/* ---------------- Recent orders ---------------- */

const EMPTY_ORDERS_HTML = `
  <div class="empty-state">
    <div class="empty-icon"><i class="bi bi-receipt-cutoff"></i></div>
    <strong>No orders yet</strong>
    <p>Your orders will appear here after you add them.</p>
  </div>
`;

const ERROR_ORDERS_HTML = `
  <div class="empty-state">
    <div class="empty-icon"><i class="bi bi-exclamation-circle"></i></div>
    <strong>Could not load orders</strong>
    <p>Check your connection and Firestore rules, then refresh.</p>
  </div>
`;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function getOrderDate(order) {
  const value = order.createdAt || order.orderDate || order.date;
  if (!value) return null;

  const date =
    typeof value.toDate === "function" ? value.toDate() : new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

function getOrderStatus(status) {
  const value = String(status || "Pending").trim().toLowerCase();

  if (value === "delivered") return "Delivered";
  if (value === "cancelled" || value === "canceled") return "Cancelled";
  if (value === "processing" || value === "accepted") return "Processing";
  return "Pending";
}

function formatMoney(value) {
  return "৳" + toNumber(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function renderRecentOrders(orders) {
  if (!recentOrdersList) return;

  if (!orders.length) {
    recentOrdersList.innerHTML = EMPTY_ORDERS_HTML;
    return;
  }

  // Newest first, show latest 5
  const recent = [...orders]
    .sort((a, b) => {
      const timeA = getOrderDate(a)?.getTime() || 0;
      const timeB = getOrderDate(b)?.getTime() || 0;
      return timeB - timeA;
    })
    .slice(0, 5);

  recentOrdersList.innerHTML = recent
    .map((order) => {
      const customer = order.customerName || "Customer";
      const orderNumber = order.orderNumber || order.id || "N/A";
      const status = getOrderStatus(order.status);
      const total = order.total ?? order.grandTotal ?? order.amount;

      const items = Array.isArray(order.items) ? order.items : [];
      const itemCount = items.reduce(
        (sum, item) => sum + (toNumber(item.quantity) || 1),
        0
      );

      const date = getOrderDate(order);
      const dateText = date
        ? date.toLocaleDateString("en-GB", {
            day: "numeric",
            month: "short",
            year: "numeric"
          })
        : "No date";

      return `
        <a class="recent-order" href="../orders/orders.html">
          <span class="recent-order-avatar">
            ${escapeHtml(customer.trim().charAt(0).toUpperCase() || "C")}
          </span>

          <span class="recent-order-info">
            <strong>${escapeHtml(customer)}</strong>
            <small>
              #${escapeHtml(orderNumber)} · ${escapeHtml(dateText)}
              · ${itemCount} item${itemCount === 1 ? "" : "s"}
            </small>
          </span>

          <span class="recent-order-side">
            <strong>${formatMoney(total)}</strong>
            <span class="order-status status-${status.toLowerCase()}">
              ${status}
            </span>
          </span>
        </a>
      `;
    })
    .join("");
}

/* ---------------- Dashboard numbers ---------------- */

async function safeGetDocs(ref, label) {
  try {
    return await getDocs(ref);
  } catch (error) {
    console.error(`Failed to load ${label}:`, error);
    return null;
  }
}

/* Load dashboard numbers from the signed-in seller's own collections. */
async function loadDashboardStats(uid) {
  const requiredIds = [
    "totalProducts",
    "totalCustomers",
    "totalOrders",
    "lowStockItems"
  ];

  const missingIds = requiredIds.filter((id) => !$(id));

  if (missingIds.length > 0) {
    throw new Error(
      `Dashboard HTML is missing these elements: ${missingIds.join(", ")}`
    );
  }

  // Each collection loads on its own, so one failure doesn't block the rest
  const [productsSnapshot, customersSnapshot, ordersSnapshot] =
    await Promise.all([
      safeGetDocs(collection(db, "users", uid, "products"), "products"),
      safeGetDocs(collection(db, "users", uid, "customers"), "customers"),
      safeGetDocs(collection(db, "users", uid, "orders"), "orders")
    ]);

  if (productsSnapshot) {
    const products = productsSnapshot.docs.map((item) => item.data());

    const lowStockCount = products.filter((product) => {
      const stock = Number(product.stock ?? 0);
      const threshold = Number(product.lowStockThreshold ?? 5);
      return Number.isFinite(stock) &&
        Number.isFinite(threshold) &&
        stock <= threshold;
    }).length;

    $("totalProducts").textContent = productsSnapshot.size;
    $("lowStockItems").textContent = lowStockCount;
  }

  if (customersSnapshot) {
    $("totalCustomers").textContent = customersSnapshot.size;
  }

  if (ordersSnapshot) {
    $("totalOrders").textContent = ordersSnapshot.size;

    renderRecentOrders(
      ordersSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
    );
  } else if (recentOrdersList) {
    recentOrdersList.innerHTML = ERROR_ORDERS_HTML;
  }

  if (!productsSnapshot || !customersSnapshot || !ordersSnapshot) {
    showNotice(
      "Some dashboard data could not be loaded. Check Firestore rules."
    );
  }
}

/* Profile interface */
function openProfile() {
  if (!currentUser) return;

  clearProfileFeedback();

  profileName.value =
    currentProfile.name || currentUser.displayName || "";

  profileBusinessName.value =
    currentProfile.businessName || "";

  profileEmail.value =
    currentUser.email || currentProfile.email || "";

  profilePhone.value =
    currentProfile.phone || currentUser.phoneNumber || "";

  profileModal.hidden = false;
  document.body.style.overflow = "hidden";
  profileName.focus();
}

function closeProfile() {
  profileModal.hidden = true;
  document.body.style.overflow = "";
  profileTrigger.focus();
}

profileTrigger.addEventListener("click", openProfile);

$("closeProfileBtn").addEventListener("click", closeProfile);
$("cancelProfileBtn").addEventListener("click", closeProfile);

profileModal.querySelector("[data-close-profile]")
  .addEventListener("click", closeProfile);

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !profileModal.hidden) {
    closeProfile();
  }
});

/* Save editable profile fields to users/{uid}. */
profileForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!currentUser) return;

  const name = profileName.value.trim();
  const businessName = profileBusinessName.value.trim();
  const phone = profilePhone.value.trim();

  if (!name || !businessName) {
    showProfileFeedback(
      "Full name and business name are required."
    );
    return;
  }

  saveProfileBtn.disabled = true;
  saveProfileBtn.textContent = "Saving...";
  clearProfileFeedback();

  try {
    const profileRef = doc(db, "users", currentUser.uid);

    await updateDoc(profileRef, {
      name,
      businessName,
      phone,
      updatedAt: serverTimestamp()
    });

    currentProfile = {
      ...currentProfile,
      name,
      businessName,
      phone
    };

    showUserProfile(currentUser, currentProfile);
    showProfileFeedback("Profile updated successfully.", "success");

    // Close after a short moment so the success message can be seen.
    window.setTimeout(() => {
      if (!profileModal.hidden) closeProfile();
    }, 800);
  } catch (error) {
    console.error("Saving profile failed:", error);

    showProfileFeedback(
      "Could not save your profile. Check your connection and Firestore rules."
    );
  } finally {
    saveProfileBtn.disabled = false;
    saveProfileBtn.textContent = "Save changes";
  }
});

/* Authentication and page initialization */
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.replace("../auth/login.html");
    return;
  }

  currentUser = user;
  startNotificationsListener(user.uid);
  clearNotice();

  // Show basic Auth details while Firestore is loading.
  showUserProfile(user);

  try {
    const profileRef = doc(db, "users", user.uid);
    const profileSnapshot = await getDoc(profileRef);

    if (profileSnapshot.exists()) {
      currentProfile = profileSnapshot.data();
      showUserProfile(user, currentProfile);
    } else {
      currentProfile = {};
      showNotice(
        "Your seller profile record was not found. Please check registration."
      );
    }

    await loadDashboardStats(user.uid);
  } catch (error) {
    console.error("Dashboard initialization failed:", error);

    showNotice(
      "Dashboard data could not be loaded. Check your connection and Firestore rules."
    );
  }
});

/* Logout */
logoutBtn.addEventListener("click", async () => {
  logoutBtn.disabled = true;

  try {
    await logoutUser();
    window.location.replace("../auth/login.html");
  } catch (error) {
    console.error("Logout failed:", error);
    showNotice("Logout failed. Please try again.");
    logoutBtn.disabled = false;
  }
});

/* Mobile sidebar */
const sidebar = $("sidebar");
const sidebarOverlay = $("sidebarOverlay");
const menuToggle = $("menuToggle");

function closeSidebar() {
  sidebar.classList.remove("open");
  sidebarOverlay.classList.remove("show");
}

menuToggle.addEventListener("click", () => {
  sidebar.classList.toggle("open");
  sidebarOverlay.classList.toggle("show");
});

sidebarOverlay.addEventListener("click", closeSidebar);

/* Existing not-yet-built navigation */
document.querySelectorAll("[data-coming-soon]").forEach((element) => {
  element.addEventListener("click", (event) => {
    event.preventDefault();

    showNotice(
      `${element.dataset.comingSoon} page is not connected yet.`,
      "info"
    );

    closeSidebar();
  });
});