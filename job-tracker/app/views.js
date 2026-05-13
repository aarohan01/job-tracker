import {
  ageBadge,
  displayDateTime,
  editableCell,
  escapeHtml,
  matchesFilter,
  readOnlyCell,
  sourceLabel,
  statusBadge,
  statusClass,
  sortRows
} from "./view-helpers.js";

function filteredRows(rows, context, view) {
  const filter = context.filter || {};
  return sortRows(rows.filter((item) => matchesFilter(item, filter, view)), filter.sort, view);
}

function rowClass(item, context) {
  const status = context.activeTab === "needs" ? item.highPriorityStatus : item.status;
  return `${statusClass(status)} ${context.selectedIds?.has(item.id) ? "selectedRow" : ""}`;
}

export function renderNeeds(context) {
  const rows = filteredRows(context.state.applications.filter((item) => item.isHighPriority), context, "needs");
  context.table.className = "needsTable";
  context.table.innerHTML = `
    <thead>
      <tr>
        <th class="doneColumn">Done</th>
        <th>Company</th>
        <th>Role / Context</th>
        <th>Status</th>
        <th>Action Needed</th>
        <th>Due Date</th>
        <th>Latest Date</th>
        <th>Notes</th>
        <th class="actionColumn">Delete</th>
      </tr>
    </thead>
    <tbody>
      ${rows.map((item) => `
        <tr class="${rowClass(item, context)} ${item.done ? "done" : ""}" data-row-id="${escapeHtml(item.id)}">
          <td class="doneCell"><input type="checkbox" data-id="${item.id}" data-field="done"${item.done ? " checked" : ""}></td>
          <td>${editableCell(item, "company", { type: "textarea", className: "wrapCell strongCell" })}</td>
          <td>${editableCell(item, "role", { type: "textarea", className: "wrapCell" })}</td>
          <td>${editableCell(item, "highPriorityStatus", { type: "select", status: true })}</td>
          <td>${editableCell(item, "actionNeeded", { type: "textarea", className: "wrapCell wideCell" })}</td>
          <td>${editableCell(item, "dueDate", { type: "date", className: "dateCell" })}</td>
          <td>${editableCell(item, "highPriorityDate", { type: "date", className: "dateCell", ageStatus: item.highPriorityStatus })}</td>
          <td>${editableCell(item, "highPriorityNotes", { type: "textarea", className: "wrapCell wideCell" })}</td>
          <td><button class="deleteRow" data-delete="needs" data-id="${item.id}" type="button">Delete</button></td>
        </tr>
      `).join("")}
    </tbody>
  `;
  if (!rows.length) context.table.innerHTML = `<tbody><tr><td class="empty">No matching high-priority rows.</td></tr></tbody>`;
  context.bindEditable(context.table, context.state.applications);
  context.bindCellEditors(context.table, context.state.applications);
  context.bindDelete(context.table);
  context.bindRowSelection(context.table);
}

export function renderApps(context) {
  const rows = filteredRows(context.state.applications.filter((item) => item.recordType !== "recruiter_message"), context, "apps");
  context.table.className = "appsTable";
  context.table.innerHTML = `
    <thead>
      <tr>
        <th>Company</th>
        <th>Role</th>
        <th>Entry Date</th>
        <th>Status</th>
        <th>Latest Date</th>
        <th>Source</th>
        <th>Latest Update</th>
        <th>Notes</th>
        <th class="actionColumn">Delete</th>
      </tr>
    </thead>
    <tbody>
      ${rows.map((item) => `
        <tr class="${rowClass(item, context)}" data-row-id="${escapeHtml(item.id)}">
          <td>${editableCell(item, "company", { type: "textarea", className: "wrapCell strongCell" })}</td>
          <td>${editableCell(item, "role", { type: "textarea", className: "wrapCell" })}</td>
          <td>${editableCell(item, "appliedDate", { type: "date", className: "dateCell" })}</td>
          <td>${editableCell(item, "status", { type: "select", status: true })}</td>
          <td>${editableCell(item, "latestDate", { type: "date", className: "dateCell", ageStatus: item.status })}</td>
          <td>${editableCell(item, "source", { className: "wrapCell" })}</td>
          <td>${editableCell(item, "latestUpdate", { type: "textarea", className: "wrapCell wideCell" })}</td>
          <td>${editableCell(item, "notes", { type: "textarea", className: "wrapCell wideCell" })}</td>
          <td><button class="deleteRow" data-delete="apps" data-id="${item.id}" type="button">Delete</button></td>
        </tr>
      `).join("")}
    </tbody>
  `;
  if (!rows.length) context.table.innerHTML = `<tbody><tr><td class="empty">No matching tracker rows.</td></tr></tbody>`;
  context.bindCellEditors(context.table, context.state.applications);
  context.bindDelete(context.table);
  context.bindRowSelection(context.table);
}

export function renderTrash(context) {
  const rows = filteredRows(context.state.trash, context, "trash");
  context.table.className = "trashTable";
  context.table.innerHTML = `
    <thead>
      <tr>
        <th class="actionColumn">Restore</th>
        <th class="actionColumn">Delete</th>
        <th>Deleted</th>
        <th>From</th>
        <th>Company</th>
        <th>Role / Context</th>
        <th>Status</th>
        <th>Latest Date</th>
        <th>Notes</th>
      </tr>
    </thead>
    <tbody>
      ${rows.map((item) => `
        <tr class="${rowClass(item, context)}" data-row-id="${escapeHtml(item.id)}">
          <td><button class="restoreRow" data-restore="${item.id}" type="button">Restore</button></td>
          <td><button class="permanentDeleteRow" data-permanent-delete="${item.id}" type="button">Delete</button></td>
          <td>${readOnlyCell(displayDateTime(item.deletedAt), "dateCell")}</td>
          <td>${readOnlyCell(sourceLabel(item.deletedFrom))}</td>
          <td>${readOnlyCell(item.company, "wrapCell strongCell")}</td>
          <td>${readOnlyCell(item.role, "wrapCell")}</td>
          <td>${statusBadge(item.status)}</td>
          <td><span class="dateWithAge">${readOnlyCell(item.latestDate || item.appliedDate || "", "dateCell")}${ageBadge(item.latestDate || item.appliedDate || "", item.status)}</span></td>
          <td>${readOnlyCell(item.notes || item.latestUpdate || item.actionNeeded || "", "wrapCell wideCell")}</td>
        </tr>
      `).join("")}
    </tbody>
  `;
  if (!rows.length) context.table.innerHTML = `<tbody><tr><td class="empty">Trash is empty.</td></tr></tbody>`;
  context.bindRestore(context.table);
  context.bindPermanentDelete(context.table);
  context.bindRowSelection(context.table);
}
