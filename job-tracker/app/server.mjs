import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { writeJsonSafely } from "../scripts/file-io.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const trackerDir = path.resolve(__dirname, "..");
const dataPath = path.join(trackerDir, "job-tracker.json");
const backupDir = path.join(trackerDir, "backups");
const scriptsDir = path.join(trackerDir, "scripts");
const portFile = path.join(trackerDir, "server.port");
const pidFile = path.join(trackerDir, "server.pid");
let exportQueue = Promise.resolve();

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

function stamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function send(response, status, body, type = "text/plain; charset=utf-8") {
  response.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store"
  });
  response.end(body);
}

async function backupJson() {
  await fs.mkdir(backupDir, { recursive: true });
  try {
    await fs.copyFile(dataPath, path.join(backupDir, `job-tracker-data - ${stamp()}.json`));
  } catch {
    // First run may not have a data file yet.
  }
}

async function exportWorkbook() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(scriptsDir, "build-master-workbook.mjs")], {
      cwd: trackerDir,
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr || stdout || `Export failed with code ${code}`));
    });
  });
}

function queueExportWorkbook() {
  exportQueue = exportQueue.then(exportWorkbook, exportWorkbook);
  return exportQueue;
}

async function serveStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const safePath = path.normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(__dirname, safePath);
  if (!filePath.startsWith(__dirname)) {
    send(response, 403, "Forbidden");
    return;
  }
  try {
    const bytes = await fs.readFile(filePath);
    send(response, 200, bytes, contentTypes[path.extname(filePath)] || "application/octet-stream");
  } catch {
    send(response, 404, "Not found");
  }
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);

    if (request.method === "GET" && url.pathname === "/api/tracker") {
      const json = await fs.readFile(dataPath, "utf8");
      send(response, 200, json, "application/json; charset=utf-8");
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/tracker") {
      const body = await readBody(request);
      const parsed = JSON.parse(body);
      if (!Array.isArray(parsed.needsAttention) || !Array.isArray(parsed.applications)) {
        send(response, 400, "Invalid tracker payload");
        return;
      }
      let current = { meta: {} };
      try {
        current = JSON.parse(await fs.readFile(dataPath, "utf8"));
      } catch {
        // First save can create the tracker file.
      }
      const expectedRevision = Number(parsed.meta?.revision || 0);
      const currentRevision = Number(current.meta?.revision || 0);
      if (expectedRevision !== currentRevision) {
        send(response, 409, JSON.stringify({
          ok: false,
          reason: "revision_conflict",
          currentRevision
        }), "application/json; charset=utf-8");
        return;
      }
      parsed.meta = parsed.meta || {};
      parsed.trash = Array.isArray(parsed.trash) ? parsed.trash : [];
      parsed.permanentlyDeletedItems = Array.isArray(parsed.permanentlyDeletedItems) ? parsed.permanentlyDeletedItems : [];
      parsed.completedActions = Array.isArray(parsed.completedActions) ? parsed.completedActions : [];
      parsed.processedEmailIds = Array.isArray(parsed.processedEmailIds) ? parsed.processedEmailIds : [];
      parsed.meta.scanWindowStart = parsed.meta.scanWindowStart || "2026-04-01";
      parsed.meta.incrementalScanOverlapDays = Number(parsed.meta.incrementalScanOverlapDays || 3);
      if (!["full", "incremental"].includes(parsed.meta.nextScanMode)) {
        parsed.meta.nextScanMode = "incremental";
      }
      parsed.meta.revision = currentRevision + 1;
      await backupJson();
      await writeJsonSafely(dataPath, parsed);
      send(response, 200, JSON.stringify({
        ok: true,
        revision: parsed.meta.revision,
        lastUpdatedAt: parsed.meta.lastUpdatedAt,
        lastUpdated: parsed.meta.lastUpdated
      }), "application/json; charset=utf-8");
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/export-xlsx") {
      const output = await queueExportWorkbook();
      send(response, 200, JSON.stringify({ ok: true, output }), "application/json; charset=utf-8");
      return;
    }

    if (request.method === "GET") {
      await serveStatic(request, response);
      return;
    }

    send(response, 405, "Method not allowed");
  } catch (error) {
    send(response, 500, error.stack || error.message || String(error));
  }
});

function listen(port) {
  server.once("error", (error) => {
    if (error.code === "EADDRINUSE" && process.env.STRICT_PORT === "1") {
      console.error(`Port ${port} is already in use.`);
      process.exit(1);
    }
    if (error.code === "EADDRINUSE" && port < 3010) listen(port + 1);
    else throw error;
  });
  server.listen(port, "127.0.0.1", async () => {
    const address = server.address();
    await fs.writeFile(portFile, String(address.port), "utf8");
    await fs.writeFile(pidFile, String(process.pid), "utf8");
    console.log(`Job Search tracker running at http://localhost:${address.port}`);
  });
}

listen(Number(process.env.PORT || 3000));
