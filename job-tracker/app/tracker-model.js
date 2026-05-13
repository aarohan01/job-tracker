import { DEFAULT_SCAN_OVERLAP_DAYS, DEFAULT_SCAN_WINDOW_START } from "./constants.js";

export function uid(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function isoDate(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export function appendNote(existing, addition) {
  const base = String(existing || "").trim();
  return base ? `${base} ${addition}` : addition;
}

export function ensureIds(collection, prefix, makeId = uid) {
  collection.forEach((item) => {
    if (!item.id) item.id = makeId(prefix);
  });
}

function sameRole(a, b) {
  return String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
}

function textIncludes(value, pattern) {
  return String(value || "").toLowerCase().includes(pattern);
}

function inferRecordType(item) {
  const recruiterSignals = [
    textIncludes(item.role, "recruiter"),
    textIncludes(item.role, "networking message"),
    textIncludes(item.role, "professional message"),
    textIncludes(item.role, "outreach"),
    textIncludes(item.company, "linkedin /"),
    textIncludes(item.latestUpdate, "reply if"),
    textIncludes(item.actionNeeded, "reply if")
  ];
  if (item.recordType === "recruiter_message") return "recruiter_message";
  if (item.recordType === "application") return "application";
  if (recruiterSignals.some(Boolean)) return "recruiter_message";
  return "application";
}

function highPriorityFieldsFromNeed(need) {
  return {
    isHighPriority: true,
    done: Boolean(need.done),
    actionNeeded: need.actionNeeded || need.latestUpdate || "Review and decide next action.",
    dueDate: need.dueDate || "",
    highPriorityDate: need.latestDate || need.appliedDate || isoDate(),
    highPriorityNotes: need.notes || "",
    highPriorityStatus: need.status || "Reply needed"
  };
}

export function highPriorityApplications(state) {
  return state.applications.filter((item) => item.isHighPriority);
}

function applyHighPriorityFields(app, need) {
  Object.assign(app, highPriorityFieldsFromNeed(need));
  if (need.latestDate && !app.latestDate) app.latestDate = need.latestDate;
  if (need.notes && !app.notes) app.notes = need.notes;
  if (need.emailIds?.length) {
    app.emailIds = [...new Set([...(app.emailIds || []), ...need.emailIds])];
  }
}

function findMatchingApplicationForItem(state, item) {
  return state.applications.find((app) => hasEmailOverlap(app.emailIds, item.emailIds))
    || state.applications.find((app) => sameCompany(app.company, item.company) && sameRole(app.role, item.role))
    || state.applications.find((app) => sameCompany(app.company, item.company));
}

function migrateHighPriorityRows(state, makeId = uid) {
  const migrated = [];
  const legacyCount = state.needsAttention.length;
  for (const need of state.needsAttention) {
    const app = findMatchingApplicationForItem(state, need);
    if (app) {
      applyHighPriorityFields(app, need);
      continue;
    }

    migrated.push({
      id: makeId("app"),
      company: need.company || "",
      role: need.role || "",
      appliedDate: need.latestDate || isoDate(),
      status: need.status || "Reply needed",
      recordType: inferRecordType(need),
      latestDate: need.latestDate || isoDate(),
      source: "High Priority",
      latestUpdate: need.actionNeeded || "",
      notes: need.notes || "",
      emailIds: need.emailIds || [],
      threadIds: need.threadIds || [],
      ...highPriorityFieldsFromNeed(need)
    });
  }
  if (migrated.length) state.applications.unshift(...migrated);
  if (legacyCount) {
    console.warn(`Migrated ${legacyCount} legacy needsAttention row(s): ${migrated.length} new application row(s), ${legacyCount - migrated.length} merged into existing row(s).`);
  }
  state.needsAttention = [];
}

export function ensureStateShape(state, makeId = uid) {
  state.meta = state.meta || {};
  state.needsAttention = Array.isArray(state.needsAttention) ? state.needsAttention : [];
  state.applications = Array.isArray(state.applications) ? state.applications : [];
  state.trash = Array.isArray(state.trash) ? state.trash : [];
  state.permanentlyDeletedItems = Array.isArray(state.permanentlyDeletedItems) ? state.permanentlyDeletedItems : [];
  state.completedActions = Array.isArray(state.completedActions) ? state.completedActions : [];
  state.processedEmailIds = Array.isArray(state.processedEmailIds) ? state.processedEmailIds : [];
  state.meta.revision = Number(state.meta.revision || 0);
  state.meta.scanWindowStart = state.meta.scanWindowStart || DEFAULT_SCAN_WINDOW_START;
  state.meta.incrementalScanOverlapDays = Number(state.meta.incrementalScanOverlapDays || DEFAULT_SCAN_OVERLAP_DAYS);
  if (!["full", "incremental"].includes(state.meta.nextScanMode)) {
    state.meta.nextScanMode = "incremental";
  }
  ensureIds(state.needsAttention, "attn", makeId);
  ensureIds(state.applications, "app", makeId);
  ensureIds(state.trash, "trash", makeId);
  migrateHighPriorityRows(state, makeId);
  state.applications.forEach((item) => {
    item.recordType = inferRecordType(item);
  });
  state.trash.forEach((item) => {
    item.recordType = inferRecordType(item);
  });
  state.permanentlyDeletedItems.forEach((item) => {
    item.recordType = inferRecordType(item);
  });
  return state;
}

export function applicationRows(state) {
  return state.applications.filter((item) => item.recordType !== "recruiter_message");
}

export function collectionForTarget(state, target) {
  if (target === "needs") return highPriorityApplications(state);
  if (target === "apps") return applicationRows(state);
  if (target === "trash") return state.trash;
  return [];
}

export function sameCompany(a, b) {
  return String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
}

export function hasEmailOverlap(a = [], b = []) {
  const set = new Set(a);
  return b.some((id) => set.has(id));
}

export function findMatchingApplication(state, need) {
  return findMatchingApplicationForItem(state, need);
}

export function completeNeed(state, needOrId, options = {}) {
  const makeId = options.makeId || uid;
  const completedDate = isoDate(options.now || new Date());
  const need = typeof needOrId === "string"
    ? state.applications.find((item) => item.id === needOrId && item.isHighPriority)
      || state.needsAttention.find((item) => item.id === needOrId)
    : needOrId;
  if (!need) return null;

  const completionNote = `Completed from High Priority on ${completedDate}.`;
  const isApplicationRow = state.applications.some((item) => item.id === need.id);
  const app = findMatchingApplication(state, need) || (isApplicationRow ? need : {
    id: makeId("app"),
    company: need.company,
    role: need.role,
    appliedDate: need.latestDate || completedDate,
    status: need.status || "Applied / waiting",
    latestDate: need.latestDate || completedDate,
    source: "High Priority",
    latestUpdate: "",
    notes: "",
    emailIds: need.emailIds || [],
    recordType: inferRecordType(need)
  });
  if (!isApplicationRow && !state.applications.some((item) => item.id === app.id)) {
    state.applications.unshift(app);
  }

  const previousStatus = need.highPriorityStatus || need.status;
  const actionNeeded = need.actionNeeded;
  const latestDate = need.highPriorityDate || need.latestDate;
  const notes = need.highPriorityNotes || need.notes;

  app.status = "Applied / waiting";
  app.latestDate = need.highPriorityDate || need.latestDate || app.latestDate || completedDate;
  app.latestUpdate = "Action completed; waiting for next update.";
  app.notes = appendNote(app.notes, completionNote);
  app.isHighPriority = false;
  app.done = false;
  app.actionNeeded = "";
  app.dueDate = "";
  app.highPriorityDate = "";
  app.highPriorityNotes = "";
  app.highPriorityStatus = "";

  state.completedActions = state.completedActions || [];
  state.completedActions.unshift({
    id: makeId("done"),
    company: need.company,
    role: need.role,
    completedDate,
    previousStatus,
    actionNeeded,
    latestDate,
    notes: appendNote(notes, completionNote),
    emailIds: need.emailIds || []
  });

  state.needsAttention = state.needsAttention.filter((item) => item.id !== need.id);
  return app;
}

export function moveToTrash(state, target, id, options = {}) {
  const row = target === "needs"
    ? state.applications.find((item) => item.id === id && item.isHighPriority)
    : collectionForTarget(state, target).find((item) => item.id === id);
  if (!row || !["needs", "apps"].includes(target)) return null;

  state.applications = state.applications.filter((item) => item.id !== id);

  const makeId = options.makeId || uid;
  const deletedAt = (options.now || new Date()).toISOString();
  const trashItem = JSON.parse(JSON.stringify(row));
  trashItem.id = makeId("trash");
  trashItem.originalId = row.id;
  trashItem.deletedFrom = "apps";
  trashItem.deletedAt = deletedAt;
  if (trashItem.highPriorityStatus) {
    trashItem.status = trashItem.highPriorityStatus;
  }
  trashItem.recordType = inferRecordType(trashItem);
  state.trash.unshift(trashItem);
  return trashItem;
}

export function moveToHighPriority(state, target, id, options = {}) {
  if (target === "needs") return null;
  const collection = collectionForTarget(state, target);
  const row = collection.find((item) => item.id === id);
  if (!row || !["apps", "trash"].includes(target)) return null;

  if (target === "trash") {
    const restored = restoreTrashItem(state, id, options);
    if (!restored) return null;
    applyHighPriorityFields(restored.restored, row);
    return restored.restored;
  }

  applyHighPriorityFields(row, {
    ...row,
    status: row.status === "Applied / waiting" ? "Reply needed" : row.status,
    actionNeeded: row.actionNeeded || row.latestUpdate || "Review and decide next action.",
    latestDate: row.latestDate || row.appliedDate || isoDate()
  });
  return row;
}

export function normalizeRejectedApplicationsToTrash(state, options = {}) {
  const rejectedIds = state.applications
    .filter((item) => item.status === "Rejected")
    .map((item) => item.id);

  const moved = [];
  for (const id of rejectedIds) {
    const trashItem = moveToTrash(state, "apps", id, options);
    if (trashItem) moved.push(trashItem);
  }
  return moved;
}

export function restoreTrashItem(state, id, options = {}) {
  const item = state.trash.find((row) => row.id === id);
  if (!item) return null;

  const restored = JSON.parse(JSON.stringify(item));
  const restoreAsHighPriority = item.deletedFrom === "needs" || item.isHighPriority;
  const originalId = restored.originalId;
  delete restored.originalId;
  delete restored.deletedFrom;
  delete restored.deletedAt;
  restored.id = originalId || (options.makeId || uid)("app");
  if (restoreAsHighPriority) {
    restored.isHighPriority = true;
    restored.highPriorityStatus = restored.highPriorityStatus || restored.status || "Reply needed";
    restored.highPriorityDate = restored.highPriorityDate || restored.latestDate || restored.appliedDate || isoDate();
    restored.highPriorityNotes = restored.highPriorityNotes || restored.notes || "";
    restored.actionNeeded = restored.actionNeeded || restored.latestUpdate || "Review and decide next action.";
  }

  if (state.applications.some((row) => row.id === restored.id)) {
    restored.id = (options.makeId || uid)("app");
  }

  state.applications.unshift(restored);
  state.trash = state.trash.filter((row) => row.id !== id);
  return { target: restored.isHighPriority ? "needs" : "apps", restored };
}

export function permanentlyDeleteTrashItem(state, id, options = {}) {
  const item = state.trash.find((row) => row.id === id);
  if (!item) return null;

  const deletedItem = {
    id: (options.makeId || uid)("permadelete"),
    permanentlyDeletedAt: (options.now || new Date()).toISOString(),
    originalId: item.originalId || item.id,
    deletedFrom: item.deletedFrom || "trash",
    company: item.company || "",
    role: item.role || "",
    recordType: inferRecordType(item),
    status: item.status || "",
    emailIds: item.emailIds || [],
    threadIds: item.threadIds || []
  };

  state.permanentlyDeletedItems = state.permanentlyDeletedItems || [];
  state.permanentlyDeletedItems.unshift(deletedItem);
  state.trash = state.trash.filter((row) => row.id !== id);
  return deletedItem;
}

export function rejectedCount(state) {
  const activeRejected = applicationRows(state).filter((item) => item.status === "Rejected").length;
  const trashRejected = state.trash.filter((item) => item.recordType !== "recruiter_message" && item.status === "Rejected").length;
  return activeRejected + trashRejected;
}

export function totalTrackedCount(state) {
  const active = applicationRows(state).length;
  const trashed = state.trash.filter((item) => item.recordType !== "recruiter_message").length;
  return active + trashed;
}

export function requestFullScan(state, now = new Date()) {
  state.meta = state.meta || {};
  state.meta.nextScanMode = "full";
  state.meta.fullScanRequestedAt = now.toISOString();
}

export function createNeedsRow(options = {}) {
  const now = options.now || new Date();
  const makeId = options.makeId || uid;
  return {
    id: makeId("app"),
    done: false,
    company: "",
    role: "",
    status: "Reply needed",
    appliedDate: isoDate(now),
    source: "Manual",
    latestUpdate: "",
    isHighPriority: true,
    recordType: "recruiter_message",
    actionNeeded: "",
    dueDate: "",
    latestDate: isoDate(now),
    highPriorityDate: isoDate(now),
    highPriorityStatus: "Reply recruiter",
    highPriorityNotes: "",
    notes: "",
    emailIds: []
  };
}

export function createApplicationRow(options = {}) {
  const now = options.now || new Date();
  const makeId = options.makeId || uid;
  return {
    id: makeId("app"),
    company: "",
    role: "",
    appliedDate: isoDate(now),
    status: "Applied / waiting",
    recordType: "application",
    latestDate: isoDate(now),
    source: "Manual",
    latestUpdate: "",
    notes: "",
    emailIds: []
  };
}
