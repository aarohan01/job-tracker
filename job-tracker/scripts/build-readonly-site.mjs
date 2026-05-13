import fs from "node:fs/promises";
import path from "node:path";

const trackerDir = path.resolve(import.meta.dirname, "..");
const rootDir = path.resolve(trackerDir, "..");
const sourcePath = path.join(trackerDir, "job-tracker.json");
const dataDir = path.join(rootDir, "docs", "data");
const outputPath = path.join(dataDir, "job-tracker.json");

async function main() {
  await fs.mkdir(dataDir, { recursive: true });
  const data = JSON.parse(await fs.readFile(sourcePath, "utf8"));
  await fs.writeFile(outputPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  console.log(`Updated ${path.relative(rootDir, outputPath)} from ${path.relative(rootDir, sourcePath)}.`);
}

await main();
