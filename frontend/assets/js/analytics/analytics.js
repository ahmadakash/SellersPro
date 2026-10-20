
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
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

/* =========================================================
   sellersPro Analytics
   File: frontend/assets/js/analytics/analytics.js
========================================================= */

const $ = (id) => document.getElementById(id);

let currentUser = null;
let allOrders = [];
let allProducts = [];
let salesChart = null;
let statusChart = null;
let profileData = {};

/* ---------------- Common helpers ---------------- */

function money(value) {
  return new Intl.NumberFormat("en-BD", {
    style: "currency",
    currency: "BDT",
    maximumFractionDigits: 2
  }).format(Number(value) || 0);
}

function num(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
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

function orderDate(order) {
  const value = order.createdAt || order.orderDate || order.date;

  if (!value) return null;

  let date;

  if (typeof value.toDate === "function") {
    date = value.toDate();
  } else if (typeof value === "number") {
    date = new Date(value);
  } else {
    date = new Date(value);
  }

  return Number.isNaN(date.getTime()) ? null : date;
}

function dateLabel(date) {
  if (!date) return "N/A";

  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}

function getOrderTotal(order) {
  return num(order.total ?? order.grandTotal ?? order.amount);
}

function getItems(order) {
  return Array.isArray(order.items) ? order.items : [];
}

function getOrderNumber(order) {
  return order.orderNumber || order.id || "N/A";
}

function normalizeStatus(status) {
  const value = String(status || "Pending").trim().toLowerCase();

  if (value === "delivered") return "Delivered";
  if (value === "cancelled" || value === "canceled") return "Cancelled";
  if (value === "processing" || value === "accepted") return "Processing";
  if (value === "pending") return "Pending";

  return "Pending";
}

function showNotice(message, type = "error") {
  const notice = $("analyticsNotice");
  if (!notice) {
    console[type === "error" ? "error" : "log"](message);
    return;
  }

  notice.textContent = message;
  notice.hidden = false;
  notice.classList.toggle("notice-error", type === "error");
  notice.classList.toggle("notice-success", type === "success");
}

function hideNotice() {
  const notice = $("analyticsNotice");
  if (notice) notice.hidden = true;
}

/* ---------------- Authentication ---------------- */

let uiBound = false;

function bindUI() {
  if (uiBound) return;
  uiBound = true;

  setupNavigation();
  setupProfileModal();
  setupDateFilters();
  setupReportDownloads();
  setupChartTooltipDismiss();
}

// Bind buttons first, so they work even if data loading fails.
bindUI();

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.replace("../auth/login.html");
    return;
  }

  currentUser = user;

  try {
    await loadProfile();
    await loadBusinessData();
    renderAnalytics();

    console.info("Analytics loaded:", {
      orders: allOrders.length,
      products: allProducts.length
    });
  } catch (error) {
    console.error("Analytics initialization error:", error);

    showNotice(
      "Analytics load hoyni. Browser Console ar Firebase Firestore rules check koro."
    );
  }
});

/* ---------------- Seller profile ---------------- */

async function loadProfile() {
  const profileRef = doc(db, "users", currentUser.uid);
  const snapshot = await getDoc(profileRef);

  profileData = snapshot.exists() ? snapshot.data() : {};

  const name =
    profileData.name ||
    profileData.fullName ||
    currentUser.displayName ||
    "Seller";

  const businessName =
    profileData.businessName ||
    profileData.business ||
    "Your business";

  const email = currentUser.email || profileData.email || "";
  const phone = profileData.phone || "";

  if ($("userName")) $("userName").textContent = name;
  if ($("userBusiness")) $("userBusiness").textContent = businessName;
  if ($("userAvatar")) {
    $("userAvatar").textContent =
      name.trim().charAt(0).toUpperCase() || "S";
  }

    // Fill profile modal if these IDs exist in analytics.html.
    fillProfileForm();
}

function fillProfileForm() {
  const name =
    profileData.name ||
    profileData.fullName ||
    currentUser?.displayName ||
    "";

  if ($("profileName")) $("profileName").value = name;
  if ($("profileBusiness")) {
    $("profileBusiness").value =
      profileData.businessName || profileData.business || "";
  }
  if ($("profileEmail")) {
    $("profileEmail").value = currentUser?.email || profileData.email || "";
  }
  if ($("profilePhone")) $("profilePhone").value = profileData.phone || "";
}


/* ---------------- Firestore collections ---------------- */

async function loadBusinessData() {
  const userId = currentUser.uid;

  const ordersRef = collection(db, "users", userId, "orders");
  const productsRef = collection(db, "users", userId, "products");

  const [ordersSnapshot, productsSnapshot] = await Promise.all([
    getDocs(ordersRef),
    getDocs(productsRef)
  ]);

  allOrders = ordersSnapshot.docs.map((snapshot) => ({
    id: snapshot.id,
    ...snapshot.data()
  }));

  allProducts = productsSnapshot.docs.map((snapshot) => ({
    id: snapshot.id,
    ...snapshot.data()
  }));
}

/* ---------------- Date filters ---------------- */

function setupDateFilters() {
  const selector = $("dateRange");

  if (!selector || selector.dataset.analyticsBound === "true") return;

  selector.dataset.analyticsBound = "true";

  const toggleCustomFields = () => {
    const custom = selector.value === "custom";
    const wrapper = $("customDateFields");
    if (wrapper) wrapper.hidden = !custom;
  };

  selector.addEventListener("change", () => {
    toggleCustomFields();
    hideNotice();

    if (selector.value !== "custom") renderAnalytics();
  });

  $("applyDateRange")?.addEventListener("click", () => {
    const start = $("startDate")?.value;
    const end = $("endDate")?.value;

    if (!start || !end) {
      showNotice("Start date ar end date duto-i select koro.");
      return;
    }

    if (start > end) {
      showNotice("Start date, end date er por hote parbe na.");
      return;
    }

    hideNotice();
    renderAnalytics();
  });

  toggleCustomFields();
}

function getDateRange() {
  const now = new Date();
  const selected = $("dateRange")?.value || "month";

  const startOfDay = (date) =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate());

  let start;
  let end = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    23, 59, 59, 999
  );

  switch (selected) {
    case "today":
      start = startOfDay(now);
      break;

    case "7days":
      start = startOfDay(now);
      start.setDate(start.getDate() - 6);
      break;

    case "month":
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      break;

    case "lastMonth":
      start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      end = new Date(
        now.getFullYear(), now.getMonth(), 0,
        23, 59, 59, 999
      );
      break;

    case "all":
      start = new Date(2000, 0, 1);
      break;

    case "custom": {
      const startValue = $("startDate")?.value;
      const endValue = $("endDate")?.value;

      if (!startValue || !endValue || startValue > endValue) {
        return null;
      }

      start = new Date(`${startValue}T00:00:00`);
      end = new Date(`${endValue}T23:59:59.999`);
      break;
    }

    default:
      start = new Date(now.getFullYear(), now.getMonth(), 1);
  }

  return { start, end };
}

function getFilteredOrders() {
  const range = getDateRange();
  if (!range) return [];

  return allOrders.filter((order) => {
    const date = orderDate(order);
    return date && date >= range.start && date <= range.end;
  });
}

/* ---------------- Calculations ---------------- */

function calculateAnalytics(orders) {
  const normalizedOrders = orders.map((order) => ({
    ...order,
    analyticsStatus: normalizeStatus(order.status)
  }));

  const delivered = normalizedOrders.filter(
    (order) => order.analyticsStatus === "Delivered"
  );

  const cancelled = normalizedOrders.filter(
    (order) => order.analyticsStatus === "Cancelled"
  );

  const counts = {
    Pending: normalizedOrders.filter(
      (order) => order.analyticsStatus === "Pending"
    ).length,
    Processing: normalizedOrders.filter(
      (order) => order.analyticsStatus === "Processing"
    ).length,
    Delivered: delivered.length,
    Cancelled: cancelled.length
  };

  // Revenue is based on completed/delivered orders only.
  const revenue = delivered.reduce(
    (sum, order) => sum + getOrderTotal(order),
    0
  );

  const productMap = new Map();

  delivered.forEach((order) => {
    getItems(order).forEach((item) => {
      const name = item.productName || item.name || "Product";
      const key = item.productId || item.id || name;
      const quantity = num(item.quantity);

      const unitPrice = num(
        item.unitPrice ?? item.price ?? item.sellingPrice
      );

      const lineTotal = num(
        item.lineTotal ?? item.total ?? quantity * unitPrice
      );

      const existing = productMap.get(key) || {
        name,
        unitsSold: 0,
        salesValue: 0
      };

      existing.unitsSold += quantity;
      existing.salesValue += lineTotal;

      productMap.set(key, existing);
    });
  });

  const topProducts = [...productMap.values()]
    .sort((a, b) => b.unitsSold - a.unitsSold)
    .slice(0, 10);

  return {
    orders: normalizedOrders,
    revenue,
    totalOrders: normalizedOrders.length,
    deliveredOrders: delivered.length,
    cancelledOrders: cancelled.length,
    statusCounts: counts,
    topProducts
  };
}

/* ---------------- Main rendering ---------------- */

function renderAnalytics() {
  const filteredOrders = getFilteredOrders();
  const data = calculateAnalytics(filteredOrders);

  if ($("totalRevenue")) $("totalRevenue").textContent = money(data.revenue);
  if ($("totalOrders")) $("totalOrders").textContent = data.totalOrders;
  if ($("deliveredOrders")) {
    $("deliveredOrders").textContent = data.deliveredOrders;
  }
  if ($("cancelledOrders")) {
    $("cancelledOrders").textContent = data.cancelledOrders;
  }

  renderSalesChart(filteredOrders);
  renderStatusChart(data.statusCounts);
  renderTopProducts(data.topProducts);
}

/* ---------------- Sales trend chart ---------------- */

function renderSalesChart(orders) {
  const canvas = $("salesChart");
  if (!canvas) return;

  if (typeof Chart === "undefined") {
    console.error("Chart.js is not loaded.");
    return;
  }

  const totalsByDate = new Map();

  orders.forEach((order) => {
    if (normalizeStatus(order.status) !== "Delivered") return;

    const date = orderDate(order);
    if (!date) return;

    const key = [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0")
    ].join("-");

    totalsByDate.set(
      key,
      (totalsByDate.get(key) || 0) + getOrderTotal(order)
    );
  });

  const labels = [...totalsByDate.keys()].sort();
  const values = labels.map((label) => totalsByDate.get(label));
  const hasData = labels.length > 0;

  if (salesChart) {
    salesChart.destroy();
    salesChart = null;
  }

  const emptyState = $("salesChartEmpty");
  if (emptyState) emptyState.hidden = hasData;
  canvas.hidden = !hasData;

  // No data: do not draw a fake point
  if (!hasData) return;

  salesChart = new Chart(canvas, {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: "Delivered sales (BDT)",
        data: values,
        borderColor: "#356df3",
        backgroundColor: "rgba(53,109,243,0.12)",
        fill: true,
        tension: 0.3,
        pointRadius: 3
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { intersect: false, mode: "index" },
      plugins: { legend: { display: true } },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { callback: (value) => "৳" + value }
        }
      }
    }
  });
}

/* ---------------- Order status chart ---------------- */

function renderStatusChart(counts) {
  const canvas = $("statusChart");
  if (!canvas) return;

  if (typeof Chart === "undefined") {
    console.error("Chart.js is not loaded.");
    return;
  }

  const total = Object.values(counts).reduce(
    (sum, value) => sum + num(value),
    0
  );

  const emptyState = $("statusChartEmpty");

  if (emptyState) emptyState.hidden = total > 0;
  canvas.hidden = total === 0;

  if (statusChart) {
    statusChart.destroy();
    statusChart = null;
  }

  if (total === 0) return;

  statusChart = new Chart(canvas, {
    type: "doughnut",
    data: {
      labels: ["Pending", "Processing", "Delivered", "Cancelled"],
      datasets: [{
        data: [
          counts.Pending,
          counts.Processing,
          counts.Delivered,
          counts.Cancelled
        ],
        backgroundColor: [
          "#f6c453",
          "#5994f6",
          "#32b47a",
          "#ef6464"
        ],
        borderColor: "#ffffff",
        borderWidth: 3,
        hoverOffset: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "65%",
      plugins: {
        // Keep the custom HTML legend only.
        legend: { display: false },
        tooltip: {
          callbacks: {
            label(context) {
              return `${context.label}: ${context.raw} orders`;
            }
          }
        }
      }
    }
  });
}

/* ---------------- Best-selling products table ---------------- */

function renderTopProducts(products) {
  const tbody = $("topProductsBody");
  if (!tbody) return;

  if (!products.length) {
    tbody.innerHTML =
      '<tr><td colspan="3" class="empty-table">No delivered product sales in this period.</td></tr>';
    return;
  }

  tbody.innerHTML = products.map((product) => `
    <tr>
      <td>${escapeHTML(product.name)}</td>
      <td>${product.unitsSold}</td>
      <td>${escapeHTML(money(product.salesValue))}</td>
    </tr>
  `).join("");
}

/* ---------------- Report download menu ---------------- */

function setupReportDownloads() {
  const button = $("downloadReportBtn");
  const menu = $("reportFormatMenu");

  button?.addEventListener("click", (event) => {
    event.stopPropagation();
    if (menu) menu.hidden = !menu.hidden;
  });

  $("downloadCsvBtn")?.addEventListener("click", () => {
    try {
      downloadCSV();
      if (menu) menu.hidden = true;
      showNotice("CSV report downloaded successfully.", "success");
    } catch (error) {
      console.error("CSV export error:", error);
      showNotice("CSV report download failed.");
    }
  });

  $("downloadPdfBtn")?.addEventListener("click", () => {
    try {
      downloadPDF();
      if (menu) menu.hidden = true;
      showNotice("PDF report generated.", "success");
    } catch (error) {
      console.error("PDF export error:", error);
      showNotice(
        "PDF তৈরি হয়নি। PDF library URLs ও browser Console পরীক্ষা করো।"
      );
    }
  });

  document.addEventListener("click", (event) => {
    if (menu && !event.target.closest(".report-download")) {
      menu.hidden = true;
    }
  });
}

function getReportContext() {
  const orders = getFilteredOrders();
  const analytics = calculateAnalytics(orders);
  const range = getDateRange();

  const period = range
    ? `${dateLabel(range.start)} - ${dateLabel(range.end)}`
    : "Invalid date range";

  return { orders, analytics, period };
}

/* ---------------- CSV export ---------------- */

function csvCell(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function downloadCSV() {
  const { orders, analytics, period } = getReportContext();
  const rows = [];

  rows.push(["SELLERSPRO BUSINESS REPORT"]);
  rows.push(["Business", profileData.businessName || "Your business"]);
  rows.push(["Report period", period]);
  rows.push(["Generated", new Date().toLocaleString("en-GB")]);
  rows.push([]);

  rows.push(["BUSINESS SUMMARY"]);
  rows.push(["Metric", "Value"]);
  rows.push(["Total orders", analytics.totalOrders]);
  rows.push(["Pending orders", analytics.statusCounts.Pending]);
  rows.push(["Processing orders", analytics.statusCounts.Processing]);
  rows.push(["Delivered orders", analytics.deliveredOrders]);
  rows.push(["Cancelled orders", analytics.cancelledOrders]);
  rows.push(["Delivered revenue (BDT)", analytics.revenue]);
  rows.push([]);

  rows.push(["ORDER DETAILS"]);
  rows.push([
    "Order number", "Date", "Customer", "Status",
    "Items", "Subtotal", "Delivery charge", "Total (BDT)"
  ]);

  orders.forEach((order) => {
    rows.push([
      getOrderNumber(order),
      orderDate(order)?.toLocaleString("en-GB") || "",
      order.customerName || "",
      normalizeStatus(order.status),
      getItems(order).reduce((sum, item) => sum + num(item.quantity), 0),
      num(order.subtotal),
      num(order.deliveryCharge),
      getOrderTotal(order)
    ]);
  });

  rows.push([]);
  rows.push(["BEST-SELLING PRODUCTS"]);
  rows.push(["Product", "Units sold", "Sales value (BDT)"]);

  analytics.topProducts.forEach((product) => {
    rows.push([product.name, product.unitsSold, product.salesValue]);
  });

  const csv = "\uFEFF" + rows
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n");

  downloadBlob(
    new Blob([csv], { type: "text/csv;charset=utf-8;" }),
    `sellersPro-report-${fileDate()}.csv`
  );
}

/* ---------------- PDF export ---------------- */

function downloadPDF() {
  if (!window.jspdf || !window.jspdf.jsPDF) {
    throw new Error(
      "jsPDF is unavailable. Check the jsPDF script URL in analytics.html."
    );
  }

  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4"
  });

  const { orders, analytics, period } = getReportContext();

  pdf.setFontSize(18);
  pdf.text("sellersPro Business Report", 14, 18);

  pdf.setFontSize(10);
  pdf.text(`Business: ${profileData.businessName || "Your business"}`, 14, 26);
  pdf.text(`Report period: ${period}`, 14, 32);
  pdf.text(`Generated: ${new Date().toLocaleString("en-GB")}`, 14, 38);

  if (typeof pdf.autoTable !== "function") {
    throw new Error(
      "jsPDF AutoTable plugin is unavailable. Check its script URL."
    );
  }

  pdf.autoTable({
    startY: 44,
    head: [["Business summary", "Value"]],
    body: [
      ["Total orders", String(analytics.totalOrders)],
      ["Pending orders", String(analytics.statusCounts.Pending)],
      ["Processing orders", String(analytics.statusCounts.Processing)],
      ["Delivered orders", String(analytics.deliveredOrders)],
      ["Cancelled orders", String(analytics.cancelledOrders)],
      ["Delivered revenue", money(analytics.revenue)]
    ],
    theme: "grid",
    headStyles: { fillColor: [23, 43, 77] }
  });

  let y = pdf.lastAutoTable.finalY + 10;

  pdf.setFontSize(13);
  pdf.text("Best-selling products", 14, y);

  pdf.autoTable({
    startY: y + 4,
    head: [["Product", "Units sold", "Sales value"]],
    body: analytics.topProducts.length
      ? analytics.topProducts.map((product) => [
          product.name,
          String(product.unitsSold),
          money(product.salesValue)
        ])
      : [["No delivered product sales", "0", money(0)]],
    theme: "grid",
    headStyles: { fillColor: [23, 43, 77] }
  });

  y = pdf.lastAutoTable.finalY + 10;

  pdf.setFontSize(13);
  pdf.text("Order details", 14, y);

  pdf.autoTable({
    startY: y + 4,
    head: [["Order", "Date", "Customer", "Status", "Total (BDT)"]],
    body: orders.length
      ? orders.map((order) => [
          getOrderNumber(order),
          dateLabel(orderDate(order)),
          order.customerName || "Customer",
          normalizeStatus(order.status),
          getOrderTotal(order).toFixed(2)
        ])
      : [["No orders", "-", "-", "-", "0.00"]],
    theme: "grid",
    headStyles: { fillColor: [23, 43, 77] },
    styles: { fontSize: 8, cellPadding: 2 },
    didDrawPage: () => {
      const pageHeight = pdf.internal.pageSize.getHeight();

      pdf.setFontSize(8);
      pdf.text(
        `sellersPro | Page ${pdf.internal.getNumberOfPages()}`,
        14,
        pageHeight - 7
      );
    }
  });

  pdf.save(`sellersPro-report-${fileDate()}.pdf`);
}

/* ---------------- Download helpers ---------------- */

function fileDate() {
  const date = new Date();

  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();

  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---------------- Chart tooltip dismiss (mobile) ---------------- */

function setupChartTooltipDismiss() {
  const dismiss = (event) => {
    [salesChart, statusChart].forEach((chart) => {
      if (!chart) return;
      if (chart.canvas.contains(event.target)) return;

      chart.setActiveElements([]);
      chart.tooltip?.setActiveElements([], { x: 0, y: 0 });
      chart.update("none");
    });
  };

  document.addEventListener("click", dismiss);
  document.addEventListener("touchstart", dismiss, { passive: true });
}


/* ---------------- Sidebar and logout ---------------- */

function closeSidebar() {
  $("sidebar")?.classList.remove("open");
  $("sidebarOverlay")?.classList.remove("show");
}

function setupNavigation() {
  const sidebar = $("sidebar");
  const toggle = $("menuToggle");

  toggle?.addEventListener("click", (event) => {
    event.stopPropagation();
    if (!sidebar) return;

    const open = !sidebar.classList.contains("open");
    sidebar.classList.toggle("open", open);
    $("sidebarOverlay")?.classList.toggle("show", open);
  });

  // Click on dark overlay closes sidebar
  $("sidebarOverlay")?.addEventListener("click", closeSidebar);

  // Click on any sidebar link closes sidebar
  document.querySelectorAll("#sidebar a").forEach((link) => {
    link.addEventListener("click", closeSidebar);
  });

  // Backup: click anywhere outside the sidebar closes it
  document.addEventListener("click", (event) => {
    if (!sidebar?.classList.contains("open")) return;
    if (event.target.closest("#sidebar") || event.target.closest("#menuToggle")) {
      return;
    }
    closeSidebar();
  });

  $("logoutBtn")?.addEventListener("click", async () => {
    try {
      await signOut(auth);
      window.location.replace("../auth/login.html");
    } catch (error) {
      console.error("Logout error:", error);
      showNotice("Logout failed. Please try again.");
    }
  });
}

/* ---------------- Profile modal ---------------- */

/* ---------------- Profile modal ---------------- */

function setProfileFeedback(message, type = "") {
  const el = $("profileFeedback");
  if (!el) return;

  el.textContent = message;
  el.classList.toggle("is-error", type === "error");
  el.classList.toggle("is-success", type === "success");
}

function setupProfileModal() {
  const modal = $("profileModal");
  const trigger = $("profileTrigger");

  if (!modal || !trigger) {
    console.warn("Profile modal elements missing in analytics.html");
    return;
  }

  // IDs now match analytics.html
  const closeButton = $("closeProfileModal");
  const cancelButton = $("cancelProfile");
  const backdrop = $("profileBackdrop");
  const form = $("profileForm");

  function openProfile(event) {
    event?.preventDefault();
    fillProfileForm();              // always show latest saved data
    setProfileFeedback("");
    modal.hidden = false;
    modal.removeAttribute("aria-hidden");
    document.body.classList.add("profile-modal-open");
  }

  function closeProfile(event) {
    event?.preventDefault();
    modal.hidden = true;
    modal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("profile-modal-open");
  }

  trigger.addEventListener("click", openProfile);
  closeButton?.addEventListener("click", closeProfile);
  cancelButton?.addEventListener("click", closeProfile);
  backdrop?.addEventListener("click", closeProfile);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !modal.hidden) closeProfile();
  });

  // Save seller profile
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!currentUser) {
      setProfileFeedback("Please wait, user is still loading.", "error");
      return;
    }

    const name = $("profileName")?.value.trim() || "";
    const businessName = $("profileBusiness")?.value.trim() || "";
    const phone = $("profilePhone")?.value.trim() || "";

    if (!name || !businessName) {
      setProfileFeedback("Name and business name are required.", "error");
      return;
    }

    const saveButton = $("saveProfileBtn");
    if (saveButton) saveButton.disabled = true;
    setProfileFeedback("Saving...");

    try {
      await setDoc(
        doc(db, "users", currentUser.uid),
        { name, businessName, phone, updatedAt: serverTimestamp() },
        { merge: true }
      );

      await loadProfile();
      closeProfile();
      showNotice("Profile updated successfully.", "success");
      setTimeout(hideNotice, 3000);
    } catch (error) {
      console.error("Profile update failed:", error);
      setProfileFeedback(
        "Could not save profile. Please check Firestore rules.",
        "error"
      );
    } finally {
      if (saveButton) saveButton.disabled = false;
    }
  });
}

/* ---------------- Global Escape key ---------------- */

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;

  closeSidebar();

  if ($("reportFormatMenu")) {
    $("reportFormatMenu").hidden = true;
  }
});