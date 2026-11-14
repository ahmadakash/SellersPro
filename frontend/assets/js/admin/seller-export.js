/* =====================================================
   SellersPro Admin - Seller data export
   File: assets/js/admin/seller-export.js

   Pure data/format logic (no DOM). To export a new kind of
   history (payments, subscriptions, ...) add ONE entry to
   EXPORT_SECTIONS below. The page UI picks it up automatically.
===================================================== */

const TZ = "Asia/Dhaka";
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
];

/* ---------------------------------------------
   Small helpers
--------------------------------------------- */

const pick = (obj, ...keys) => {
  for (const key of keys) {
    const value = obj?.[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
};

const num = (value) => {
  if (value === undefined || value === null || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
};

const normStatus = (status) => {
  const value = String(status || "Pending").trim().toLowerCase();
  return value === "canceled" ? "cancelled" : value;
};

const statusLabel = (status) => {
  const value = normStatus(status);
  return value.charAt(0).toUpperCase() + value.slice(1);
};

export function toDate(value) {
  if (!value) return null;

  const date =
    typeof value.toDate === "function" ? value.toDate()
    : value instanceof Date ? value
    : new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

const partsFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23"
});

function dateParts(date) {
  const out = {};
  for (const part of partsFormatter.formatToParts(date)) out[part.type] = part.value;
  return out;
}

/** 2026-10-31 14:05 (Asia/Dhaka) - sortable, used for CSV */
export function isoLocal(date) {
  const p = dateParts(date);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

/** 31 Oct 2026, 14:05 (Asia/Dhaka) - used on screen and PDF */
export function humanDate(date) {
  const p = dateParts(date);
  return `${p.day} ${MONTHS[Number(p.month) - 1]} ${p.year}, ${p.hour}:${p.minute}`;
}

export function getSellerName(profile = {}) {
  return pick(profile, "name", "fullName", "displayName", "ownerName") || "Seller";
}

export function getBusinessName(profile = {}) {
  return pick(profile, "businessName", "shopName", "storeName") || "";
}

/**
 * target: "screen" | "pdf" | "csv"
 * type:   "text" | "number" | "money" | "date" | "boolean"
 */
export function formatCell(value, type = "text", target = "screen") {
  const empty = target === "csv" ? "" : "—";

  if (value === undefined || value === null || value === "") return empty;

  if (type === "date") {
    const date = toDate(value);
    if (!date) return empty;
    return target === "csv" ? isoLocal(date) : humanDate(date);
  }

  if (type === "money") {
    const n = Number(value);
    if (!Number.isFinite(n)) return String(value);
    return target === "csv"
      ? String(n)
      : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  if (type === "number") {
    const n = Number(value);
    if (!Number.isFinite(n)) return String(value);
    return target === "csv" ? String(n) : n.toLocaleString("en-US");
  }

  if (type === "boolean") return value ? "Yes" : "No";

  return String(value);
}

function jsonValue(column, row, ctx) {
  if (column.json) return column.json(row, ctx) ?? null;

  const value = column.get(row, ctx);
  if (value === undefined || value === null || value === "") return null;

  if (column.type === "date") {
    const date = toDate(value);
    return date ? date.toISOString() : null;
  }

  return value;
}

function normalizeRaw(value) {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalizeRaw);

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, normalizeRaw(item)])
    );
  }

  return value;
}

/* ---------------------------------------------
   Section registry
   column: { key, label, type, get(row, ctx), json?(row, ctx),
             default?: false to start unchecked, show?: true = on-screen table }
--------------------------------------------- */

const orderDate = (order) => pick(order, "createdAt", "orderDate", "date");
const createdDate = (row) => pick(row, "createdAt", "updatedAt", "date", "timestamp");

const itemsOf = (order) => (Array.isArray(order.items) ? order.items : []);

const itemsSummary = (order) =>
  itemsOf(order)
    .map((item) => `${item.productName || item.name || "Item"} x${item.quantity ?? 1}`)
    .join("; ");

function customerStats(ctx) {
  if (ctx.customerStats) return ctx.customerStats;

  const stats = new Map();

  for (const order of ctx.data.orders || []) {
    if (!order.customerId) continue;

    const entry = stats.get(order.customerId) || { orders: 0, ordered: 0 };
    entry.orders += 1;

    if (normStatus(order.status) !== "cancelled") {
      entry.ordered += num(pick(order, "total", "grandTotal", "amount")) || 0;
    }

    stats.set(order.customerId, entry);
  }

  ctx.customerStats = stats;
  return stats;
}

export const EXPORT_SECTIONS = [
  {
    id: "profile",
    label: "Seller profile",
    fileLabel: "profile",
    icon: "bi-person-badge",
    description: "Account, business, plan and status details",
    single: true,
    columns: [
      { key: "name", label: "Full name", get: (p) => getSellerName(p) },
      { key: "email", label: "Email", get: (p) => p.email },
      { key: "businessName", label: "Business name", get: (p) => getBusinessName(p) },
      { key: "phone", label: "Phone", get: (p) => pick(p, "phone", "phoneNumber") },
      { key: "businessAddress", label: "Business address", get: (p) => p.businessAddress },
      { key: "plan", label: "Plan", get: (p) => p.plan || "Free" },
      { key: "subscriptionStatus", label: "Subscription status", get: (p) => p.subscriptionStatus },
      {
        key: "accountStatus",
        label: "Account status",
        get: (p) => (p.accountStatus === "blocked" || p.isBlocked === true ? "Blocked" : "Active")
      },
      { key: "joined", label: "Joined", type: "date", get: (p) => pick(p, "createdAt", "joinedAt") },
      { key: "updatedAt", label: "Last updated", type: "date", get: (p) => p.updatedAt, default: false },
      { key: "authProvider", label: "Sign-in method", get: (p) => p.authProvider, default: false },
      { key: "uid", label: "Seller UID", get: (p) => p.uid }
    ]
  },

  {
    id: "orders",
    label: "Order history",
    fileLabel: "orders",
    icon: "bi-receipt",
    description: "Every order with customer, status and totals",
    source: "orders",
    hasStatus: true,
    date: orderDate,
    columns: [
      { key: "orderNumber", label: "Order no.", show: true, get: (o) => o.orderNumber || o.id },
      { key: "date", label: "Date", type: "date", show: true, get: orderDate },
      { key: "customerName", label: "Customer", show: true, get: (o) => o.customerName },
      { key: "customerPhone", label: "Customer phone", get: (o) => o.customerPhone },
      { key: "customerEmail", label: "Customer email", default: false, get: (o) => o.customerEmail },
      { key: "customerAddress", label: "Delivery address", get: (o) => o.customerAddress },
      { key: "deliveryArea", label: "Delivery area", default: false, get: (o) => o.deliveryArea },
      { key: "status", label: "Status", type: "badge", show: true, get: (o) => statusLabel(o.status) },
      {
        key: "itemCount",
        label: "Items",
        type: "number",
        get: (o) => o.itemCount ?? itemsOf(o).reduce((sum, i) => sum + (num(i.quantity) || 1), 0)
      },
      { key: "items", label: "Products", get: (o) => itemsSummary(o), json: (o) => itemsOf(o) },
      { key: "subtotal", label: "Subtotal (BDT)", type: "money", get: (o) => num(o.subtotal) },
      { key: "deliveryCharge", label: "Delivery (BDT)", type: "money", get: (o) => num(o.deliveryCharge) },
      {
        key: "total",
        label: "Total (BDT)",
        type: "money",
        show: true,
        get: (o) => num(pick(o, "total", "grandTotal", "amount"))
      },
      { key: "notes", label: "Notes", default: false, get: (o) => o.notes },
      { key: "orderId", label: "Order ID", default: false, get: (o) => o.id }
    ]
  },

  {
    id: "orderItems",
    label: "Sold items",
    fileLabel: "sold-items",
    icon: "bi-bag-check",
    description: "One row per product sold (good for product-wise sales)",
    source: "orders",
    hasStatus: true,
    date: orderDate,
    flatten: (orders) =>
      orders.flatMap((order) =>
        itemsOf(order).map((item) => {
          const quantity = num(item.quantity);
          const unitPrice = num(item.unitPrice);

          return {
            orderNumber: order.orderNumber || order.id,
            date: orderDate(order),
            customerName: order.customerName,
            status: statusLabel(order.status),
            productName: item.productName || item.name,
            sku: item.sku,
            quantity,
            unitPrice,
            lineTotal: num(item.lineTotal) ?? (quantity !== undefined && unitPrice !== undefined ? quantity * unitPrice : undefined),
            productId: item.productId,
            orderId: order.id
          };
        })
      ),
    columns: [
      { key: "orderNumber", label: "Order no.", get: (r) => r.orderNumber },
      { key: "date", label: "Date", type: "date", get: (r) => r.date },
      { key: "customerName", label: "Customer", get: (r) => r.customerName },
      { key: "status", label: "Status", get: (r) => r.status },
      { key: "productName", label: "Product", get: (r) => r.productName },
      { key: "sku", label: "SKU", get: (r) => r.sku },
      { key: "quantity", label: "Qty", type: "number", get: (r) => r.quantity },
      { key: "unitPrice", label: "Unit price (BDT)", type: "money", get: (r) => r.unitPrice },
      { key: "lineTotal", label: "Line total (BDT)", type: "money", get: (r) => r.lineTotal },
      { key: "productId", label: "Product ID", default: false, get: (r) => r.productId },
      { key: "orderId", label: "Order ID", default: false, get: (r) => r.orderId }
    ]
  },

  {
    id: "products",
    label: "Product history",
    fileLabel: "products",
    icon: "bi-box-seam",
    description: "Catalog with prices and current stock",
    date: createdDate,
    columns: [
      { key: "name", label: "Product", show: true, get: (p) => pick(p, "name", "productName", "title") || p.id },
      { key: "sku", label: "SKU", show: true, get: (p) => pick(p, "sku", "code") },
      { key: "category", label: "Category", show: true, get: (p) => p.category },
      { key: "sellingPrice", label: "Selling price (BDT)", type: "money", show: true, get: (p) => num(pick(p, "sellingPrice", "price")) },
      { key: "costPrice", label: "Cost price (BDT)", type: "money", get: (p) => num(p.costPrice) },
      { key: "stock", label: "Stock", type: "number", show: true, get: (p) => num(pick(p, "stock", "quantity")) },
      { key: "lowStockThreshold", label: "Low-stock level", type: "number", default: false, get: (p) => num(p.lowStockThreshold) },
      {
        key: "stockValue",
        label: "Stock value at cost (BDT)",
        type: "money",
        default: false,
        get: (p) => {
          const stock = num(pick(p, "stock", "quantity"));
          const cost = num(p.costPrice);
          return stock !== undefined && cost !== undefined ? stock * cost : undefined;
        }
      },
      { key: "description", label: "Description", default: false, get: (p) => p.description },
      { key: "createdAt", label: "Added", type: "date", show: true, get: (p) => p.createdAt },
      { key: "updatedAt", label: "Updated", type: "date", default: false, get: (p) => p.updatedAt },
      { key: "id", label: "Product ID", default: false, get: (p) => p.id }
    ]
  },

  {
    id: "customers",
    label: "Customer history",
    fileLabel: "customers",
    icon: "bi-people",
    description: "Customer list with order count and value",
    date: createdDate,
    columns: [
      { key: "name", label: "Customer", show: true, get: (c) => pick(c, "name", "customerName", "fullName") || c.id },
      { key: "phone", label: "Phone", show: true, get: (c) => pick(c, "phone", "phoneNumber") },
      { key: "email", label: "Email", show: true, get: (c) => c.email },
      { key: "address", label: "Address", show: true, get: (c) => c.address },
      { key: "notes", label: "Notes", default: false, get: (c) => c.notes },
      {
        key: "orderCount",
        label: "Orders placed",
        type: "number",
        show: true,
        get: (c, ctx) => customerStats(ctx).get(c.id)?.orders ?? 0
      },
      {
        key: "totalOrdered",
        label: "Total ordered, excl. cancelled (BDT)",
        type: "money",
        get: (c, ctx) => customerStats(ctx).get(c.id)?.ordered ?? 0
      },
      { key: "createdAt", label: "Added", type: "date", get: (c) => c.createdAt },
      { key: "id", label: "Customer ID", default: false, get: (c) => c.id }
    ]
  },

  {
    id: "notifications",
    label: "Notifications",
    fileLabel: "notifications",
    icon: "bi-bell",
    description: "Alerts the seller received",
    date: createdDate,
    columns: [
      { key: "title", label: "Title", show: true, get: (n) => n.title || "Notification" },
      { key: "message", label: "Message", show: true, get: (n) => pick(n, "message", "text") },
      { key: "type", label: "Type", show: true, get: (n) => n.type },
      { key: "read", label: "Read", type: "boolean", get: (n) => n.read === true },
      { key: "createdAt", label: "Date", type: "date", show: true, get: (n) => n.createdAt }
    ]
  }
];

const SECTION_MAP = Object.fromEntries(EXPORT_SECTIONS.map((def) => [def.id, def]));

export const getSection = (id) => SECTION_MAP[id];

export const defaultColumnKeys = (def) =>
  def.columns.filter((column) => column.default !== false).map((column) => column.key);

/* ---------------------------------------------
   Rows + filters
   ctx = { uid, profile, data: { orders, products, customers, notifications } }
   filters = { from: Date|null, to: Date|null, status: "all"|"pending"|... }
--------------------------------------------- */

export function getRows(sectionId, ctx, filters = {}) {
  const def = SECTION_MAP[sectionId];
  if (!def) return [];

  if (def.single) return [{ ...ctx.profile, uid: ctx.uid }];

  const source = def.source ? ctx.data[def.source] : ctx.data[def.id];
  let rows = Array.isArray(source) ? [...source] : [];

  const { from = null, to = null, status = "all" } = filters;

  if (def.hasStatus && status !== "all") {
    rows = rows.filter((row) => normStatus(row.status) === status);
  }

  if (def.date && (from || to)) {
    rows = rows.filter((row) => {
      const date = toDate(def.date(row));
      if (!date) return false;
      if (from && date < from) return false;
      if (to && date > to) return false;
      return true;
    });
  }

  if (def.date) {
    rows.sort((a, b) => (toDate(def.date(b))?.getTime() || 0) - (toDate(def.date(a))?.getTime() || 0));
  }

  return def.flatten ? def.flatten(rows) : rows;
}

/** Build the export model from the admin's choices */
export function prepareModel(ctx, selection, filters, exportedBy) {
  const sections = selection.sectionIds
    .filter((id) => SECTION_MAP[id])
    .map((id) => {
      const def = SECTION_MAP[id];
      const keys = selection.columns[id] || defaultColumnKeys(def);

      return {
        def,
        columns: def.columns.filter((column) => keys.includes(column.key)),
        rows: getRows(id, ctx, filters)
      };
    });

  return {
    exportedAt: new Date(),
    exportedBy: exportedBy || "admin",
    filters,
    rawJson: selection.rawJson === true,
    sections
  };
}

function filtersText(filters = {}) {
  const parts = [];

  if (filters.from || filters.to) {
    parts.push(
      `Date: ${filters.from ? isoLocal(filters.from).slice(0, 10) : "start"} to ${filters.to ? isoLocal(filters.to).slice(0, 10) : "today"}`
    );
  } else {
    parts.push("Date: all time");
  }

  if (filters.status && filters.status !== "all") {
    parts.push(`Order status: ${statusLabel(filters.status)}`);
  }

  return parts.join("  |  ");
}

/* ---------------------------------------------
   CSV
--------------------------------------------- */

function csvCell(value) {
  let text = String(value ?? "");

  // Block spreadsheet formula injection (=, +, -, @) but keep phone numbers and negatives
  if (/^[=+\-@\t\r]/.test(text) && !/^[+\-]?[\d\s().\-]+$/.test(text)) {
    text = `'${text}`;
  }

  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function buildCsv(section, ctx) {
  const header = section.columns.map((column) => csvCell(column.label)).join(",");

  const lines = section.rows.map((row) =>
    section.columns
      .map((column) => csvCell(formatCell(column.get(row, ctx), column.type, "csv")))
      .join(",")
  );

  return [header, ...lines].join("\r\n") + "\r\n";
}

/* ---------------------------------------------
   JSON
--------------------------------------------- */

function buildJson(model, ctx) {
  const out = {
    meta: {
      app: "SellersPro",
      exportedAt: model.exportedAt.toISOString(),
      exportedBy: model.exportedBy,
      sellerUid: ctx.uid,
      timezoneNote: "Dates are ISO-8601 UTC",
      filters: {
        from: model.filters.from ? model.filters.from.toISOString() : null,
        to: model.filters.to ? model.filters.to.toISOString() : null,
        orderStatus: model.filters.status || "all"
      },
      sections: model.sections.map((section) => section.def.id),
      allRawFields: model.rawJson
    }
  };

  for (const section of model.sections) {
    const { def, columns, rows } = section;

    const mapRow = (row) =>
      model.rawJson
        ? normalizeRaw(row)
        : Object.fromEntries(columns.map((column) => [column.key, jsonValue(column, row, ctx)]));

    out[def.id] = def.single ? mapRow(rows[0] || {}) : rows.map(mapRow);
  }

  return out;
}

/* ---------------------------------------------
   PDF (needs jsPDF + jspdf-autotable loaded on the page)
--------------------------------------------- */

let pdfReplacedChars = 0;

// jsPDF's built-in fonts only support Latin-1 (no Bangla, no ৳)
function pdfSafe(value) {
  const text = String(value ?? "")
    .replace(/৳/g, "BDT ")
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2026/g, "...");

  return text.replace(/[^\x00-\xFF]/g, () => {
    pdfReplacedChars += 1;
    return "?";
  });
}

function buildPdf(model, ctx) {
  const JsPdf = typeof window !== "undefined" ? window.jspdf?.jsPDF : null;

  if (!JsPdf) {
    throw new Error("PDF library did not load. Check your internet connection and refresh the page.");
  }

  const doc = new JsPdf({ orientation: "landscape", unit: "pt", format: "a4" });

  if (typeof doc.autoTable !== "function") {
    throw new Error("PDF table plugin did not load. Refresh the page and try again.");
  }

  pdfReplacedChars = 0;

  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 36;
  const sellerName = getSellerName(ctx.profile);
  const business = getBusinessName(ctx.profile);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(17);
  doc.setTextColor(23, 43, 77);
  doc.text("SellersPro - Seller data export", margin, 46);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(100, 114, 138);

  const metaLines = [
    `Seller: ${sellerName}${business ? ` (${business})` : ""}`,
    `Seller UID: ${ctx.uid}`,
    `Exported: ${humanDate(model.exportedAt)} (Asia/Dhaka)   |   By: ${model.exportedBy}`,
    `Filters: ${filtersText(model.filters)}`
  ];

  metaLines.forEach((line, index) => doc.text(pdfSafe(line), margin, 64 + index * 13));

  let y = 64 + metaLines.length * 13 + 16;

  for (const section of model.sections) {
    const { def, columns, rows } = section;

    if (y > pageHeight - 120) {
      doc.addPage();
      y = 46;
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(36, 51, 77);
    doc.text(pdfSafe(def.single ? def.label : `${def.label} (${rows.length})`), margin, y);

    const common = {
      startY: y + 8,
      styles: { fontSize: 8, cellPadding: 4, overflow: "linebreak", textColor: [36, 51, 77] },
      headStyles: { fillColor: [53, 109, 243], textColor: 255, fontSize: 8 },
      alternateRowStyles: { fillColor: [247, 249, 252] },
      margin: { left: margin, right: margin, bottom: 40 }
    };

    if (def.single) {
      const row = rows[0] || {};

      doc.autoTable({
        ...common,
        head: [["Field", "Value"]],
        body: columns.map((column) => [
          pdfSafe(column.label),
          pdfSafe(formatCell(column.get(row, ctx), column.type, "pdf"))
        ]),
        columnStyles: { 0: { cellWidth: 170, fontStyle: "bold" } }
      });
    } else {
      const columnStyles = {};

      columns.forEach((column, index) => {
        if (column.type === "money" || column.type === "number") {
          columnStyles[index] = { halign: "right" };
        }
      });

      doc.autoTable({
        ...common,
        head: [columns.map((column) => pdfSafe(column.label))],
        body: rows.length
          ? rows.map((row) =>
              columns.map((column) =>
                pdfSafe(formatCell(column.get(row, ctx), column.type, "pdf"))
              )
            )
          : [[{
              content: "No records match the selected filters.",
              colSpan: Math.max(columns.length, 1),
              styles: { halign: "center", textColor: [132, 144, 164] }
            }]],
        columnStyles
      });
    }

    y = doc.lastAutoTable.finalY + 28;
  }

  const totalPages = doc.getNumberOfPages();

  for (let page = 1; page <= totalPages; page += 1) {
    doc.setPage(page);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(152, 162, 179);
    doc.text(
      `SellersPro Admin - Confidential seller data - Page ${page} of ${totalPages}`,
      margin,
      pageHeight - 18
    );
  }

  return doc;
}

/* ---------------------------------------------
   Download
--------------------------------------------- */

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function baseFileName(ctx) {
  const slug = String(getBusinessName(ctx.profile) || getSellerName(ctx.profile))
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30) || "seller";

  const date = isoLocal(new Date()).slice(0, 10).replace(/-/g, "");

  return `sellerspro-${slug}-${ctx.uid.slice(0, 6)}-${date}`;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** format: "csv" | "pdf" | "json". Returns { fileName, warnings[] } */
export async function downloadExport(format, model, ctx) {
  const base = baseFileName(ctx);
  const warnings = [];

  if (format === "json") {
    const blob = new Blob([JSON.stringify(buildJson(model, ctx), null, 2)], {
      type: "application/json"
    });

    triggerDownload(blob, `${base}.json`);
    return { fileName: `${base}.json`, warnings };
  }

  if (format === "pdf") {
    const doc = buildPdf(model, ctx);
    doc.save(`${base}.pdf`);

    if (pdfReplacedChars > 0) {
      warnings.push(
        `${pdfReplacedChars} character(s), such as Bangla text, cannot be shown in PDF and were replaced with "?". Use CSV or JSON to keep them.`
      );
    }

    return { fileName: `${base}.pdf`, warnings };
  }

  // CSV: one file per section, zipped when there is more than one
  const files = model.sections.map((section) => ({
    name: `${base}-${section.def.fileLabel}.csv`,
    // UTF-8 BOM so Excel shows Bangla text correctly
    content: "\uFEFF" + buildCsv(section, ctx)
  }));

  if (files.length === 1) {
    triggerDownload(new Blob([files[0].content], { type: "text/csv;charset=utf-8" }), files[0].name);
    return { fileName: files[0].name, warnings };
  }

  if (typeof window !== "undefined" && window.JSZip) {
    const zip = new window.JSZip();
    files.forEach((file) => zip.file(file.name, file.content));

    const blob = await zip.generateAsync({ type: "blob" });
    triggerDownload(blob, `${base}-csv.zip`);

    return { fileName: `${base}-csv.zip`, warnings };
  }

  // Fallback when the ZIP library is unavailable: separate downloads
  for (const file of files) {
    triggerDownload(new Blob([file.content], { type: "text/csv;charset=utf-8" }), file.name);
    await wait(350);
  }

  warnings.push("ZIP library did not load, so each CSV was downloaded separately. Allow multiple downloads if your browser asks.");
  return { fileName: `${files.length} CSV files`, warnings };
}