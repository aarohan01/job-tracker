import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { cleanupOldJsonTemps, makeJsonTempPath, writeJsonSafely } from "../scripts/file-io.mjs";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "job-tracker-file-io-"));

try {
  const target = path.join(root, "job-tracker.json");
  await writeJsonSafely(target, { meta: { revision: 1 }, applications: [] });

  const saved = JSON.parse(await fs.readFile(target, "utf8"));
  assert.equal(saved.meta.revision, 1);

  const firstTemp = makeJsonTempPath(target);
  const secondTemp = makeJsonTempPath(target);
  assert.notEqual(firstTemp, secondTemp);
  assert.match(firstTemp, /job-tracker\.json\.\d+\.\d+\.[a-f0-9]+\.tmp$/);

  const oldTemp = path.join(root, "job-tracker.json.old.tmp");
  await fs.writeFile(oldTemp, "stale", "utf8");
  const oldDate = new Date(Date.now() - 48 * 60 * 60 * 1000);
  await fs.utimes(oldTemp, oldDate, oldDate);

  const freshTemp = path.join(root, "job-tracker.json.fresh.tmp");
  await fs.writeFile(freshTemp, "fresh", "utf8");

  await cleanupOldJsonTemps(target);
  assert.equal(await exists(oldTemp), false);
  assert.equal(await exists(freshTemp), true);

  console.log("file-io tests passed");
} finally {
  await fs.rm(root, { recursive: true, force: true });
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
