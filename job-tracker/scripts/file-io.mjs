import fs from "node:fs/promises";
import path from "node:path";

const RETRY_DELAYS_MS = [120, 300, 700, 1200, 2000];
const TEMP_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientFileError(error) {
  return ["EACCES", "EBUSY", "EPERM"].includes(error?.code);
}

async function withRetries(operation, label) {
  let lastError;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isTransientFileError(error) || attempt === RETRY_DELAYS_MS.length) break;
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }
  lastError.message = `${label} failed after bounded retries: ${lastError.message}`;
  throw lastError;
}

export function makeJsonTempPath(filePath) {
  const random = Math.random().toString(16).slice(2);
  return `${filePath}.${process.pid}.${Date.now()}.${random}.tmp`;
}

export async function cleanupOldJsonTemps(filePath, maxAgeMs = TEMP_MAX_AGE_MS) {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  let entries = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  const now = Date.now();
  await Promise.all(entries
    .filter((entry) => entry.isFile() && entry.name.startsWith(`${base}.`) && entry.name.endsWith(".tmp"))
    .map(async (entry) => {
      const tempPath = path.join(dir, entry.name);
      try {
        const stat = await fs.stat(tempPath);
        if (now - stat.mtimeMs > maxAgeMs) await fs.unlink(tempPath);
      } catch {
        // Temp cleanup is intentionally best-effort for OneDrive-backed folders.
      }
    }));
}

export async function writeJsonSafely(filePath, value) {
  await cleanupOldJsonTemps(filePath);
  const tempPath = makeJsonTempPath(filePath);
  const body = `${JSON.stringify(value, null, 2)}\n`;

  await withRetries(() => fs.writeFile(tempPath, body, "utf8"), "Temp JSON write");

  try {
    await withRetries(() => fs.rename(tempPath, filePath), "Atomic JSON rename");
    return;
  } catch (error) {
    if (!isTransientFileError(error)) throw error;
    console.warn(`Atomic JSON rename was blocked (${error.code}); using copy-overwrite fallback.`);
  }

  await withRetries(() => fs.copyFile(tempPath, filePath), "JSON copy-overwrite fallback");
  try {
    await fs.unlink(tempPath);
  } catch {
    // Harmless: temp filenames are unique and future reads only use the real JSON file.
  }
}
