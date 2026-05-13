import {
  collectionForTarget,
  completeNeed,
  createApplicationRow,
  createNeedsRow,
  ensureStateShape,
  moveToTrash,
  moveToHighPriority,
  normalizeRejectedApplicationsToTrash,
  permanentlyDeleteTrashItem,
  applicationRows,
  rejectedCount,
  requestFullScan,
  restoreTrashItem,
  totalTrackedCount
} from "./tracker-model.js";
import { escapeHtml, matchesFilter, optionList } from "./view-helpers.js";
import { renderApps, renderNeeds, renderTrash } from "./views.js";

const elements = {
  tableShell: document.querySelector(".tableShell"),
  table: document.querySelector("#trackerTable"),
  fullScanBtn: document.querySelector("#fullScanBtn"),
  saveBtn: document.querySelector("#saveBtn"),
  exportBtn: document.querySelector("#exportBtn"),
  addRowBtn: document.querySelector("#addRowBtn"),
  selectVisibleBtn: document.querySelector("#selectVisibleBtn"),
  bulkBar: document.querySelector("#bulkBar"),
  selectedCountLabel: document.querySelector("#selectedCountLabel"),
  moveToBtn: document.querySelector("#moveToBtn"),
  moveToMenu: document.querySelector("#moveToMenu"),
  clearSelectionBtn: document.querySelector("#clearSelectionBtn"),
  clearFiltersBtn: document.querySelector("#clearFiltersBtn"),
  filterCount: document.querySelector("#filterCount"),
  searchInput: document.querySelector("#searchInput"),
  statusFilterBtn: document.querySelector("#statusFilterBtn"),
  statusMenu: document.querySelector("#statusMenu"),
  sortBtn: document.querySelector("#sortBtn"),
  sortMenu: document.querySelector("#sortMenu"),
  dateFilterBtn: document.querySelector("#dateFilterBtn"),
  dateMenu: document.querySelector("#dateMenu"),
  customDatePanel: document.querySelector("#customDatePanel"),
  dateFromFilter: document.querySelector("#dateFromFilter"),
  dateToFilter: document.querySelector("#dateToFilter"),
  applyDateRangeBtn: document.querySelector("#applyDateRangeBtn"),
  clearDateRangeBtn: document.querySelector("#clearDateRangeBtn"),
  saveState: document.querySelector("#saveState"),
  openActions: document.querySelector("#openActions"),
  trackedCount: document.querySelector("#trackedCount"),
  totalCount: document.querySelector("#totalCount"),
  rejectedCount: document.querySelector("#rejectedCount"),
  trashCount: document.querySelector("#trashCount"),
  scanMode: document.querySelector("#scanMode"),
  lastUpdatedAt: document.querySelector("#lastUpdatedAt"),
  tabs: [...document.querySelectorAll(".tab")]
};

const app = {
  state: null,
  activeTab: localStorage.getItem("jobTrackerActiveTab") || "needs",
  saveTimer: null,
  exportTimer: null,
  exporting: false,
  pendingExport: false,
  hasUnsavedChanges: false,
  pollTimer: null
};

const dashboardRefreshMs = 30000;

app.filters = {
  needs: { needle: "", status: "", sort: "date-desc", datePreset: "all", dateFrom: "", dateTo: "" },
  apps: { needle: "", status: "", sort: "date-desc", datePreset: "all", dateFrom: "", dateTo: "" },
  trash: { needle: "", status: "", sort: "date-desc", datePreset: "all", dateFrom: "", dateTo: "" }
};

app.selectedRows = {
  needs: new Set(),
  apps: new Set(),
  trash: new Set()
};

const statusOptions = [
  ["", "Status"],
  ["Assessment / interview", "Assessment / interview"],
  ["Reply needed", "Reply needed"],
  ["Reply recruiter", "Reply recruiter"],
  ["Rejected", "Rejected"],
  ["Applied / waiting", "Applied / waiting"]
];

const sortOptions = [
  ["date-desc", "Newest first (default)"],
  ["date-asc", "Oldest first"],
  ["company-asc", "Company A-Z"],
  ["company-desc", "Company Z-A"],
  ["status", "Status priority"]
];

function pulseScrollEnd(direction) {
  if (!elements.tableShell) return;
  const className = direction === "left" ? "bounceLeft" : "bounceRight";
  elements.tableShell.classList.remove("bounceLeft", "bounceRight");
  window.requestAnimationFrame(() => {
    elements.tableShell.classList.add(className);
    window.setTimeout(() => elements.tableShell.classList.remove(className), 260);
  });
}

function bindScrollBounce() {
  if (!elements.tableShell) return;
  elements.tableShell.addEventListener("wheel", (event) => {
    const shell = elements.tableShell;
    const horizontalDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY) || event.shiftKey
      ? event.deltaX || event.deltaY
      : 0;
    if (!horizontalDelta || shell.scrollWidth <= shell.clientWidth) return;

    const atLeft = shell.scrollLeft <= 0;
    const atRight = Math.ceil(shell.scrollLeft + shell.clientWidth) >= shell.scrollWidth;
    if (horizontalDelta < 0 && atLeft) pulseScrollEnd("left");
    if (horizontalDelta > 0 && atRight) pulseScrollEnd("right");
  }, { passive: true });
}

function showSyncError(error) {
  console.error(error);
  elements.saveState.textContent = "Sync failed";
  elements.exportBtn.textContent = "Retry sync";
  elements.exportBtn.disabled = false;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 120000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

function autoGrowTextarea(textarea) {
  textarea.style.height = "auto";
  textarea.style.height = `${textarea.scrollHeight}px`;
}

function makeEditor(button, row) {
  const type = button.dataset.editType || "text";
  const field = button.dataset.editField;
  const value = row[field] || "";
  let editor;

  if (type === "select") {
    editor = document.createElement("select");
    editor.innerHTML = optionList(value);
  } else if (type === "textarea") {
    editor = document.createElement("textarea");
    editor.value = value;
    editor.rows = 1;
  } else {
    editor = document.createElement("input");
    editor.type = type === "date" ? "date" : "text";
    editor.value = value;
  }

  editor.className = `cellEditor ${button.className.replace("cellDisplay", "").trim()}`;
  editor.dataset.id = button.dataset.editId;
  editor.dataset.field = field;
  return editor;
}

function beginCellEdit(button, collection) {
  const row = collection.find((item) => item.id === button.dataset.editId);
  if (!row || button.dataset.editing === "true") return;

  button.dataset.editing = "true";
  const field = button.dataset.editField;
  const type = button.dataset.editType || "text";
  const originalValue = row[field] || "";
  const editor = makeEditor(button, row);
  let finished = false;

  function finish(shouldSave) {
    if (finished) return;
    finished = true;
    if (shouldSave && row[field] !== editor.value) {
      row[field] = editor.value;
      if (app.activeTab === "apps" && field === "status" && editor.value === "Rejected") {
        moveToTrash(app.state, "apps", row.id);
        app.selectedRows.apps.delete(row.id);
      }
      renderAndSave();
    } else {
      render();
    }
  }

  editor.addEventListener("blur", () => finish(true));
  editor.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      editor.value = originalValue;
      finish(false);
    }
    if (event.key === "Enter" && (type !== "textarea" || !event.shiftKey)) {
      event.preventDefault();
      finish(true);
    }
  });
  if (type === "select" || type === "date") {
    editor.addEventListener("change", () => finish(true));
  }

  button.replaceWith(editor);
  editor.focus();
  if (type === "select" && editor.showPicker) {
    try {
      editor.showPicker();
    } catch {
      // Some browsers only allow opening native selects from direct user gestures.
    }
  }
  if (type === "textarea") autoGrowTextarea(editor);
  if (editor.select && type !== "date" && type !== "select") editor.select();
  if (type === "textarea") {
    editor.addEventListener("input", () => autoGrowTextarea(editor));
  }
}

function bindCellEditors(root, collection) {
  root.querySelectorAll(".cellDisplay .cellEditTarget").forEach((target) => {
    target.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const button = target.closest("[data-edit-field]");
      if (!button) return;
      beginCellEdit(button, collection);
    });
    target.addEventListener("dblclick", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
  });
}

function bindEditable(root, collection) {
  root.querySelectorAll("[data-field]").forEach((input) => {
    input.addEventListener("input", () => {
      const row = collection.find((item) => item.id === input.dataset.id);
      if (!row) return;
      if (app.activeTab === "needs" && input.dataset.field === "done" && input.checked) {
        if (!window.confirm("Mark this high-priority item as done?")) {
          input.checked = false;
          return;
        }
        completeNeed(app.state, row);
        renderAndSave();
        return;
      }

      row[input.dataset.field] = input.type === "checkbox" ? input.checked : input.value;
      renderAndSave();
    });
  });
}

function bindDelete(root) {
  root.querySelectorAll("[data-delete]").forEach((button) => {
    button.addEventListener("click", () => {
      const moved = moveToTrash(app.state, button.dataset.delete, button.dataset.id);
      if (moved) renderAndSave();
    });
  });
}

function bindRestore(root) {
  root.querySelectorAll("[data-restore]").forEach((button) => {
    button.addEventListener("click", () => {
      const restored = restoreTrashItem(app.state, button.dataset.restore);
      if (!restored) return;
      app.activeTab = restored.target;
      renderAndSave();
    });
  });
}

function bindPermanentDelete(root) {
  root.querySelectorAll("[data-permanent-delete]").forEach((button) => {
    button.addEventListener("click", () => {
      if (!confirmPermanentDelete(1)) return;
      const deleted = permanentlyDeleteTrashItem(app.state, button.dataset.permanentDelete);
      if (deleted) renderAndSave();
    });
  });
}

function closeMenus() {
  elements.dateMenu.hidden = true;
  elements.moveToMenu.hidden = true;
  elements.statusMenu.hidden = true;
  elements.sortMenu.hidden = true;
  elements.dateFilterBtn.setAttribute("aria-expanded", "false");
  elements.moveToBtn.setAttribute("aria-expanded", "false");
  elements.statusFilterBtn.setAttribute("aria-expanded", "false");
  elements.sortBtn.setAttribute("aria-expanded", "false");
}

function isSelectionClick(event) {
  return !event.target.closest("input, select, textarea, a, label, .deleteRow, .restoreRow, .permanentDeleteRow, .menuWrap");
}

function bindRowSelection(root) {
  root.querySelectorAll("tbody tr[data-row-id]").forEach((row) => {
    row.addEventListener("click", (event) => {
      if (!isSelectionClick(event)) return;
      const selected = app.selectedRows[app.activeTab];
      const id = row.dataset.rowId;
      if (selected.has(id)) {
        selected.delete(id);
        row.classList.remove("selectedRow");
      } else {
        selected.add(id);
        row.classList.add("selectedRow");
      }
      updateMetrics();
    });
  });
}

function viewContext() {
  return {
    ...elements,
    state: app.state,
    activeTab: app.activeTab,
    filter: app.filters[app.activeTab],
    selectedIds: app.selectedRows[app.activeTab],
    bindEditable,
    bindCellEditors,
    bindDelete,
    bindRestore,
    bindPermanentDelete,
    bindRowSelection
  };
}

function render() {
  if (!["needs", "apps", "trash"].includes(app.activeTab)) app.activeTab = "needs";
  localStorage.setItem("jobTrackerActiveTab", app.activeTab);
  syncToolbarToActiveTab();
  elements.tabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === app.activeTab));
  elements.addRowBtn.hidden = app.activeTab === "trash";
  if (app.activeTab === "needs") renderNeeds(viewContext());
  else if (app.activeTab === "apps") renderApps(viewContext());
  else renderTrash(viewContext());
  updateMetrics();
}

function renderAndSave() {
  render();
  scheduleSave();
}

function updateMetrics() {
  elements.openActions.textContent = app.state.applications.filter((item) => item.isHighPriority).length;
  elements.trackedCount.textContent = applicationRows(app.state).length;
  elements.totalCount.textContent = totalTrackedCount(app.state);
  elements.rejectedCount.textContent = rejectedCount(app.state);
  elements.trashCount.textContent = app.state.trash.length;
  elements.lastUpdatedAt.textContent = formatLastUpdated(app.state.meta.lastUpdatedAt || app.state.meta.lastSuccessfulScanAt || app.state.meta.lastUpdated);

  const fullScanQueued = app.state.meta.nextScanMode === "full";
  elements.scanMode.textContent = fullScanQueued ? "Full queued" : "Incremental";
  elements.fullScanBtn.textContent = fullScanQueued ? "Full scan queued" : "Full scan next run";
  elements.fullScanBtn.disabled = fullScanQueued;
  elements.saveBtn.disabled = false;
  elements.exportBtn.disabled = app.exporting;
  elements.addRowBtn.disabled = false;
  elements.selectVisibleBtn.disabled = false;
  elements.moveToBtn.disabled = false;
  elements.clearSelectionBtn.disabled = false;

  const selectedCount = app.selectedRows[app.activeTab].size;
  const hasSelection = selectedCount > 0;
  elements.bulkBar.hidden = !hasSelection;
  elements.selectedCountLabel.textContent = `${selectedCount} selected`;
  updateFilterStatus();
  renderMoveToMenu();
}

function formatLastUpdated(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function scheduleSave() {
  app.hasUnsavedChanges = true;
  elements.saveState.textContent = "Saving";
  clearTimeout(app.saveTimer);
  clearTimeout(app.exportTimer);
  app.saveTimer = setTimeout(async () => {
    try {
      await saveData();
    } catch (error) {
      showSyncError(error);
    }
  }, 500);
}

async function saveData() {
  ensureStateShape(app.state);
  updateMetrics();
  elements.saveState.textContent = "Saving";
  const response = await fetch("/api/tracker", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(app.state)
  });
  if (!response.ok) {
    if (response.status === 409) {
      elements.saveState.textContent = "Reloaded";
      await load();
      window.alert("Job Tracker changed while you were editing, so I reloaded the latest saved copy instead of overwriting it.");
      return false;
    }
    elements.saveState.textContent = "Error";
    throw new Error(await response.text());
  }
  const result = await response.json();
  app.state.meta.revision = Number(result.revision || app.state.meta.revision || 0);
  app.state.meta.lastUpdatedAt = result.lastUpdatedAt || app.state.meta.lastUpdatedAt;
  app.state.meta.lastUpdated = result.lastUpdated || app.state.meta.lastUpdated;
  app.hasUnsavedChanges = false;
  elements.saveState.textContent = "Saved";
  return true;
}

function confirmPermanentDelete(count) {
  const noun = count === 1 ? "row" : "rows";
  return window.confirm(`Permanently delete ${count} ${noun}? This cannot be restored.`);
}

async function exportExcel(options = {}) {
  if (app.exporting) {
    app.pendingExport = true;
    return;
  }
  app.exporting = true;
  elements.exportBtn.disabled = true;
  elements.exportBtn.textContent = "Syncing";
  elements.saveState.textContent = "Syncing Excel";

  try {
    if (!options.skipSave && !(await saveData())) return;
    const response = await fetchWithTimeout("/api/export-xlsx", { method: "POST" });
    if (!response.ok) throw new Error(await response.text());
    elements.saveState.textContent = "Excel synced";
    elements.exportBtn.textContent = "Synced";
    setTimeout(() => { elements.exportBtn.textContent = "Sync Excel now"; }, 1600);
  } catch (error) {
    showSyncError(error);
  } finally {
    app.exporting = false;
    elements.exportBtn.disabled = false;
    if (app.pendingExport) {
      app.pendingExport = false;
      setTimeout(() => exportExcel({ skipSave: true }), 900);
    }
  }
}

function queueFullScan() {
  requestFullScan(app.state);
  updateMetrics();
  scheduleSave();
}

function defaultFilter() {
  return { needle: "", status: "", sort: "date-desc", datePreset: "all", dateFrom: "", dateTo: "" };
}

function hasActiveFilters() {
  const filter = app.filters[app.activeTab];
  const baseline = defaultFilter();
  return Object.keys(baseline).some((key) => filter[key] !== baseline[key]);
}

function currentTabRows() {
  if (!app.state) return [];
  if (app.activeTab === "needs") return app.state.applications.filter((item) => item.isHighPriority);
  if (app.activeTab === "apps") return applicationRows(app.state);
  if (app.activeTab === "trash") return app.state.trash;
  return [];
}

function updateFilterStatus() {
  const active = hasActiveFilters();
  const rows = currentTabRows();
  const visibleCount = rows.filter((item) => matchesFilter(item, app.filters[app.activeTab], app.activeTab)).length;
  elements.clearFiltersBtn.hidden = !active;
  elements.clearFiltersBtn.classList.toggle("clearActive", active);
  elements.filterCount.textContent = visibleCount === rows.length
    ? `${visibleCount} shown`
    : `${visibleCount} of ${rows.length} shown`;
}

function localDateInput(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function datePresetRange(preset) {
  const today = new Date();
  if (preset === "today") return { dateFrom: localDateInput(today), dateTo: localDateInput(today) };
  if (preset === "7" || preset === "30") {
    const days = Number(preset);
    const from = new Date(today);
    from.setDate(today.getDate() - days + 1);
    return { dateFrom: localDateInput(from), dateTo: localDateInput(today) };
  }
  return { dateFrom: "", dateTo: "" };
}

function syncToolbarToActiveTab() {
  const filter = app.filters[app.activeTab];
  if (elements.searchInput.value !== filter.needle) elements.searchInput.value = filter.needle;
  const statusLabel = statusOptions.find(([value]) => value === filter.status)?.[1] || "Status";
  const sortLabel = sortOptions.find(([value]) => value === filter.sort)?.[1] || "Newest first (default)";
  elements.statusFilterBtn.textContent = statusLabel;
  elements.sortBtn.textContent = sortLabel;
  if (elements.dateFromFilter.value !== filter.dateFrom) elements.dateFromFilter.value = filter.dateFrom;
  if (elements.dateToFilter.value !== filter.dateTo) elements.dateToFilter.value = filter.dateTo;
  elements.customDatePanel.hidden = filter.datePreset !== "custom";
  elements.dateFilterBtn.classList.toggle("activeFilter", filter.datePreset !== "all");
  elements.statusFilterBtn.classList.toggle("activeFilter", Boolean(filter.status));
  elements.sortBtn.classList.toggle("activeFilter", filter.sort !== defaultFilter().sort);
}

function updateActiveFilter(field, value) {
  app.filters[app.activeTab][field] = value;
  render();
}

function clearActiveFilters() {
  app.filters[app.activeTab] = defaultFilter();
  closeMenus();
  render();
}

function applyDatePreset(preset) {
  const filter = app.filters[app.activeTab];
  filter.datePreset = preset;
  if (preset === "custom") {
    elements.customDatePanel.hidden = false;
    return render();
  }
  Object.assign(filter, datePresetRange(preset));
  closeMenus();
  render();
}

function applyCustomDateRange() {
  const filter = app.filters[app.activeTab];
  filter.datePreset = "custom";
  filter.dateFrom = elements.dateFromFilter.value;
  filter.dateTo = elements.dateToFilter.value;
  closeMenus();
  render();
}

function clearDateRange() {
  Object.assign(app.filters[app.activeTab], { datePreset: "all", dateFrom: "", dateTo: "" });
  closeMenus();
  render();
}

function moveSelectedToTrash() {
  const selected = app.selectedRows[app.activeTab];
  if (!selected.size) return;

  if (app.activeTab === "trash") {
    for (const id of selected) permanentlyDeleteTrashItem(app.state, id);
  } else {
    for (const id of selected) moveToTrash(app.state, app.activeTab, id);
  }
  selected.clear();
  closeMenus();
  renderAndSave();
}

function moveSelectedToHighPriority() {
  if (app.activeTab === "needs") return;
  const selected = app.selectedRows[app.activeTab];
  if (!selected.size) return;
  for (const id of selected) moveToHighPriority(app.state, app.activeTab, id);
  selected.clear();
  app.activeTab = "needs";
  closeMenus();
  renderAndSave();
}

function restoreSelectedRows() {
  const selected = app.selectedRows.trash;
  if (!selected.size) return;
  for (const id of selected) restoreTrashItem(app.state, id);
  selected.clear();
  closeMenus();
  renderAndSave();
}

function permanentDeleteSelectedRows() {
  const selected = app.selectedRows.trash;
  if (!selected.size) return;
  if (!confirmPermanentDelete(selected.size)) return;
  for (const id of selected) permanentlyDeleteTrashItem(app.state, id);
  selected.clear();
  closeMenus();
  renderAndSave();
}

function renderMoveToMenu() {
  const options = [];
  if (app.activeTab === "apps") {
    options.push(["High Priority", moveSelectedToHighPriority], ["Trash", moveSelectedToTrash]);
  } else if (app.activeTab === "needs") {
    options.push(["Trash", moveSelectedToTrash]);
  } else {
    options.push(["Restore", restoreSelectedRows], ["Permanent delete", permanentDeleteSelectedRows]);
  }

  elements.moveToMenu.innerHTML = "";
  for (const [label, handler] of options) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", handler);
    elements.moveToMenu.append(button);
  }
}

function renderChoiceMenu(menu, options, onChoose) {
  menu.innerHTML = "";
  for (const [value, label] of options) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", () => onChoose(value));
    menu.append(button);
  }
}

function selectVisibleRows() {
  const selected = app.selectedRows[app.activeTab];
  elements.table.querySelectorAll("tbody tr[data-row-id]").forEach((row) => selected.add(row.dataset.rowId));
  closeMenus();
  render();
}

function deselectRows() {
  app.selectedRows[app.activeTab].clear();
  closeMenus();
  render();
}

function addRow() {
  const row = app.activeTab === "needs"
    ? createNeedsRow()
    : app.activeTab === "apps"
      ? createApplicationRow()
      : null;
  if (!row) return;
  app.state.applications.unshift(row);
  renderAndSave();
}

async function load(options = {}) {
  const response = await fetch("/api/tracker");
  const rawState = await response.json();
  const hadLegacyHighPriority = Array.isArray(rawState.needsAttention) && rawState.needsAttention.length > 0;
  app.state = ensureStateShape(rawState);
  const movedRejected = normalizeRejectedApplicationsToTrash(app.state);
  app.hasUnsavedChanges = false;
  elements.saveState.textContent = options.fromAutoRefresh ? "Updated" : "Saved";
  render();
  if (options.fromAutoRefresh) {
    setTimeout(() => {
      if (!app.hasUnsavedChanges && elements.saveState.textContent === "Updated") {
        elements.saveState.textContent = "Saved";
      }
    }, 1800);
  }
  if (movedRejected.length || hadLegacyHighPriority) scheduleSave();
}

function hasActiveEditor() {
  const active = document.activeElement;
  return Boolean(active?.closest?.("input, select, textarea"));
}

async function refreshIfChanged() {
  if (!app.state || app.hasUnsavedChanges || document.hidden || hasActiveEditor()) return;
  try {
    const response = await fetch("/api/tracker");
    if (!response.ok) throw new Error(await response.text());
    const rawState = await response.json();
    const currentRevision = Number(app.state.meta?.revision || 0);
    const incomingRevision = Number(rawState.meta?.revision || 0);
    if (incomingRevision > currentRevision) {
      app.state = ensureStateShape(rawState);
      elements.saveState.textContent = "Updated";
      render();
      setTimeout(() => {
        if (!app.hasUnsavedChanges && elements.saveState.textContent === "Updated") {
          elements.saveState.textContent = "Saved";
        }
      }, 1800);
    }
  } catch (error) {
    console.warn("Auto-refresh failed", error);
  }
}

function startAutoRefresh() {
  clearInterval(app.pollTimer);
  app.pollTimer = setInterval(refreshIfChanged, dashboardRefreshMs);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refreshIfChanged();
  });
}

elements.tabs.forEach((tab) => tab.addEventListener("click", () => {
  app.activeTab = tab.dataset.tab;
  localStorage.setItem("jobTrackerActiveTab", app.activeTab);
  render();
}));
elements.searchInput.addEventListener("input", () => updateActiveFilter("needle", elements.searchInput.value));
renderChoiceMenu(elements.statusMenu, statusOptions, (value) => {
  updateActiveFilter("status", value);
  closeMenus();
});
renderChoiceMenu(elements.sortMenu, sortOptions, (value) => {
  updateActiveFilter("sort", value);
  closeMenus();
});
elements.statusFilterBtn.addEventListener("click", (event) => {
  event.stopPropagation();
  const willOpen = elements.statusMenu.hidden;
  closeMenus();
  elements.statusMenu.hidden = !willOpen;
  elements.statusFilterBtn.setAttribute("aria-expanded", String(willOpen));
});
elements.sortBtn.addEventListener("click", (event) => {
  event.stopPropagation();
  const willOpen = elements.sortMenu.hidden;
  closeMenus();
  elements.sortMenu.hidden = !willOpen;
  elements.sortBtn.setAttribute("aria-expanded", String(willOpen));
});
elements.dateFilterBtn.addEventListener("click", (event) => {
  event.stopPropagation();
  const willOpen = elements.dateMenu.hidden;
  closeMenus();
  elements.dateMenu.hidden = !willOpen;
  elements.dateFilterBtn.setAttribute("aria-expanded", String(willOpen));
});
elements.dateMenu.querySelectorAll("[data-date-preset]").forEach((button) => {
  button.addEventListener("click", () => applyDatePreset(button.dataset.datePreset));
});
elements.applyDateRangeBtn.addEventListener("click", applyCustomDateRange);
elements.clearDateRangeBtn.addEventListener("click", clearDateRange);
elements.clearFiltersBtn.addEventListener("click", clearActiveFilters);
elements.moveToBtn.addEventListener("click", (event) => {
  event.stopPropagation();
  const willOpen = elements.moveToMenu.hidden;
  closeMenus();
  elements.moveToMenu.hidden = !willOpen;
  elements.moveToBtn.setAttribute("aria-expanded", String(willOpen));
});
document.addEventListener("click", (event) => {
  if (!event.target.closest(".menuWrap")) closeMenus();
});
elements.fullScanBtn.addEventListener("click", queueFullScan);
elements.saveBtn.addEventListener("click", saveData);
elements.exportBtn.addEventListener("click", exportExcel);
elements.addRowBtn.addEventListener("click", addRow);
elements.selectVisibleBtn.addEventListener("click", selectVisibleRows);
elements.clearSelectionBtn.addEventListener("click", deselectRows);
bindScrollBounce();
startAutoRefresh();

load().catch((error) => {
  elements.saveState.textContent = "Error";
  elements.table.innerHTML = `<tbody><tr><td class="empty">${escapeHtml(error.message)}</td></tr></tbody>`;
});
