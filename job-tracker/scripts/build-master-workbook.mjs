import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FileBlob, SpreadsheetFile, Workbook } from "@oai/artifact-tool";
import { writeJsonSafely } from "./file-io.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const trackerDir = path.resolve(__dirname, "..");
const dataPath = path.join(trackerDir, "job-tracker.json");
const backupDir = path.join(trackerDir, "backups");
const masterPath = path.join(trackerDir, "Job Application Tracker.xlsx");
const previewDir = path.join(trackerDir, "previews");

const palette = {
  navy: "#203864",
  teal: "#1F6F78",
  paleAmber: "#FFF1C2",
  paleBlue: "#D9EAF7",
  paleSlate: "#E7EDF3",
  paleGreen: "#DDEED9",
  paleRed: "#F4CCCC",
  paleGray: "#EEF2F6",
  white: "#FFFFFF",
  border: "#C9D3DF",
  text: "#111827",
  muted: "#475569"
};

const statusFill = {
  "Assessment / interview": palette.paleAmber,
  "Reply needed": palette.paleBlue,
  "Reply recruiter": palette.paleSlate,
  "Rejected": palette.paleRed,
  "Applied / waiting": palette.paleGreen
};

function nowStamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function normalizeDate(value) {
  if (!value) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "number") return excelSerialToDateText(value);
  const text = String(value).trim();
  if (!text) return "";
  if (/^\d{5}(?:\.\d+)?$/.test(text)) return excelSerialToDateText(Number(text));
  const match = text.match(/\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : text;
}

function excelSerialToDateText(serial) {
  if (!Number.isFinite(serial)) return "";
  const millis = Math.round((serial - 25569) * 86400 * 1000);
  return new Date(millis).toISOString().slice(0, 10);
}

function toDateOrText(value) {
  const text = normalizeDate(value);
  if (!text) return "";
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return text;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function keyFor(company, role) {
  return `${String(company || "").trim().toLowerCase()}|${String(role || "").trim().toLowerCase()}`;
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

function totalTrackedCount(data) {
  const active = applicationRows(data).length;
  const trashed = (data.trash || []).filter((item) => inferRecordType(item) !== "recruiter_message").length;
  return active + trashed;
}

function parseDone(value) {
  if (typeof value === "boolean") return value;
  return ["yes", "true", "done", "1"].includes(String(value || "").trim().toLowerCase());
}

function sameCompany(a, b) {
  return String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
}

function sameRole(a, b) {
  return String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
}

function hasEmailOverlap(a = [], b = []) {
  const set = new Set(a);
  return b.some((id) => set.has(id));
}

function appendNote(existing, addition) {
  const base = String(existing || "").trim();
  return base ? `${base} ${addition}` : addition;
}

function highPriorityApps(data) {
  return data.applications.filter((item) => item.isHighPriority);
}

function applicationRows(data) {
  return data.applications.filter((item) => inferRecordType(item) !== "recruiter_message");
}

function highPriorityFieldsFromNeed(need) {
  return {
    isHighPriority: true,
    done: Boolean(need.done),
    actionNeeded: need.actionNeeded || need.latestUpdate || "Review and decide next action.",
    dueDate: need.dueDate || "",
    highPriorityDate: normalizeDate(need.latestDate || need.appliedDate) || new Date().toISOString().slice(0, 10),
    highPriorityNotes: need.notes || "",
    highPriorityStatus: need.status || "Reply needed"
  };
}

function findMatchingApplication(data, need) {
  return data.applications.find((item) => hasEmailOverlap(item.emailIds, need.emailIds))
    || data.applications.find((item) => sameCompany(item.company, need.company) && sameRole(item.role, need.role))
    || data.applications.find((item) => sameCompany(item.company, need.company));
}

function migrateHighPriorityRows(data) {
  const migrated = [];
  const legacyCount = data.needsAttention.length;
  for (const need of data.needsAttention) {
    const app = findMatchingApplication(data, need);
    if (app) {
      Object.assign(app, highPriorityFieldsFromNeed(need));
      if (need.emailIds?.length) app.emailIds = [...new Set([...(app.emailIds || []), ...need.emailIds])];
      continue;
    }
    migrated.push({
      id: `app-${nowStamp()}-${Math.random().toString(16).slice(2)}`,
      company: need.company || "",
      role: need.role || "",
      appliedDate: normalizeDate(need.latestDate) || new Date().toISOString().slice(0, 10),
      status: need.status || "Reply needed",
      recordType: inferRecordType(need),
      latestDate: normalizeDate(need.latestDate) || new Date().toISOString().slice(0, 10),
      source: "High Priority",
      latestUpdate: need.actionNeeded || "",
      notes: need.notes || "",
      emailIds: need.emailIds || [],
      threadIds: need.threadIds || [],
      ...highPriorityFieldsFromNeed(need)
    });
  }
  if (migrated.length) data.applications.unshift(...migrated);
  if (legacyCount) {
    console.warn(`Migrated ${legacyCount} legacy needsAttention row(s): ${migrated.length} new application row(s), ${legacyCount - migrated.length} merged into existing row(s).`);
  }
  data.needsAttention = [];
}

async function loadJson() {
  const data = JSON.parse(await fs.readFile(dataPath, "utf8"));
  data.meta = data.meta || {};
  data.needsAttention = Array.isArray(data.needsAttention) ? data.needsAttention : [];
  data.applications = Array.isArray(data.applications) ? data.applications : [];
  data.trash = Array.isArray(data.trash) ? data.trash : [];
  data.permanentlyDeletedItems = Array.isArray(data.permanentlyDeletedItems) ? data.permanentlyDeletedItems : [];
  data.completedActions = Array.isArray(data.completedActions) ? data.completedActions : [];
  data.processedEmailIds = Array.isArray(data.processedEmailIds) ? data.processedEmailIds : [];
  data.meta.revision = Number(data.meta.revision || 0);
  data.meta.scanWindowStart = data.meta.scanWindowStart || "2026-04-01";
  data.meta.incrementalScanOverlapDays = Number(data.meta.incrementalScanOverlapDays || 3);
  if (!["full", "incremental"].includes(data.meta.nextScanMode)) data.meta.nextScanMode = "incremental";
  migrateHighPriorityRows(data);
  data.applications.forEach((item) => {
    item.recordType = inferRecordType(item);
  });
  data.trash.forEach((item) => {
    item.recordType = inferRecordType(item);
  });
  data.permanentlyDeletedItems.forEach((item) => {
    item.recordType = inferRecordType(item);
  });
  return data;
}

async function saveJson(data) {
  const expectedRevision = Number(data.meta.revision || 0);
  const current = JSON.parse(await fs.readFile(dataPath, "utf8"));
  const currentRevision = Number(current.meta?.revision || 0);
  if (currentRevision !== expectedRevision) {
    throw new Error(`Tracker changed while building workbook. Expected revision ${expectedRevision}, found ${currentRevision}. Reload and run again.`);
  }
  data.meta.revision = currentRevision + 1;
  data.meta.lastUpdatedAt = new Date().toISOString();
  data.meta.lastUpdated = data.meta.lastUpdatedAt.slice(0, 10);
  await writeJsonSafely(dataPath, data);
}

async function readExistingWorkbookEdits() {
  try {
    await fs.access(masterPath);
  } catch {
    return { needs: new Map(), apps: new Map() };
  }

  const blob = await FileBlob.load(masterPath);
  const existing = await SpreadsheetFile.importXlsx(blob);
  const edits = { needs: new Map(), apps: new Map() };

  try {
    const sheet = existing.worksheets.getItem("High Priority");
    const values = sheet.getUsedRange().values || [];
    for (const row of values.slice(4)) {
      const [done, company, role, status, actionNeeded, dueDate, latestDate, notes] = row;
      if (!company || !role) continue;
      edits.needs.set(keyFor(company, role), {
        done: parseDone(done),
        status: status || "",
        actionNeeded: actionNeeded || "",
        dueDate: normalizeDate(dueDate),
        latestDate: normalizeDate(latestDate),
        notes: notes || ""
      });
    }
  } catch {
    try {
      const sheet = existing.worksheets.getItem("Needs Attention");
      const values = sheet.getUsedRange().values || [];
      for (const row of values.slice(4)) {
        const [done, company, role, status, actionNeeded, dueDate, latestDate, notes] = row;
        if (!company || !role) continue;
        edits.needs.set(keyFor(company, role), {
          done: parseDone(done),
          status: status || "",
          actionNeeded: actionNeeded || "",
          dueDate: normalizeDate(dueDate),
          latestDate: normalizeDate(latestDate),
          notes: notes || ""
        });
      }
    } catch {
      // No prior high-priority sheet, so there is nothing to merge.
    }
  }

  try {
    const sheet = existing.worksheets.getItem("Application Tracker");
    const values = sheet.getUsedRange().values || [];
    for (const row of values.slice(4)) {
      const [company, role, appliedDate, status, latestDate, source, latestUpdate, notes] = row;
      if (!company || !role) continue;
      edits.apps.set(keyFor(company, role), {
        role: role || "",
        appliedDate: normalizeDate(appliedDate),
        status: status || "",
        latestDate: normalizeDate(latestDate),
        source: source || "",
        latestUpdate: latestUpdate || "",
        notes: notes || ""
      });
    }
  } catch {
    // No prior tracker sheet, so there is nothing to merge.
  }

  return edits;
}

async function shouldMergeExcelEdits() {
  if (process.env.MERGE_EXCEL_EDITS === "0") return false;
  if (process.env.MERGE_EXCEL_EDITS === "1") return true;
  try {
    const [jsonStat, workbookStat] = await Promise.all([
      fs.stat(dataPath),
      fs.stat(masterPath)
    ]);
    return workbookStat.mtimeMs > jsonStat.mtimeMs;
  } catch {
    return false;
  }
}

function mergeManualEdits(data, edits) {
  for (const item of highPriorityApps(data)) {
    const edit = edits.needs.get(keyFor(item.company, item.role));
    if (!edit) continue;
    item.done = edit.done;
    if (edit.status) item.highPriorityStatus = edit.status;
    if (edit.actionNeeded) item.actionNeeded = edit.actionNeeded;
    if (edit.dueDate) item.dueDate = edit.dueDate;
    if (edit.latestDate) item.highPriorityDate = edit.latestDate;
    if (edit.notes) item.highPriorityNotes = edit.notes;
  }

  for (const item of data.applications) {
    const edit = edits.apps.get(keyFor(item.company, item.role));
    if (!edit) continue;
    if (edit.role && !edit.role.includes("Role not visible")) item.role = edit.role;
    if (edit.appliedDate) item.appliedDate = edit.appliedDate;
    if (edit.status) item.status = edit.status;
    if (edit.latestDate) item.latestDate = edit.latestDate;
    if (edit.source) item.source = edit.source;
    if (edit.latestUpdate) item.latestUpdate = edit.latestUpdate;
    if (edit.notes) item.notes = edit.notes;
  }
}

function completeDoneNeeds(data) {
  data.completedActions = data.completedActions || [];

  for (const item of highPriorityApps(data)) {
    if (!item.done) {
      continue;
    }

    const completedDate = new Date().toISOString().slice(0, 10);
    const completionNote = `Completed from High Priority on ${completedDate}.`;
    const previousStatus = item.highPriorityStatus || item.status;
    const actionNeeded = item.actionNeeded;
    const latestDate = item.highPriorityDate || item.latestDate;
    const notes = item.highPriorityNotes || item.notes;

    item.status = "Applied / waiting";
    item.latestDate = item.highPriorityDate || item.latestDate || completedDate;
    item.latestUpdate = "Action completed; waiting for next update.";
    item.notes = appendNote(item.notes, completionNote);
    item.isHighPriority = false;
    item.done = false;
    item.actionNeeded = "";
    item.dueDate = "";
    item.highPriorityDate = "";
    item.highPriorityNotes = "";
    item.highPriorityStatus = "";
    data.completedActions.unshift({
      id: `done-${nowStamp()}`,
      company: item.company,
      role: item.role,
      completedDate,
      previousStatus,
      actionNeeded,
      latestDate,
      notes: appendNote(notes, completionNote),
      emailIds: item.emailIds || []
    });
  }
}

function moveRejectedApplicationsToTrash(data) {
  const stillActive = [];
  const rejected = [];

  for (const item of data.applications) {
    if (item.status === "Rejected") rejected.push(item);
    else stillActive.push(item);
  }

  if (!rejected.length) return;

  const deletedAt = new Date().toISOString();
  data.trash = data.trash || [];
  for (const item of rejected) {
    const trashItem = JSON.parse(JSON.stringify(item));
    trashItem.id = `trash-${nowStamp()}-${Math.random().toString(16).slice(2)}`;
    trashItem.originalId = item.id;
    trashItem.deletedFrom = "apps";
    trashItem.deletedAt = deletedAt;
    data.trash.unshift(trashItem);
  }
  data.applications = stillActive;
}

async function backupExisting() {
  try {
    await fs.access(masterPath);
  } catch {
    return;
  }
  await fs.mkdir(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, `Job Application Tracker - before ${nowStamp()}.xlsx`);
  await fs.copyFile(masterPath, backupPath);
}

function applyTitleStyle(range) {
  range.format.fill.color = palette.navy;
  range.format.font.color = palette.white;
  range.format.font.bold = true;
  range.format.font.size = 18;
  range.format.horizontalAlignment = "center";
  range.format.verticalAlignment = "center";
  range.format.rowHeightPx = 42;
}

function applyHeaderStyle(range) {
  range.format.fill.color = palette.teal;
  range.format.font.color = palette.white;
  range.format.font.bold = true;
  range.format.font.size = 12;
  range.format.wrapText = true;
  range.format.verticalAlignment = "center";
  range.format.rowHeightPx = 34;
}

function applyBodyStyle(range) {
  range.format.font.name = "Aptos";
  range.format.font.size = 12;
  range.format.font.color = palette.text;
  range.format.wrapText = true;
  range.format.verticalAlignment = "top";
  range.format.borders.color = palette.border;
}

function setWidths(sheet, widths) {
  widths.forEach((width, index) => {
    sheet.getRangeByIndexes(0, index, 120, 1).format.columnWidthPx = width;
  });
}

function fillRowByStatus(sheet, rowNumber, lastCol, status, done = false) {
  const range = sheet.getRange(`A${rowNumber}:${lastCol}${rowNumber}`);
  range.format.fill.color = done ? palette.paleGray : (statusFill[status] || palette.white);
}

async function buildWorkbook(data) {
  const workbook = Workbook.create();
  const summary = workbook.worksheets.add("Summary");
  const needs = workbook.worksheets.add("High Priority");
  const apps = workbook.worksheets.add("Application Tracker");
  const trash = workbook.worksheets.add("Trash");

  for (const sheet of [summary, needs, apps, trash]) sheet.showGridLines = false;

  summary.mergeCells("A1:E1");
  summary.getRange("A1:E1").values = [["Job Tracker"]];
  applyTitleStyle(summary.getRange("A1:E1"));

  const highPriorityRows = highPriorityApps(data);
  const openNeeds = highPriorityRows.filter((item) => !item.done).length;
  const activeApplications = applicationRows(data);
  const rejected = activeApplications.filter((item) => item.status === "Rejected").length
    + data.trash.filter((item) => item.recordType !== "recruiter_message" && item.status === "Rejected").length;
  summary.getRange("A3:B14").values = [
    ["Report date", toDateOrText(data.meta.reportDate)],
    ["Search window", `${data.meta.scanWindowStart} onward`],
    ["Daily scan mode", data.meta.nextScanMode === "full" ? "Full scan queued" : "Incremental"],
    ["Last successful scan", data.meta.lastSuccessfulScanAt || ""],
    ["Open high-priority items", openNeeds],
    ["Total high-priority rows", highPriorityRows.length],
    ["Applications / conversations tracked", activeApplications.length],
    ["Total applications", totalTrackedCount(data)],
    ["Rejected", rejected],
    ["Trash rows", data.trash.length],
    ["Master JSON", "job-tracker.json"],
    ["Backups", "job-tracker/backups"]
  ];
  summary.getRange("A3:A14").format.fill.color = palette.paleBlue;
  summary.getRange("A3:A14").format.font.bold = true;
  summary.getRange("A3:B14").format.font.size = 12;
  summary.getRange("A3:B14").format.borders.color = palette.border;
  summary.getRange("B3").setNumberFormat("yyyy-mm-dd");
  summary.getRange("B6").setNumberFormat("yyyy-mm-dd h:mm");
  summary.getRange("D3:E7").values = [
    ["Status", "Color"],
    ["Assessment / interview", "Amber"],
    ["Reply needed", "Blue"],
    ["Reply recruiter", "Slate"],
    ["Rejected", "Red"]
  ];
  summary.getRange("D8:E8").values = [["Applied / waiting", "Green"]];
  applyHeaderStyle(summary.getRange("D3:E3"));
  summary.getRange("D4:E8").format.font.size = 12;
  summary.getRange("D4:E4").format.fill.color = palette.paleAmber;
  summary.getRange("D5:E5").format.fill.color = palette.paleBlue;
  summary.getRange("D6:E6").format.fill.color = palette.paleSlate;
  summary.getRange("D7:E7").format.fill.color = palette.paleRed;
  summary.getRange("D8:E8").format.fill.color = palette.paleGreen;
  setWidths(summary, [260, 300, 60, 220, 160]);

  needs.mergeCells("A1:H1");
  needs.getRange("A1:H1").values = [["High Priority"]];
  applyTitleStyle(needs.getRange("A1:H1"));
  needs.mergeCells("A2:H2");
  needs.getRange("A2:H2").values = [["Use Done only here. When a task is done, it leaves this section and the matching tracker row returns to Applied / waiting."]];
  needs.getRange("A2:H2").format.fill.color = palette.paleGray;
  needs.getRange("A2:H2").format.font.color = palette.muted;
  needs.getRange("A2:H2").format.font.size = 12;

  needs.getRange("A4:H4").values = [[
    "Done",
    "Company",
    "Role / Context",
    "Status",
    "Action Needed",
    "Due Date",
    "Latest Date",
    "Notes"
  ]];
  const needsRows = highPriorityRows.map((item) => [
    item.done ? "Yes" : "No",
    item.company,
    item.role,
    item.highPriorityStatus || item.status,
    item.actionNeeded,
    toDateOrText(item.dueDate),
    toDateOrText(item.highPriorityDate || item.latestDate),
    item.highPriorityNotes || item.notes
  ]);
  needs.getRange(`A5:H${4 + needsRows.length}`).values = needsRows;
  applyHeaderStyle(needs.getRange("A4:H4"));
  applyBodyStyle(needs.getRange(`A5:H${4 + needsRows.length}`));
  needs.getRange(`F5:G${4 + needsRows.length}`).setNumberFormat("yyyy-mm-dd");
  for (let index = 0; index < highPriorityRows.length; index += 1) {
    const item = highPriorityRows[index];
    fillRowByStatus(needs, index + 5, "H", item.highPriorityStatus || item.status, item.done);
  }
  needs.tables.add(`A4:H${4 + needsRows.length}`, true, "HighPriorityTable").style = "TableStyleMedium2";
  needs.freezePanes.freezeRows(4);
  needs.getRange("A5:A100").dataValidation = { rule: { type: "list", values: ["No", "Yes"] } };
  needs.getRange("D5:D100").dataValidation = { rule: { type: "list", values: ["Assessment / interview", "Reply needed", "Reply recruiter", "Rejected", "Applied / waiting"] } };
  setWidths(needs, [85, 190, 240, 180, 330, 115, 115, 430]);

  apps.mergeCells("A1:H1");
  apps.getRange("A1:H1").values = [["Application Tracker"]];
  applyTitleStyle(apps.getRange("A1:H1"));
  apps.mergeCells("A2:H2");
  apps.getRange("A2:H2").values = [["Color is based only on status: assessment/interview is amber, reply needed is blue, rejected is red, applied/waiting is green."]];
  apps.getRange("A2:H2").format.fill.color = palette.paleGray;
  apps.getRange("A2:H2").format.font.color = palette.muted;
  apps.getRange("A2:H2").format.font.size = 12;

  apps.getRange("A4:H4").values = [[
    "Company",
    "Role",
    "Entry Date",
    "Status",
    "Latest Date",
    "Source",
    "Latest Update",
    "Notes"
  ]];
  const appRows = activeApplications.map((item) => [
    item.company,
    item.role,
    toDateOrText(item.appliedDate),
    item.status,
    toDateOrText(item.latestDate),
    item.source,
    item.latestUpdate,
    item.notes
  ]);
  apps.getRange(`A5:H${4 + appRows.length}`).values = appRows;
  applyHeaderStyle(apps.getRange("A4:H4"));
  applyBodyStyle(apps.getRange(`A5:H${4 + appRows.length}`));
  apps.getRange(`C5:E${4 + appRows.length}`).setNumberFormat("yyyy-mm-dd");
  for (let index = 0; index < activeApplications.length; index += 1) {
    fillRowByStatus(apps, index + 5, "H", activeApplications[index].status);
  }
  apps.tables.add(`A4:H${4 + appRows.length}`, true, "ApplicationTrackerTable").style = "TableStyleMedium4";
  apps.freezePanes.freezeRows(4);
  apps.freezePanes.freezeColumns(1);
  apps.getRange("D5:D200").dataValidation = { rule: { type: "list", values: ["Assessment / interview", "Reply needed", "Reply recruiter", "Rejected", "Applied / waiting"] } };
  setWidths(apps, [180, 205, 104, 145, 104, 86, 185, 170]);

  trash.mergeCells("A1:H1");
  trash.getRange("A1:H1").values = [["Trash"]];
  applyTitleStyle(trash.getRange("A1:H1"));
  trash.mergeCells("A2:H2");
  trash.getRange("A2:H2").values = [["Deleted tracker rows live here so the daily scan does not recreate them from the same emails. Restore from the local dashboard when needed."]];
  trash.getRange("A2:H2").format.fill.color = palette.paleGray;
  trash.getRange("A2:H2").format.font.color = palette.muted;
  trash.getRange("A2:H2").format.font.size = 12;
  trash.getRange("A4:H4").values = [[
    "Deleted At",
    "Deleted From",
    "Company",
    "Role / Context",
    "Status",
    "Latest Date",
    "Source",
    "Notes"
  ]];
  const trashRows = data.trash.length ? data.trash.map((item) => [
    item.deletedAt || "",
    item.deletedFrom === "needs" ? "High Priority" : "Application Tracker",
    item.company,
    item.role,
    item.status,
    toDateOrText(item.latestDate || item.appliedDate),
    item.source || "",
    item.notes || item.latestUpdate || item.actionNeeded || ""
  ]) : [["", "", "", "", "", "", "", ""]];
  trash.getRange(`A5:H${4 + trashRows.length}`).values = trashRows;
  applyHeaderStyle(trash.getRange("A4:H4"));
  applyBodyStyle(trash.getRange(`A5:H${4 + trashRows.length}`));
  trash.getRange(`F5:F${4 + trashRows.length}`).setNumberFormat("yyyy-mm-dd");
  for (let index = 0; index < data.trash.length; index += 1) {
    fillRowByStatus(trash, index + 5, "H", data.trash[index].status);
  }
  trash.tables.add(`A4:H${4 + trashRows.length}`, true, "TrashTable").style = "TableStyleMedium3";
  trash.freezePanes.freezeRows(4);
  setWidths(trash, [190, 160, 230, 260, 180, 115, 190, 450]);

  for (const sheet of [summary, needs, apps, trash]) {
    const used = sheet.getUsedRange();
    used.format.font.name = "Aptos";
  }

  const check = await workbook.inspect({
    kind: "table",
    range: "Summary!A1:E10",
    include: "values,formulas",
    tableMaxRows: 10,
    tableMaxCols: 5
  });
  console.log(check.ndjson);

  const errors = await workbook.inspect({
    kind: "match",
    searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
    options: { useRegex: true, maxResults: 200 },
    summary: "formula error scan"
  });
  console.log(errors.ndjson);

  await fs.mkdir(previewDir, { recursive: true });
  for (const sheetName of ["Summary", "High Priority", "Application Tracker", "Trash"]) {
    const preview = await workbook.render({ sheetName, autoCrop: "all", scale: 1, format: "png" });
    const bytes = new Uint8Array(await preview.arrayBuffer());
    await fs.writeFile(path.join(previewDir, `${sheetName.replace(/ /g, "-")}.png`), bytes);
  }

  await fs.mkdir(backupDir, { recursive: true });
  await backupExisting();
  const output = await SpreadsheetFile.exportXlsx(workbook);
  await output.save(masterPath);

  const datedName = `JOB report - ${data.meta.reportDate}.xlsx`;
  const datedPath = path.join(backupDir, datedName);
  try {
    await fs.access(datedPath);
    await output.save(path.join(backupDir, `JOB report - ${data.meta.reportDate} - ${nowStamp()}.xlsx`));
  } catch {
    await output.save(datedPath);
  }

  return masterPath;
}

const data = await loadJson();
const beforeJson = JSON.stringify(data);
if (await shouldMergeExcelEdits()) {
  const edits = await readExistingWorkbookEdits();
  mergeManualEdits(data, edits);
}
completeDoneNeeds(data);
moveRejectedApplicationsToTrash(data);
if (JSON.stringify(data) !== beforeJson) {
  await saveJson(data);
}
const outputPath = await buildWorkbook(data);
console.log(`saved=${outputPath}`);
