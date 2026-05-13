import { STATUSES } from "./constants.js";

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");
}

export function statusClass(status) {
  if (status === "Assessment / interview") return "status-amber";
  if (status === "Reply needed") return "status-blue";
  if (status === "Reply recruiter") return "status-slate";
  if (status === "Rejected") return "status-red";
  if (status === "Applied / waiting") return "status-green";
  return "";
}

export function optionList(value) {
  return STATUSES.map((status) => (
    `<option value="${escapeHtml(status)}"${status === value ? " selected" : ""}>${escapeHtml(status)}</option>`
  )).join("");
}

export function matchesFilter(item, filter = {}, view = "apps") {
  const needle = String(filter.needle || "").trim().toLowerCase();
  const status = view === "needs" ? item.highPriorityStatus : item.status;
  if (filter.status && status !== filter.status) return false;
  const dateValue = Date.parse(filterDateValue(item) || "");
  if (filter.dateFrom) {
    const from = Date.parse(filter.dateFrom);
    if (!Number.isNaN(from) && (Number.isNaN(dateValue) || dateValue < from)) return false;
  }
  if (filter.dateTo) {
    const to = Date.parse(filter.dateTo);
    if (!Number.isNaN(to) && (Number.isNaN(dateValue) || dateValue > to)) return false;
  }
  if (!needle) return true;
  return Object.values(item).some((value) => String(value ?? "").toLowerCase().includes(needle));
}

function filterDateValue(item) {
  return item.latestDate || item.appliedDate || item.dueDate || item.deletedAt;
}

function sortDateValue(item, view) {
  const value = view === "needs"
    ? item.dueDate || item.highPriorityDate || item.latestDate
    : item.latestDate || item.appliedDate || item.deletedAt;
  const time = Date.parse(value || "");
  return Number.isNaN(time) ? 0 : time;
}

function statusRank(status) {
  const ranks = {
    "Assessment / interview": 0,
    "Reply needed": 1,
    "Reply recruiter": 2,
    "Applied / waiting": 3,
    "Rejected": 4
  };
  return ranks[status] ?? 4;
}

export function sortRows(rows, sortMode = "date-desc", view = "apps") {
  const sorted = [...rows];
  sorted.sort((a, b) => {
    if (sortMode === "company-asc" || sortMode === "company-desc") {
      const result = String(a.company || "").localeCompare(String(b.company || ""), undefined, { sensitivity: "base" });
      return sortMode === "company-desc" ? -result : result;
    }
    if (sortMode === "date-desc" || sortMode === "date-asc") {
      const result = sortDateValue(a, view) - sortDateValue(b, view);
      return sortMode === "date-desc" ? -result : result;
    }
    if (sortMode === "status") {
      return statusRank(a.status) - statusRank(b.status)
        || String(a.company || "").localeCompare(String(b.company || ""), undefined, { sensitivity: "base" });
    }
    return 0;
  });
  return sorted;
}

export function sourceLabel(source) {
  if (source === "needs") return "High Priority";
  if (source === "apps") return "Application Tracker";
  return "Tracker";
}

export function displayDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

export function statusBadge(status) {
  return `<span class="statusBadge cellEditTarget ${statusClass(status)}">${escapeHtml(status || "No status")}</span>`;
}

function ageLabel(value) {
  if (!value) return "";
  const text = String(value).trim();
  const localDateMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const date = localDateMatch
    ? new Date(Number(localDateMatch[1]), Number(localDateMatch[2]) - 1, Number(localDateMatch[3]))
    : new Date(text);
  if (Number.isNaN(date.getTime())) return "";
  const today = new Date();
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const days = Math.max(0, Math.floor((startOfToday - startOfDate) / 86400000));
  return `${days}D`;
}

export function ageBadge(value, status) {
  const label = ageLabel(value);
  if (!label) return "";
  return `<span class="statusBadge ageBadge ${statusClass(status)}">${escapeHtml(label)}</span>`;
}

export function editableCell(item, field, options = {}) {
  const value = String(item[field] ?? "");
  const className = [options.className || "", options.status ? "statusCell" : ""].filter(Boolean).join(" ");
  const type = options.type || "text";
  const display = options.status
    ? statusBadge(value)
    : value
      ? `<span class="cellEditTarget">${escapeHtml(value)}</span>`
      : `<span class="emptyText cellEditTarget">Click to add</span>`;
  const age = options.ageStatus ? ageBadge(value, options.ageStatus) : "";
  return `
    <button
      class="cellDisplay ${className}"
      data-edit-id="${escapeHtml(item.id)}"
      data-edit-field="${escapeHtml(field)}"
      data-edit-type="${escapeHtml(type)}"
      type="button"
    >${display}${age}</button>
  `;
}

export function readOnlyCell(value, className = "") {
  return `<span class="readOnlyCell ${className}">${escapeHtml(value || "")}</span>`;
}
