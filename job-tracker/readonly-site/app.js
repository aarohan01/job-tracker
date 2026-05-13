const state = {
  data: null,
  view: "priority",
  search: "",
  status: ""
};

const elements = {
  lastUpdated: document.querySelector("#lastUpdated"),
  totalCount: document.querySelector("#totalCount"),
  priorityCount: document.querySelector("#priorityCount"),
  trackingCount: document.querySelector("#trackingCount"),
  trashCount: document.querySelector("#trashCount"),
  rejectedCount: document.querySelector("#rejectedCount"),
  searchInput: document.querySelector("#searchInput"),
  statusFilter: document.querySelector("#statusFilter"),
  tabs: [...document.querySelectorAll(".tab")],
  viewTitle: document.querySelector("#viewTitle"),
  shownCount: document.querySelector("#shownCount"),
  cards: document.querySelector("#cards")
};

const statusClasses = new Map([
  ["Assessment / interview", "status-amber"],
  ["Reply needed", "status-blue"],
  ["Reply recruiter", "status-slate"],
  ["Rejected", "status-red"],
  ["Applied / waiting", "status-green"]
]);

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function applications() {
  return state.data.applications.filter((item) => item.recordType !== "recruiter_message");
}

function priorityRows() {
  return state.data.applications.filter((item) => item.isHighPriority);
}

function rejectedCount() {
  return state.data.trash.filter((item) => item.status === "Rejected" && item.recordType !== "recruiter_message").length
    + applications().filter((item) => item.status === "Rejected").length;
}

function totalCount() {
  return applications().length + state.data.trash.filter((item) => item.recordType !== "recruiter_message").length;
}

function rowStatus(item) {
  return state.view === "priority" ? item.highPriorityStatus || item.status : item.status;
}

function rowsForView() {
  if (state.view === "priority") return priorityRows();
  if (state.view === "trash") return state.data.trash;
  return applications();
}

function searchableText(item) {
  return [
    item.company,
    item.role,
    item.status,
    item.highPriorityStatus,
    item.actionNeeded,
    item.latestUpdate,
    item.notes,
    item.highPriorityNotes,
    item.source
  ].join(" ").toLowerCase();
}

function filteredRows() {
  const needle = state.search.trim().toLowerCase();
  return rowsForView()
    .filter((item) => !state.status || rowStatus(item) === state.status)
    .filter((item) => !needle || searchableText(item).includes(needle))
    .sort((a, b) => String(b.latestDate || b.highPriorityDate || b.appliedDate || "").localeCompare(String(a.latestDate || a.highPriorityDate || a.appliedDate || "")));
}

function detail(label, value) {
  if (!value) return "";
  return `<div class="detail"><span class="label">${escapeHtml(label)}</span><div class="value">${escapeHtml(value)}</div></div>`;
}

function renderCard(item) {
  const status = rowStatus(item) || "Applied / waiting";
  const statusClass = statusClasses.get(status) || "status-slate";
  const latestDate = state.view === "priority" ? item.highPriorityDate || item.latestDate : item.latestDate || item.appliedDate;
  const notes = state.view === "priority"
    ? item.actionNeeded || item.highPriorityNotes || item.notes
    : item.latestUpdate || item.notes || item.actionNeeded;
  return `
    <article class="card">
      <div class="cardTop">
        <div>
          <div class="company">${escapeHtml(item.company || "Unknown company")}</div>
          <div class="role">${escapeHtml(item.role || "Role not listed")}</div>
        </div>
        <span class="badge ${statusClass}">${escapeHtml(status)}</span>
      </div>
      <div class="details">
        ${detail(state.view === "priority" ? "Priority date" : "Latest date", formatDate(latestDate))}
        ${detail("Entry date", formatDate(item.appliedDate))}
        ${detail("Source", item.source)}
        ${detail("Due", formatDate(item.dueDate))}
        ${state.view === "trash" ? detail("Deleted", formatDateTime(item.deletedAt)) : ""}
      </div>
      ${notes ? `<div class="notes">${escapeHtml(notes)}</div>` : ""}
    </article>
  `;
}

function renderStatusOptions() {
  const statuses = [...new Set(rowsForView().map(rowStatus).filter(Boolean))].sort();
  elements.statusFilter.innerHTML = `<option value="">All statuses</option>${statuses.map((status) => `
    <option value="${escapeHtml(status)}"${state.status === status ? " selected" : ""}>${escapeHtml(status)}</option>
  `).join("")}`;
}

function render() {
  elements.lastUpdated.textContent = formatDateTime(state.data.meta.lastUpdatedAt || state.data.meta.lastSuccessfulScanAt || state.data.meta.lastUpdated);
  elements.totalCount.textContent = totalCount();
  elements.priorityCount.textContent = priorityRows().length;
  elements.trackingCount.textContent = applications().length;
  elements.trashCount.textContent = state.data.trash.length;
  elements.rejectedCount.textContent = rejectedCount();

  elements.tabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.view === state.view));
  elements.viewTitle.textContent = state.view === "priority" ? "High Priority" : state.view === "trash" ? "Trash" : "Applications";
  renderStatusOptions();

  const rows = filteredRows();
  elements.shownCount.textContent = `${rows.length} shown`;
  elements.cards.innerHTML = rows.length
    ? rows.map(renderCard).join("")
    : `<div class="empty">No matching rows.</div>`;
}

async function load() {
  const response = await fetch("./data/job-tracker.json", { cache: "no-store" });
  if (!response.ok) throw new Error(`Could not load tracker snapshot (${response.status}).`);
  state.data = await response.json();
  render();
}

elements.searchInput.addEventListener("input", () => {
  state.search = elements.searchInput.value;
  render();
});

elements.statusFilter.addEventListener("change", () => {
  state.status = elements.statusFilter.value;
  render();
});

elements.tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    state.view = tab.dataset.view;
    state.status = "";
    render();
  });
});

load().catch((error) => {
  elements.cards.innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
});
