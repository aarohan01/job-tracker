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

async function readIdsFromStdin() {
  if (process.stdin.isTTY) return [];
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const body = Buffer.concat(chunks).toString("utf8").trim();
  if (!body) return [];
  const parsed = JSON.parse(body);
  if (Array.isArray(parsed)) return uniq(parsed);
  if (Array.isArray(parsed?.emailIds)) return uniq(parsed.emailIds);
  throw new Error("Expected stdin to be a JSON array or { emailIds: [...] }.");
}

async function main() {
  const payload = JSON.parse(await fs.readFile(dataPath, "utf8"));
  payload.meta = payload.meta || {};

  const expectedRevision = Number(payload.meta.revision || 0);
  const emailIds = await readIdsFromStdin();
  payload.processedEmailIds = uniq([...(payload.processedEmailIds || []), ...emailIds]);

  const now = new Date().toISOString();
  const reportDate = formatLocalDate();
  payload.meta.reportDate = reportDate;
  payload.meta.lastUpdated = reportDate;
  payload.meta.lastUpdatedAt = now;
  payload.meta.lastSuccessfulScanAt = now;
  payload.meta.nextScanMode = "incremental";
  payload.meta.fullScanRequestedAt = "";

  const current = JSON.parse(await fs.readFile(dataPath, "utf8"));
  const currentRevision = Number(current.meta?.revision || 0);
  if (currentRevision !== expectedRevision) {
    throw new Error(`Tracker changed during processed-email update. Expected revision ${expectedRevision}, found ${currentRevision}. Reload and run again.`);
  }

  payload.meta.revision = currentRevision + 1;
  await writeJsonSafely(dataPath, payload);

  console.log(JSON.stringify({
    reportDate,
    processedEmailIdsAdded: emailIds.length,
    processedEmailIdsTotal: payload.processedEmailIds.length,
    revision: payload.meta.revision
  }, null, 2));
}

await main();
