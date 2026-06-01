import sharp from "sharp";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const iconsDir = path.resolve(__dirname, "..", "icons");
const svgPath = path.join(iconsDir, "icon.svg");
const sizes = [16, 48, 96, 128];

const svgBuffer = await readFile(svgPath);

for (const size of sizes) {
  await sharp(svgBuffer)
    .resize(size, size)
    .png()
    .toFile(path.join(iconsDir, `icon-${size}.png`));
  process.stdout.write(`Generated icon-${size}.png\n`);
}

process.stdout.write("Done.\n");
