import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import webExt from "web-ext";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");
const manifestsDir = path.join(rootDir, "manifests");
const sourceDir = path.join(rootDir, "src");
const iconsDir = path.join(rootDir, "icons");
const targets = ["chrome", "firefox"];

await rm(distDir, { recursive: true, force: true });

for (const target of targets) {
  const targetDir = path.join(distDir, target);
  const manifestPath = path.join(manifestsDir, `${target}.json`);
  const manifestContents = await readFile(manifestPath, "utf8");
  const { version } = JSON.parse(manifestContents);

  await mkdir(targetDir, { recursive: true });
  await cp(sourceDir, targetDir, { recursive: true });
  await cp(iconsDir, path.join(targetDir, "icons"), { recursive: true });
  await writeFile(path.join(targetDir, "manifest.json"), manifestContents, "utf8");

  // Store-ready package with manifest.json at the archive root
  // (hidden files such as .DS_Store are left out by web-ext).
  const { extensionPath } = await webExt.cmd.build(
    {
      sourceDir: targetDir,
      artifactsDir: distDir,
      filename: `komoot-gpx-${target}-${version}.zip`,
      overwriteDest: true
    },
    { shouldExitProgram: false, showReadyMessage: false }
  );

  process.stdout.write(`Packaged ${path.relative(rootDir, extensionPath)}\n`);
}

process.stdout.write(`Built extension targets in ${distDir}\n`);
