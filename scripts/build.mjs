import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");
const manifestsDir = path.join(rootDir, "manifests");
const sourceDir = path.join(rootDir, "src");
const targets = ["chrome", "firefox"];

await rm(distDir, { recursive: true, force: true });

for (const target of targets) {
  const targetDir = path.join(distDir, target);
  const manifestPath = path.join(manifestsDir, `${target}.json`);
  const manifestContents = await readFile(manifestPath, "utf8");

  await mkdir(targetDir, { recursive: true });
  await cp(sourceDir, targetDir, { recursive: true });
  await writeFile(path.join(targetDir, "manifest.json"), manifestContents, "utf8");
}

process.stdout.write(`Built extension targets in ${distDir}\n`);
