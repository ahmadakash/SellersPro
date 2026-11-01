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

const $ = (id) => document.getElementById(id);

let allLogs = [];

function escapeHTML(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function getTimestamp(value) {
  if (!value) return 0;

  if (typeof value.toMillis === "function") {
    return value.toMillis();
  }

  if (typeof value.toDate === "function") {
    return value.toDate().getTime();
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function formatDate(value) {
  const timestamp = getTimestamp(value);

  if (!timestamp) return "—";

  return new Date(timestamp).toLocaleString("en-BD", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function getCategory(log) {
  const category = String(
    log.category || log.type || "security"
  ).toLowerCase();

  if (category.includes("payment")) return "payment";
  if (category.includes("seller")) return "seller";
  if (category.includes("subscription")) return "subscription";
  if (category.includes("setting") || category.includes("pricing")) {
    return "settings";
  }

  return "security";
}

function showFeedback(message) {
  const element = $("auditFeedback");
  element.textContent = message;
  element.hidden = false;
}

async function verifyAdmin(user) {
  const snapshot = await getDoc(
    doc(db, "adminUsers", user.uid)
  );

  if (!snapshot.exists()) return null;

  const data = snapshot.data();

  if (
    data.active !== true ||
    !["admin", "superadmin"].includes(data.role)
  ) {
    return null;
  }

  return data;
}

async function loadLogs() {
  $("auditLoading").hidden = false;
  $("auditTableWrap").hidden = true;
  $("auditEmpty").hidden = true;
  $("auditFeedback").hidden = true;

  try {
    const snapshot = await getDocs(
      collection(db, "auditLogs")
    );

    allLogs = snapshot.docs.map((item) => ({
      id: item.id,
      ...item.data()
    }));

    allLogs.sort((a, b) => {
      return getTimestamp(b.createdAt || b.timestamp) -
        getTimestamp(a.createdAt || a.timestamp);
    });

    updateStats();
    renderLogs();

  } catch (error) {
    console.error("Audit log loading error:", error);

    showFeedback(
      error.code === "permission-denied"
        ? "Permission denied. Check auditLogs Firestore read rules."
        : "Unable to load activity logs."
    );
  } finally {
    $("auditLoading").hidden = true;
  }
}

function updateStats() {
  $("totalLogs").textContent = allLogs.length;

  $("paymentLogs").textContent = allLogs.filter(
    (log) => getCategory(log) === "payment"
  ).length;

  $("sellerLogs").textContent = allLogs.filter(
    (log) => getCategory(log) === "seller"
  ).length;

  $("settingsLogs").textContent = allLogs.filter(
    (log) => getCategory(log) === "settings"
  ).length;
}

function renderLogs() {
  const search = $("logSearch").value.trim().toLowerCase();
  const filter = $("logFilter").value;

  const filtered = allLogs.filter((log) => {
    const category = getCategory(log);

    const matchesFilter =
      filter === "all" || category === filter;

    const searchable = [
      log.action,
      log.description,
      log.adminName,
      log.adminEmail,
      log.targetName,
      log.targetUid,
      log.category,
      log.type
    ].join(" ").toLowerCase();

    return matchesFilter && searchable.includes(search);
  });

  $("auditResultCount").textContent =
    `${filtered.length} record${filtered.length === 1 ? "" : "s"}`;

  if (!filtered.length) {
    $("auditTableBody").innerHTML = "";
    $("auditTableWrap").hidden = true;
    $("auditEmpty").hidden = false;
    return;
  }

  $("auditEmpty").hidden = true;
  $("auditTableWrap").hidden = false;

  $("auditTableBody").innerHTML = filtered.map((log) => {
    const category = getCategory(log);

    return `
      <tr>
        <td>
          <div class="audit-action-title">
            ${escapeHTML(log.action || "Administrative activity")}
          </div>
          <span class="audit-action-description">
            ${escapeHTML(log.description || "—")}
          </span>
        </td>

        <td>
          <div class="audit-admin-cell">
            <strong>${escapeHTML(log.adminName || "Administrator")}</strong>
            <small>${escapeHTML(log.adminEmail || "—")}</small>
          </div>
        </td>

        <td>
          <div class="audit-target-cell">
            <strong>${escapeHTML(log.targetName || "—")}</strong>
            <small>${escapeHTML(log.targetUid || log.targetId || "")}</small>
          </div>
        </td>

        <td>${escapeHTML(formatDate(log.createdAt || log.timestamp))}</td>

        <td>
          <span class="audit-category">${escapeHTML(category)}</span>
        </td>
      </tr>
    `;
  }).join("");
}

$("logSearch").addEventListener("input", renderLogs);
$("logFilter").addEventListener("change", renderLogs);
$("refreshLogsBtn").addEventListener("click", loadLogs);

$("menuToggle").addEventListener("click", () => {
  $("sidebar").classList.toggle("open");
  $("sidebarOverlay").classList.toggle("show");
});

$("sidebarOverlay").addEventListener("click", () => {
  $("sidebar").classList.remove("open");
  $("sidebarOverlay").classList.remove("show");
});

$("adminLogoutBtn").addEventListener("click", async () => {
  try {
    await signOut(auth);
    window.location.replace("login.html");
  } catch (error) {
    console.error(error);
    alert("Unable to log out.");
  }
});

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.replace("login.html");
    return;
  }

  try {
    const adminData = await verifyAdmin(user);

    if (!adminData) {
      await signOut(auth);
      window.location.replace("login.html");
      return;
    }

    $("adminName").textContent =
      adminData.name || "Administrator";

    $("adminEmailLabel").textContent =
      user.email || "";

    await loadLogs();

  } catch (error) {
    console.error("Admin verification error:", error);
    showFeedback("Could not verify Admin access.");
    $("auditLoading").hidden = true;
  }
});