import fs from "node:fs/promises";
import path from "node:path";
import { writeJsonSafely } from "./file-io.mjs";

const trackerDir = path.resolve(import.meta.dirname, "..");
const dataPath = path.join(trackerDir, "job-tracker.json");

function uniq(values = []) {
  return Array.from(new Set(values.filter(Boolean).map((value) => String(value))));
}

function formatLocalDate(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function buildApplicationId() {
  return `app-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function hasOwn(update, key) {
  return Object.prototype.hasOwnProperty.call(update, key);
}

function mergeOptionalFields(target, update) {
  if (hasOwn(update, "recordType")) target.recordType = update.recordType;
  if (hasOwn(update, "threadIds")) target.threadIds = uniq([...(target.threadIds || []), ...(update.threadIds || [])]);
  if (hasOwn(update, "isHighPriority")) target.isHighPriority = Boolean(update.isHighPriority);
  if (hasOwn(update, "done")) target.done = Boolean(update.done);
  if (hasOwn(update, "actionNeeded")) target.actionNeeded = update.actionNeeded || "";
  if (hasOwn(update, "dueDate")) target.dueDate = update.dueDate || "";
  if (hasOwn(update, "highPriorityDate")) target.highPriorityDate = update.highPriorityDate || "";
  if (hasOwn(update, "highPriorityStatus")) target.highPriorityStatus = update.highPriorityStatus || "";
  if (hasOwn(update, "highPriorityNotes")) target.highPriorityNotes = update.highPriorityNotes || "";
}

function applyUpdates(data, updates) {
  const applications = Array.isArray(data.applications) ? data.applications : (data.applications = []);
  const processedEmailIds = new Set(uniq(data.processedEmailIds || []));
  const trashEmailIds = new Set(uniq((data.trash || []).flatMap((item) => item?.emailIds || [])));
  const deletedEmailIds = new Set(uniq((data.permanentlyDeletedItems || []).flatMap((item) => item?.emailIds || [])));

  const results = [];

  for (const update of updates) {
    const updateEmailIds = uniq(update.emailIds || []);
    const alreadyHandled = updateEmailIds.some((id) => processedEmailIds.has(id) || trashEmailIds.has(id) || deletedEmailIds.has(id));
    if (alreadyHandled) {
      results.push({ action: "skipped_duplicate", company: update.company, role: update.role, emailIds: updateEmailIds });
      continue;
    }

    const existing = applications.find((app) => (app.emailIds || []).some((id) => updateEmailIds.includes(String(id))))
      || applications.find((app) => String(app.company || "").trim().toLowerCase() === String(update.company || "").trim().toLowerCase()
        && String(app.role || "").trim().toLowerCase() === String(update.role || "").trim().toLowerCase());
    if (existing) {
      existing.emailIds = uniq([...(existing.emailIds || []), ...updateEmailIds]);
      existing.latestDate = update.latestDate || existing.latestDate;
      existing.status = update.status || existing.status;
      existing.source = update.source || existing.source;
      existing.latestUpdate = update.latestUpdate || existing.latestUpdate;
      if (update.notes) existing.notes = existing.notes ? `${existing.notes} ${update.notes}` : update.notes;
      mergeOptionalFields(existing, update);
      results.push({ action: "updated", id: existing.id, company: update.company, role: update.role });
      continue;
    }

    const id = update.id || buildApplicationId();
    const created = {
      id,
      company: update.company,
      role: update.role,
      appliedDate: update.appliedDate,
      status: update.status,
      latestDate: update.latestDate,
      source: update.source,
      latestUpdate: update.latestUpdate,
      notes: update.notes || "",
      emailIds: updateEmailIds,
      recordType: update.recordType || "application"
    };
    mergeOptionalFields(created, update);
    applications.unshift(created);
    results.push({ action: "created", id, company: update.company, role: update.role });
  }

  data.processedEmailIds = uniq([...(data.processedEmailIds || []), ...updates.flatMap((update) => update.emailIds || [])]);

  data.meta = data.meta || {};
  const reportDate = formatLocalDate();
  data.meta.reportDate = reportDate;
  data.meta.lastUpdated = reportDate;
  data.meta.lastUpdatedAt = new Date().toISOString();
  data.meta.lastSuccessfulScanAt = data.meta.lastUpdatedAt;
  data.meta.nextScanMode = "incremental";
  data.meta.fullScanRequestedAt = "";

  return { results, reportDate };
}

async function writeJsonIfUnchanged(filePath, value, expectedRevision) {
  const current = JSON.parse(await fs.readFile(filePath, "utf8"));
  const currentRevision = Number(current.meta?.revision || 0);
  if (currentRevision !== expectedRevision) {
    throw new Error(`Tracker changed during Gmail update. Expected revision ${expectedRevision}, found ${currentRevision}. Reload and run again.`);
  }
  value.meta = value.meta || {};
  value.meta.revision = currentRevision + 1;
  await writeJsonSafely(filePath, value);
}

async function readUpdatesFromStdin() {
  if (process.stdin.isTTY) return [];
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const body = Buffer.concat(chunks).toString("utf8").trim();
  if (!body) return [];
  const parsed = JSON.parse(body);
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed?.updates)) return parsed.updates;
  throw new Error("Expected stdin to be a JSON array of updates or { updates: [...] }.");
}

async function main() {
  const payload = JSON.parse(await fs.readFile(dataPath, "utf8"));
  payload.meta = payload.meta || {};
  const expectedRevision = Number(payload.meta.revision || 0);

  const updates = await readUpdatesFromStdin();
  const { results, reportDate } = applyUpdates(payload, updates);
  await writeJsonIfUnchanged(dataPath, payload, expectedRevision);

  console.log(JSON.stringify({ reportDate, results, processedEmailIds: payload.processedEmailIds.length }, null, 2));
}

await main();
