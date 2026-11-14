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

import {
  EXPORT_SECTIONS,
  defaultColumnKeys,
  downloadExport,
  formatCell,
  getBusinessName,
  getRows,
  getSection,
  getSellerName,
  prepareModel
} from "./seller-export.js";

const $ = (id) => document.getElementById(id);

const sellerUid = new URLSearchParams(window.location.search).get("uid");

const COLLECTIONS = ["orders", "products", "customers", "notifications"];
const PAGE_SIZE = 50;

let currentAdmin = null;
let sellerProfile = {};
let sellerData = { orders: [], products: [], customers: [], notifications: [] };

let activeTab = "orders";
let visibleRows = PAGE_SIZE;

function escapeHTML(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function makeCtx() {
  return { uid: sellerUid, profile: sellerProfile, data: sellerData };
}

/* ---------------------------------------------
   Notice (same admin-alert box as the other admin pages)
--------------------------------------------- */

let noticeTimer = null;

function showNotice(message, type = "error") {
  const box = $("sellerNotice");

  clearTimeout(noticeTimer);

  box.textContent = message;
  box.className = "admin-alert";
  if (type === "success") box.classList.add("is-success");
  if (type === "warning") box.classList.add("is-warning");
  box.hidden = false;

  if (type === "success") noticeTimer = setTimeout(hideNotice, 6000);
}

function hideNotice() {
  clearTimeout(noticeTimer);
  $("sellerNotice").hidden = true;
  $("sellerNotice").textContent = "";
}

/* ---------------------------------------------
   Sidebar + logout (same behavior as sellers.js / admin-dashboard.js)
--------------------------------------------- */

function closeSidebar() {
  $("sidebar").classList.remove("open");
  $("sidebarOverlay").classList.remove("show");
}

$("menuToggle").addEventListener("click", () => {
  $("sidebar").classList.toggle("open");
  $("sidebarOverlay").classList.toggle("show");
});

$("sidebarOverlay").addEventListener("click", closeSidebar);

$("adminLogoutBtn").addEventListener("click", async () => {
  const button = $("adminLogoutBtn");
  button.disabled = true;

  try {
    await signOut(auth);
    window.location.replace("login.html");
  } catch (error) {
    console.error("Admin logout error:", error);
    button.disabled = false;
    showNotice("Unable to log out. Please try again.");
  }
});

/* ---------------------------------------------
   Load seller
--------------------------------------------- */

async function verifyAdmin(user) {
  const snapshot = await getDoc(doc(db, "adminUsers", user.uid));
  if (!snapshot.exists()) return null;

  const admin = snapshot.data();

  return admin.active === true && ["admin", "superadmin"].includes(admin.role)
    ? admin
    : null;
}

async function loadCollection(name) {
  const snapshot = await getDocs(collection(db, "users", sellerUid, name));
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
}

async function loadSeller() {
  hideNotice();

  if (!sellerUid) {
    $("sellerLoading").hidden = true;
    showNotice("Seller UID missing. Please open this page from the Sellers list.");
    return;
  }

  $("sellerLoading").hidden = false;
  $("sellerContent").hidden = true;
  $("exportSellerBtn").disabled = true;

  const profileSnap = await getDoc(doc(db, "users", sellerUid));

  if (!profileSnap.exists()) {
    $("sellerLoading").hidden = true;
    showNotice("This seller profile could not be found.");
    return;
  }

  sellerProfile = profileSnap.data();

  // One failing collection must not hide the others
  const results = await Promise.allSettled(COLLECTIONS.map(loadCollection));
  const failed = [];

  COLLECTIONS.forEach((name, index) => {
    const result = results[index];

    if (result.status === "fulfilled") {
      sellerData[name] = result.value;
    } else {
      sellerData[name] = [];
      failed.push(name);
      console.error(`Loading ${name} failed:`, result.reason);
    }
  });

  if (failed.length) {
    showNotice(
      `Could not load: ${failed.join(", ")}. Check the Firestore admin read rules for these collections.`,
      "warning"
    );
  }

  renderProfile();
  renderCounts();
  renderTab();

  $("sellerLoading").hidden = true;
  $("sellerContent").hidden = false;
  $("exportSellerBtn").disabled = false;
}

/* ---------------------------------------------
   Profile + counts
--------------------------------------------- */

function renderProfile() {
  const name = getSellerName(sellerProfile);
  const blocked =
    sellerProfile.accountStatus === "blocked" || sellerProfile.isBlocked === true;

  $("sellerAvatar").textContent = name.trim().charAt(0).toUpperCase() || "S";
  $("sellerName").textContent = name;
  $("sellerEmail").textContent = sellerProfile.email || "Email not provided";
  $("businessName").textContent = getBusinessName(sellerProfile) || "—";
  $("sellerPhone").textContent = sellerProfile.phone || sellerProfile.phoneNumber || "—";
  $("sellerAddress").textContent = sellerProfile.businessAddress || "—";
  $("sellerPlan").textContent = sellerProfile.plan || "Free";
  $("subscriptionStatus").textContent = sellerProfile.subscriptionStatus || "Not specified";
  $("sellerJoined").textContent = formatCell(
    sellerProfile.createdAt || sellerProfile.joinedAt,
    "date",
    "screen"
  );
  $("sellerUid").textContent = sellerUid;

  $("sellerStatus").innerHTML = blocked
    ? '<span class="seller-status blocked">Blocked</span>'
    : '<span class="seller-status active">Active</span>';
}

function renderCounts() {
  $("productCount").textContent = sellerData.products.length;
  $("customerCount").textContent = sellerData.customers.length;
  $("orderCount").textContent = sellerData.orders.length;

  COLLECTIONS.forEach((name) => {
    const badge = document.querySelector(`[data-tab-count="${name}"]`);
    if (badge) badge.textContent = sellerData[name].length;
  });
}

/* ---------------------------------------------
   Activity tabs
--------------------------------------------- */

function badgeClass(value) {
  return `detail-badge is-${String(value || "").toLowerCase()}`;
}

function renderTab() {
  const def = getSection(activeTab);
  const ctx = makeCtx();
  const columns = def.columns.filter((column) => column.show);
  const query = $("tabSearch").value.trim().toLowerCase();

  let rows = getRows(activeTab, ctx);
  const total = rows.length;

  if (query) {
    rows = rows.filter((row) =>
      columns.some((column) =>
        formatCell(column.get(row, ctx), column.type, "screen").toLowerCase().includes(query)
      )
    );
  }

  if (!rows.length) {
    $("tabContent").innerHTML = `
      <div class="detail-empty">
        <i class="bi bi-inbox"></i>
        ${query ? "No matching records." : `No ${escapeHTML(def.label.toLowerCase())} found for this seller.`}
      </div>
    `;
    return;
  }

  const shown = rows.slice(0, visibleRows);

  const head = columns.map((column) => `<th>${escapeHTML(column.label)}</th>`).join("");

  const body = shown.map((row) => `
    <tr>
      ${columns.map((column) => {
        const text = formatCell(column.get(row, ctx), column.type, "screen");

        return column.type === "badge"
          ? `<td><span class="${badgeClass(text)}">${escapeHTML(text)}</span></td>`
          : `<td class="${column.type === "money" || column.type === "number" ? "is-num" : ""}" title="${escapeHTML(text)}">${escapeHTML(text)}</td>`;
      }).join("")}
    </tr>
  `).join("");

  const more = rows.length > shown.length
    ? `<button type="button" class="detail-more" id="showMoreBtn">Show ${Math.min(PAGE_SIZE, rows.length - shown.length)} more</button>`
    : "";

  $("tabContent").innerHTML = `
    <div class="detail-table-wrap">
      <table class="detail-table">
        <thead><tr>${head}</tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>
    <div class="detail-table-footer">
      <span>Showing ${shown.length} of ${rows.length}${query ? ` matches (${total} total)` : ""}, newest first.</span>
      ${more}
    </div>
  `;
}

function activateTab(tab) {
  activeTab = tab;
  visibleRows = PAGE_SIZE;
  $("tabSearch").value = "";

  document.querySelectorAll(".detail-tab").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === tab);
  });

  renderTab();
}

document.querySelectorAll(".detail-tab").forEach((button) => {
  button.addEventListener("click", () => activateTab(button.dataset.tab));
});

$("tabSearch").addEventListener("input", () => {
  visibleRows = PAGE_SIZE;
  renderTab();
});

$("tabContent").addEventListener("click", (event) => {
  if (event.target.closest("#showMoreBtn")) {
    visibleRows += PAGE_SIZE;
    renderTab();
  }
});

$("sellerUid").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(sellerUid);
    showNotice("Seller UID copied.", "success");
  } catch {
    /* clipboard not available, ignore */
  }
});

$("refreshSellerBtn").addEventListener("click", async () => {
  const button = $("refreshSellerBtn");
  button.disabled = true;

  try {
    await loadSeller();
  } catch (error) {
    console.error("Refresh failed:", error);
    showNotice("Could not refresh seller data.");
  } finally {
    button.disabled = false;
  }
});

/* =====================================================
   Export modal
===================================================== */

const exportState = {
  format: "csv",
  selected: new Set(),
  columns: {},
  rawJson: false,
  built: false
};

const DEFAULT_SECTIONS = ["profile", "orders", "products", "customers"];

const PRESETS = {
  profile: ["profile"],
  orders: ["orders", "orderItems"],
  products: ["products"],
  customers: ["customers"],
  all: EXPORT_SECTIONS.map((section) => section.id)
};

const FORMAT_HINTS = {
  csv: "Opens in Excel / Google Sheets. Several sections are packed into one ZIP (one CSV each).",
  pdf: "Print-ready report. Bangla text and the ৳ sign are not supported in PDF, use CSV or JSON for those.",
  json: "Structured backup for developers. Dates are in ISO format."
};

function resetExportState(preselect) {
  exportState.selected = new Set(preselect);
  exportState.columns = {};

  EXPORT_SECTIONS.forEach((def) => {
    exportState.columns[def.id] = new Set(defaultColumnKeys(def));
  });
}

function buildExportSections() {
  $("exportSections").innerHTML = EXPORT_SECTIONS.map((def) => `
    <div class="export-section" data-section="${def.id}">
      <label class="export-section-main">
        <input type="checkbox" data-section-check="${def.id}">
        <span class="export-section-icon"><i class="bi ${def.icon}"></i></span>
        <span class="export-section-text">
          <strong>${escapeHTML(def.label)}</strong>
          <small>${escapeHTML(def.description)}</small>
        </span>
        <span class="export-section-count" data-count="${def.id}">—</span>
      </label>

      <details class="export-columns">
        <summary>Customize columns <span data-col-summary="${def.id}"></span></summary>
        <div class="export-column-actions">
          <button type="button" data-cols-all="${def.id}">Select all</button>
          <button type="button" data-cols-default="${def.id}">Reset</button>
        </div>
        <div class="export-column-grid">
          ${def.columns.map((column) => `
            <label>
              <input type="checkbox" data-col="${def.id}:${column.key}">
              <span>${escapeHTML(column.label)}</span>
            </label>
          `).join("")}
        </div>
      </details>
    </div>
  `).join("");

  exportState.built = true;
}

/** Turn the date/status controls into filter values (Asia/Dhaka, UTC+6) */
function currentFilters() {
  const mode = $("exportDateMode").value;
  const now = new Date();
  const DAY = 86400000;
  const OFFSET = 6 * 3600000;

  let from = null;
  let to = null;

  const dhakaNow = new Date(now.getTime() + OFFSET);
  const year = dhakaNow.getUTCFullYear();
  const month = dhakaNow.getUTCMonth();

  const monthRange = (shift) => ({
    from: new Date(Date.UTC(year, month + shift, 1) - OFFSET),
    to: new Date(Date.UTC(year, month + shift + 1, 1) - OFFSET - 1)
  });

  if (mode === "30days") {
    from = new Date(now.getTime() - 30 * DAY);
    to = now;
  } else if (mode === "thisMonth") {
    ({ from, to } = monthRange(0));
  } else if (mode === "lastMonth") {
    ({ from, to } = monthRange(-1));
  } else if (mode === "custom") {
    const fromValue = $("exportFrom").value;
    const toValue = $("exportTo").value;

    if (fromValue) from = new Date(`${fromValue}T00:00:00+06:00`);
    if (toValue) to = new Date(`${toValue}T23:59:59.999+06:00`);
  }

  return { from, to, status: $("exportStatus").value };
}

function syncExportUI() {
  const ctx = makeCtx();
  const filters = currentFilters();

  let sectionCount = 0;
  let recordCount = 0;

  EXPORT_SECTIONS.forEach((def) => {
    const selected = exportState.selected.has(def.id);
    const count = getRows(def.id, ctx, filters).length;
    const keys = exportState.columns[def.id];

    const root = document.querySelector(`[data-section="${def.id}"]`);
    root.classList.toggle("is-selected", selected);
    root.querySelector(`[data-section-check]`).checked = selected;

    root.querySelectorAll("[data-col]").forEach((input) => {
      input.checked = keys.has(input.dataset.col.split(":")[1]);
    });

    root.querySelector(`[data-count="${def.id}"]`).textContent =
      def.single ? "1 record" : `${count} record${count === 1 ? "" : "s"}`;

    root.querySelector(`[data-col-summary="${def.id}"]`).textContent =
      `(${keys.size}/${def.columns.length})`;

    if (selected) {
      sectionCount += 1;
      recordCount += count;
    }
  });

  const usesOrders = ["orders", "orderItems"].some((id) => exportState.selected.has(id));
  $("exportStatusRow").hidden = !usesOrders;

  const custom = $("exportDateMode").value === "custom";
  $("exportFromRow").hidden = !custom;
  $("exportToRow").hidden = !custom;

  $("rawJsonRow").hidden = exportState.format !== "json";
  $("exportFormatHint").textContent = FORMAT_HINTS[exportState.format];

  const label = exportState.format === "csv" && sectionCount > 1
    ? "Download ZIP (CSV)"
    : `Download ${exportState.format.toUpperCase()}`;
  $("exportDownloadLabel").textContent = label;

  const warn = exportState.format === "pdf" && recordCount > 2000
    ? " Large PDFs can be slow, CSV is recommended."
    : "";

  $("exportSummary").textContent = sectionCount
    ? `${sectionCount} section${sectionCount === 1 ? "" : "s"} selected · ${recordCount} record${recordCount === 1 ? "" : "s"}.${warn}`
    : "Select at least one section to export.";
}

function setExportFeedback(message) {
  $("exportFeedback").textContent = message;
  $("exportFeedback").hidden = !message;
}

function openExport(preselect = DEFAULT_SECTIONS) {
  if (!sellerUid || !$("sellerContent") || $("sellerContent").hidden) return;

  if (!exportState.built) buildExportSections();

  resetExportState(preselect);

  exportState.format = "csv";
  exportState.rawJson = false;
  document.querySelector('input[name="exportFormat"][value="csv"]').checked = true;
  $("rawJsonCheck").checked = false;
  $("exportDateMode").value = "all";
  $("exportStatus").value = "all";
  $("exportFrom").value = "";
  $("exportTo").value = "";
  setExportFeedback("");

  syncExportUI();

  $("exportModal").hidden = false;
  document.body.style.overflow = "hidden";
}

function closeExport() {
  $("exportModal").hidden = true;
  document.body.style.overflow = "";
}

$("exportSellerBtn").addEventListener("click", () => openExport(DEFAULT_SECTIONS));
$("exportProfileBtn").addEventListener("click", () => openExport(["profile"]));
$("exportTabBtn").addEventListener("click", () => openExport([activeTab]));

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !$("exportModal").hidden) closeExport();
});

$("exportModal").addEventListener("click", (event) => {
  const target = event.target;

  if (target.closest("[data-close-export]")) {
    closeExport();
    return;
  }

  const preset = target.closest("[data-preset]");
  if (preset) {
    exportState.selected = new Set(PRESETS[preset.dataset.preset]);
    syncExportUI();
    return;
  }

  const all = target.closest("[data-cols-all]");
  if (all) {
    const def = getSection(all.dataset.colsAll);
    exportState.columns[def.id] = new Set(def.columns.map((column) => column.key));
    syncExportUI();
    return;
  }

  const reset = target.closest("[data-cols-default]");
  if (reset) {
    const def = getSection(reset.dataset.colsDefault);
    exportState.columns[def.id] = new Set(defaultColumnKeys(def));
    syncExportUI();
  }
});

$("exportModal").addEventListener("change", (event) => {
  const input = event.target;

  if (input.matches("[data-section-check]")) {
    const id = input.dataset.sectionCheck;
    input.checked ? exportState.selected.add(id) : exportState.selected.delete(id);
  } else if (input.matches("[data-col]")) {
    const [id, key] = input.dataset.col.split(":");
    input.checked ? exportState.columns[id].add(key) : exportState.columns[id].delete(key);
  } else if (input.name === "exportFormat") {
    exportState.format = input.value;
  } else if (input.id === "rawJsonCheck") {
    exportState.rawJson = input.checked;
  }

  setExportFeedback("");
  syncExportUI();
});

$("exportDownloadBtn").addEventListener("click", async () => {
  setExportFeedback("");

  const sectionIds = EXPORT_SECTIONS
    .map((def) => def.id)
    .filter((id) => exportState.selected.has(id));

  if (!sectionIds.length) {
    setExportFeedback("Select at least one section to export.");
    return;
  }

  const emptyColumns = sectionIds.find(
    (id) => !exportState.rawJson && exportState.columns[id].size === 0
  );

  if (emptyColumns) {
    setExportFeedback(`Select at least one column for "${getSection(emptyColumns).label}".`);
    return;
  }

  const filters = currentFilters();

  if (filters.from && filters.to && filters.from > filters.to) {
    setExportFeedback("The start date must be before the end date.");
    return;
  }

  const button = $("exportDownloadBtn");
  const originalHTML = button.innerHTML;
  button.disabled = true;
  button.innerHTML = '<span class="spinner-border spinner-border-sm" aria-hidden="true"></span> Preparing...';

  try {
    const ctx = makeCtx();

    const columns = {};
    sectionIds.forEach((id) => {
      columns[id] = [...exportState.columns[id]];
    });

    const model = prepareModel(
      ctx,
      { sectionIds, columns, rawJson: exportState.format === "json" && exportState.rawJson },
      filters,
      currentAdmin?.email || "admin"
    );

    const result = await downloadExport(exportState.format, model, ctx);

    closeExport();

    showNotice(
      `Export ready: ${result.fileName}` +
        (result.warnings.length ? `. Note: ${result.warnings.join(" ")}` : ""),
      result.warnings.length ? "warning" : "success"
    );
  } catch (error) {
    console.error("Export failed:", error);
    setExportFeedback(error.message || "Could not create the export. Please try again.");
  } finally {
    button.disabled = false;
    button.innerHTML = originalHTML;
  }
});

/* ---------------------------------------------
   Auth
--------------------------------------------- */

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.replace("login.html");
    return;
  }

  try {
    const admin = await verifyAdmin(user);

    if (!admin) {
      await signOut(auth);
      window.location.replace("login.html");
      return;
    }

    currentAdmin = { email: user.email || "", name: admin.name || "Administrator" };

    $("adminName").textContent = currentAdmin.name;
    $("adminEmailLabel").textContent = currentAdmin.email;

    await loadSeller();
  } catch (error) {
    console.error("Seller details error:", error);

    $("sellerLoading").hidden = true;
    showNotice(
      error.code === "permission-denied"
        ? "Permission denied. Check your Firestore admin read rules."
        : error.message || "Could not load seller details."
    );
  }
});