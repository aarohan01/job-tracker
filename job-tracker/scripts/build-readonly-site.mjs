import fs from "node:fs/promises";
import path from "node:path";

const trackerDir = path.resolve(import.meta.dirname, "..");
const rootDir = path.resolve(trackerDir, "..");
const sourcePath = path.join(trackerDir, "job-tracker.json");
const siteSourceDir = path.join(trackerDir, "readonly-site");
const siteOutputDir = path.join(rootDir, "docs");
const dataDir = path.join(siteOutputDir, "data");
const outputPath = path.join(dataDir, "job-tracker.json");

async function main() {
  await fs.mkdir(siteOutputDir, { recursive: true });
  for (const fileName of [".nojekyll", "index.html", "styles.css", "app.js"]) {
    await fs.copyFile(path.join(siteSourceDir, fileName), path.join(siteOutputDir, fileName));
  }

  await fs.mkdir(dataDir, { recursive: true });
  const data = JSON.parse(await fs.readFile(sourcePath, "utf8"));
  await fs.writeFile(outputPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  console.log(`Updated ${path.relative(rootDir, siteOutputDir)} from ${path.relative(rootDir, siteSourceDir)} and ${path.relative(rootDir, sourcePath)}.`);
}

await main();
