import assert from "node:assert/strict";
import {
  completeNeed,
  createApplicationRow,
  createNeedsRow,
  ensureStateShape,
  applicationRows,
  highPriorityApplications,
  moveToTrash,
  moveToHighPriority,
  normalizeRejectedApplicationsToTrash,
  permanentlyDeleteTrashItem,
  rejectedCount,
  requestFullScan,
  restoreTrashItem,
  totalTrackedCount
} from "../app/tracker-model.js";
import { ageBadge } from "../app/view-helpers.js";

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function makeId(prefix) {
  makeId.count = (makeId.count || 0) + 1;
  return `${prefix}-${makeId.count}`;
}

function resetIds() {
  makeId.count = 0;
}

function baseState() {
  return ensureStateShape({
    meta: {},
    needsAttention: [],
    applications: [],
    trash: [],
    permanentlyDeletedItems: [],
    completedActions: [],
    processedEmailIds: []
  }, makeId);
}

test("ensureStateShape adds tracker defaults and missing ids", () => {
  resetIds();
  const state = ensureStateShape({
    needsAttention: [{ company: "Rokt" }],
    applications: [{ company: "Brillio" }]
  }, makeId);

  assert.equal(state.meta.scanWindowStart, "2026-04-01");
  assert.equal(state.meta.incrementalScanOverlapDays, 3);
  assert.equal(state.meta.nextScanMode, "incremental");
  assert.equal(state.needsAttention.length, 0);
  assert.equal(state.applications[0].id, "app-3");
  assert.equal(state.applications[0].isHighPriority, true);
  assert.equal(state.applications[1].id, "app-2");
  assert.deepEqual(state.trash, []);
  assert.deepEqual(state.permanentlyDeletedItems, []);
});

test("completeNeed removes an action and updates the matching application", () => {
  resetIds();
  const state = baseState();
  state.needsAttention.push({
    id: "attn-rokt",
    company: "Rokt",
    role: "Junior Software Engineer",
    status: "Assessment / interview",
    actionNeeded: "Complete assessment.",
    latestDate: "2026-05-05",
    notes: "Due soon.",
    emailIds: ["email-1"]
  });
  state.applications.push({
    id: "app-rokt",
    company: "Rokt",
    role: "Junior Software Engineer",
    status: "Assessment / interview",
    latestDate: "2026-05-05",
    latestUpdate: "Assessment requested.",
    notes: "",
    emailIds: ["email-1"]
  });

  completeNeed(state, "attn-rokt", {
    now: new Date("2026-05-06T12:00:00Z"),
    makeId
  });

  assert.equal(state.needsAttention.length, 0);
  assert.equal(state.applications[0].status, "Applied / waiting");
  assert.equal(state.applications[0].isHighPriority, false);
  assert.equal(state.applications[0].latestUpdate, "Action completed; waiting for next update.");
  assert.match(state.applications[0].notes, /Completed from High Priority on 2026-05-06/);
  assert.equal(state.completedActions.length, 1);
  assert.equal(state.completedActions[0].previousStatus, "Assessment / interview");
});

test("completeNeed creates an application when no match exists", () => {
  resetIds();
  const state = baseState();
  state.needsAttention.push({
    id: "attn-new",
    company: "New Company",
    role: "Developer",
    status: "Reply needed",
    actionNeeded: "Reply.",
    latestDate: "2026-05-05",
    emailIds: ["email-2"]
  });

  completeNeed(state, "attn-new", {
    now: new Date("2026-05-06T12:00:00Z"),
    makeId
  });

  assert.equal(state.needsAttention.length, 0);
  assert.equal(state.applications.length, 1);
  assert.equal(state.applications[0].company, "New Company");
  assert.equal(state.applications[0].status, "Applied / waiting");
  assert.deepEqual(state.applications[0].emailIds, ["email-2"]);
});

test("delete moves application rows to Trash with email IDs preserved", () => {
  resetIds();
  const state = baseState();
  state.applications.push({
    id: "app-trash-me",
    company: "Trash Co",
    role: "Backend Engineer",
    status: "Applied / waiting",
    emailIds: ["email-trash"]
  });

  const trashItem = moveToTrash(state, "apps", "app-trash-me", {
    now: new Date("2026-05-06T13:00:00Z"),
    makeId
  });

  assert.equal(state.applications.length, 0);
  assert.equal(state.trash.length, 1);
  assert.equal(trashItem.deletedFrom, "apps");
  assert.equal(trashItem.originalId, "app-trash-me");
  assert.deepEqual(trashItem.emailIds, ["email-trash"]);
});

test("delete preserves high-priority display status in Trash", () => {
  resetIds();
  const state = baseState();
  state.applications.push({
    id: "app-recruiter",
    company: "LinkedIn / Recruiter",
    role: "Recruiter or networking message",
    status: "Applied / waiting",
    recordType: "recruiter_message",
    isHighPriority: true,
    highPriorityStatus: "Reply recruiter",
    emailIds: ["email-recruiter"]
  });

  const trashItem = moveToTrash(state, "needs", "app-recruiter", {
    now: new Date("2026-05-06T13:00:00Z"),
    makeId
  });

  assert.equal(trashItem.status, "Reply recruiter");
  assert.equal(trashItem.recordType, "recruiter_message");
});

test("restore moves Trash rows back to their original section", () => {
  resetIds();
  const state = baseState();
  state.trash.push({
    id: "trash-1",
    originalId: "attn-restore",
    deletedFrom: "needs",
    deletedAt: "2026-05-06T13:00:00.000Z",
    company: "Restore Co",
    role: "Developer",
    status: "Reply needed",
    emailIds: ["email-restore"]
  });

  const restored = restoreTrashItem(state, "trash-1", { makeId });

  assert.equal(restored.target, "needs");
  assert.equal(state.trash.length, 0);
  assert.equal(state.applications.length, 1);
  assert.equal(state.applications[0].id, "attn-restore");
  assert.equal(state.applications[0].company, "Restore Co");
});

test("restore returns recruiter messages to High Priority", () => {
  resetIds();
  const state = baseState();
  state.trash.push({
    id: "trash-recruiter",
    originalId: "app-recruiter",
    deletedFrom: "apps",
    deletedAt: "2026-05-06T13:00:00.000Z",
    company: "LinkedIn / Recruiter",
    role: "Recruiter or networking message",
    status: "Reply recruiter",
    recordType: "recruiter_message",
    isHighPriority: true,
    highPriorityStatus: "Reply recruiter",
    latestDate: "2026-05-06",
    emailIds: ["email-recruiter"]
  });

  const restored = restoreTrashItem(state, "trash-recruiter", { makeId });

  assert.equal(restored.target, "needs");
  assert.equal(state.trash.length, 0);
  assert.equal(state.applications.length, 1);
  assert.equal(state.applications[0].recordType, "recruiter_message");
  assert.equal(state.applications[0].isHighPriority, true);
  assert.equal(state.applications[0].highPriorityStatus, "Reply recruiter");
  assert.equal(applicationRows(state).length, 0);
});

test("restore target follows stored priority state", () => {
  resetIds();
  const state = baseState();
  state.trash.push(
    {
      id: "trash-priority-app",
      originalId: "app-priority",
      deletedFrom: "apps",
      company: "Priority App",
      role: "Engineer",
      status: "Reply needed",
      recordType: "application",
      isHighPriority: true,
      highPriorityStatus: "Reply needed"
    },
    {
      id: "trash-normal-app",
      originalId: "app-normal",
      deletedFrom: "apps",
      company: "Normal App",
      role: "Engineer",
      status: "Applied / waiting",
      recordType: "application",
      isHighPriority: false
    }
  );

  const priority = restoreTrashItem(state, "trash-priority-app", { makeId });
  const normal = restoreTrashItem(state, "trash-normal-app", { makeId });

  assert.equal(priority.target, "needs");
  assert.equal(normal.target, "apps");
  assert.equal(highPriorityApplications(state).length, 1);
  assert.equal(applicationRows(state).length, 2);
});

test("rejected applications automatically move to Trash", () => {
  resetIds();
  const state = baseState();
  state.applications.push(
    { id: "app-rejected", company: "No Co", role: "Engineer", status: "Rejected", emailIds: ["email-no"] },
    { id: "app-waiting", company: "Wait Co", role: "Engineer", status: "Applied / waiting" }
  );

  const moved = normalizeRejectedApplicationsToTrash(state, {
    now: new Date("2026-05-06T17:00:00Z"),
    makeId
  });

  assert.equal(moved.length, 1);
  assert.equal(state.applications.length, 1);
  assert.equal(state.applications[0].id, "app-waiting");
  assert.equal(state.trash[0].originalId, "app-rejected");
  assert.equal(state.trash[0].status, "Rejected");
});

test("selected applications can move to High Priority while staying tracked", () => {
  resetIds();
  const state = baseState();
  state.applications.push({
    id: "app-priority",
    company: "Priority Co",
    role: "Engineer",
    status: "Applied / waiting",
    latestDate: "2026-05-06",
    latestUpdate: "Recruiter asked for follow-up.",
    emailIds: ["email-priority"]
  });

  const row = moveToHighPriority(state, "apps", "app-priority", { makeId });

  assert.equal(state.applications.length, 1);
  assert.equal(highPriorityApplications(state).length, 1);
  assert.equal(row.company, "Priority Co");
  assert.equal(row.highPriorityStatus, "Reply needed");
  assert.equal(row.actionNeeded, "Recruiter asked for follow-up.");
  assert.deepEqual(row.emailIds, ["email-priority"]);
});

test("total count is active application tracker rows plus trash", () => {
  const state = baseState();
  state.applications.push({ id: "app-1", company: "One", role: "Engineer", emailIds: ["email-1"] });
  state.applications[0].isHighPriority = true;
  state.applications[0].highPriorityStatus = "Reply needed";
  state.trash.push({ id: "trash-1", company: "Two", role: "Engineer", emailIds: ["email-2"] });
  state.permanentlyDeletedItems.push({ id: "gone-1", company: "Three", role: "Engineer", emailIds: ["email-3"] });

  assert.equal(totalTrackedCount(state), 2);
});

test("recruiter message rows stay out of application counts", () => {
  const state = baseState();
  state.applications.push({
    id: "msg-1",
    company: "LinkedIn / Recruiter",
    role: "Outreach message",
    recordType: "recruiter_message",
    isHighPriority: true,
    highPriorityStatus: "Reply recruiter",
    latestDate: "2026-05-06",
    emailIds: ["email-msg"]
  });
  state.applications.push({
    id: "app-1",
    company: "Real Co",
    role: "Engineer",
    recordType: "application",
    status: "Applied / waiting",
    latestDate: "2026-05-06",
    emailIds: ["email-app"]
  });

  assert.equal(highPriorityApplications(state).length, 1);
  assert.equal(applicationRows(state).length, 1);
  assert.equal(totalTrackedCount(state), 1);
});

test("legacy recruiter-like trash rows are normalized out of application counts", () => {
  const state = ensureStateShape({
    meta: {},
    needsAttention: [],
    applications: [],
    trash: [{
      id: "trash-legacy",
      company: "LinkedIn / Neeli Sai Nikhil",
      role: "Recruiter or networking message",
      status: "Applied / waiting",
      deletedFrom: "apps",
      emailIds: ["email-legacy"]
    }],
    permanentlyDeletedItems: [],
    completedActions: [],
    processedEmailIds: []
  }, makeId);

  assert.equal(state.trash[0].recordType, "recruiter_message");
  assert.equal(totalTrackedCount(state), 0);
});

test("explicit application record type overrides recruiter-like text", () => {
  const state = ensureStateShape({
    meta: {},
    needsAttention: [],
    applications: [{
      id: "app-linkedin-corp",
      company: "LinkedIn Corp",
      role: "Lead Recruiter",
      status: "Applied / waiting",
      recordType: "application",
      latestUpdate: "Reply if you need more details.",
      emailIds: ["email-linkedin-corp"]
    }],
    trash: [],
    permanentlyDeletedItems: [],
    completedActions: [],
    processedEmailIds: []
  }, makeId);

  assert.equal(state.applications[0].recordType, "application");
  assert.equal(applicationRows(state).length, 1);
  assert.equal(totalTrackedCount(state), 1);
});

test("permanent delete removes a Trash row but keeps suppression details", () => {
  resetIds();
  const state = baseState();
  state.trash.push({
    id: "trash-rejected",
    originalId: "app-rejected",
    deletedFrom: "apps",
    company: "Rejected Co",
    role: "Engineer",
    status: "Rejected",
    emailIds: ["email-rejected"]
  });

  const deleted = permanentlyDeleteTrashItem(state, "trash-rejected", {
    now: new Date("2026-05-06T16:00:00Z"),
    makeId
  });

  assert.equal(state.trash.length, 0);
  assert.equal(state.permanentlyDeletedItems.length, 1);
  assert.equal(deleted.status, "Rejected");
  assert.deepEqual(deleted.emailIds, ["email-rejected"]);
});

test("rejected count includes Trash and excludes permanently deleted rows", () => {
  const state = baseState();
  state.applications.push({ id: "app-1", status: "Rejected" });
  state.trash.push({ id: "trash-1", status: "Rejected" });
  state.permanentlyDeletedItems.push({ id: "gone-1", status: "Rejected" });

  assert.equal(rejectedCount(state), 2);
});

test("full scan button state marks next run as full", () => {
  const state = baseState();
  requestFullScan(state, new Date("2026-05-06T14:00:00Z"));

  assert.equal(state.meta.nextScanMode, "full");
  assert.equal(state.meta.fullScanRequestedAt, "2026-05-06T14:00:00.000Z");
});

test("manual row factories create expected defaults", () => {
  resetIds();
  const now = new Date("2026-05-06T15:00:00Z");
  assert.deepEqual(createNeedsRow({ now, makeId }), {
    id: "app-1",
    done: false,
    company: "",
    role: "",
    status: "Reply needed",
    appliedDate: "2026-05-06",
    source: "Manual",
    latestUpdate: "",
    isHighPriority: true,
    recordType: "recruiter_message",
    actionNeeded: "",
    dueDate: "",
    latestDate: "2026-05-06",
    highPriorityDate: "2026-05-06",
    highPriorityStatus: "Reply recruiter",
    highPriorityNotes: "",
    notes: "",
    emailIds: []
  });

  assert.equal(createApplicationRow({ now, makeId }).status, "Applied / waiting");
});

test("age badge treats ISO dates as local calendar dates", () => {
  const RealDate = globalThis.Date;
  globalThis.Date = class extends RealDate {
    constructor(...args) {
      if (args.length === 0) return new RealDate(2026, 4, 6, 12, 0, 0);
      return new RealDate(...args);
    }

    static now() {
      return new RealDate(2026, 4, 6, 12, 0, 0).getTime();
    }
  };

  try {
    assert.match(ageBadge("2026-05-05", "Applied / waiting"), />1D</);
  } finally {
    globalThis.Date = RealDate;
  }
});

let failed = 0;
for (const { name, fn } of tests) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`not ok - ${name}`);
    console.error(error.stack || error.message || String(error));
  }
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log(`${tests.length} tracker model tests passed`);
}
