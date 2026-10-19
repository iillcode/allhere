import { createRequire } from "node:module";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Next already includes Sharp for image optimization; resolve its real workspace dependency.
const require = createRequire(createRequire(import.meta.url).resolve("next/package.json", { paths: [path.join(root, "apps/web")] }));
const sharp = require("sharp");
const icons = path.join(root, "apps/extension/public/icons");
const source = await readFile(path.join(icons, "stashwell.svg"), "utf8");
const mark = source.match(/<svg[^>]*>([\s\S]*?)<\/svg>/)?.[1].trim();
if (!mark) throw new Error("The canonical Stashwell mark must contain SVG artwork.");

function replaceArtworkGroup(svg, id, artwork) {
  const opening = new RegExp(`<g\\b[^>]*\\bid="${id}"[^>]*>`).exec(svg);
  if (!opening) throw new Error(`The SVG artwork group is missing: ${id}`);
  const contentStart = opening.index + opening[0].length;
  const groups = /<\/?g\b[^>]*>/g;
  groups.lastIndex = contentStart;
  let depth = 1;
  for (let group; (group = groups.exec(svg));) {
    if (group[0].startsWith("</")) depth -= 1;
    else if (!group[0].endsWith("/>")) depth += 1;
    if (depth === 0) return svg.slice(0, contentStart) + artwork + svg.slice(group.index);
  }
  throw new Error(`The SVG artwork group is not closed: ${id}`);
}

async function generateExtensionIcons() {
  for (const size of [16, 32, 48, 128]) {
    const inset = size === 128 ? 16 : size === 48 ? 3 : size === 32 ? 2 : 1;
    const artwork = await sharp(Buffer.from(source), { density: 288 }).trim().resize(size - inset * 2, size - inset * 2, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
    await sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: artwork, left: inset, top: inset }])
      .withMetadata({ exif: { IFD0: { ImageDescription: "Stashwell extension icon rendered from apps/extension/public/icons/stashwell.svg." } } })
      .png().toFile(path.join(icons, `stashwell-${size}.png`));
  }
}

// An extension-only refresh must not replace website or store artwork.
if (process.argv.includes("--extension-only")) {
  await generateExtensionIcons();
  console.log("Updated transparent Stashwell extension icons (16, 32, 48, and 128px).");
  process.exit(0);
}

await writeFile(path.join(root, "apps/web/public/icons/stashwell.svg"), source);
const brand = path.join(root, "apps/web/public/brand");
await mkdir(brand, { recursive: true });
await copyFile(path.join(root, "apps/extension/public/fonts/geist-OFL.txt"), path.join(brand, "geist-OFL.txt"));
await writeFile(path.join(brand, "stashwell-mark.svg"), source);
const whiteMark = source.replaceAll("#0b57d0", "#ffffff");
await writeFile(path.join(brand, "stashwell-mark-white.svg"), whiteMark);
for (const [name, svg] of [["stashwell-mark", source], ["stashwell-mark-white", whiteMark]]) {
  await sharp(Buffer.from(svg), { density: 576 }).resize(512, 512).png().toFile(path.join(brand, `${name}.png`));
}
const wordmark = replaceArtworkGroup(
  await readFile(path.join(brand, "stashwell-logo.svg"), "utf8"),
  "stashwell-logo-mark",
  mark,
);
await writeFile(path.join(brand, "stashwell-logo.svg"), wordmark);
const whiteWordmark = wordmark.replaceAll("#0b57d0", "#ffffff").replaceAll("#1f1f1f", "#ffffff");
await writeFile(path.join(brand, "stashwell-logo-white.svg"), whiteWordmark);
await sharp(Buffer.from(wordmark), { density: 192 }).png().toFile(path.join(brand, "stashwell-logo.png"));
await sharp(Buffer.from(whiteWordmark), { density: 192 }).png().toFile(path.join(brand, "stashwell-logo-white.png"));
await sharp(Buffer.from(wordmark), { density: 192 })
  .flatten({ background: "#ffffff" })
  .extend({ top: 24, bottom: 24, left: 32, right: 32, background: "#ffffff" })
  .png().toFile(path.join(brand, "stashwell-logo-preview.png"));

if (process.argv.includes("--web-only")) {
  console.log("Updated Stashwell website icons and blue/white SVG and PNG logos.");
  process.exit(0);
}

await generateExtensionIcons();

const promoPath = path.join(root, "docs/chrome-web-store-assets/stashwell-small-promo.svg");
const promo = replaceArtworkGroup(
  await readFile(promoPath, "utf8"),
  "stashwell-mark",
  `\n    ${mark.replaceAll("#0b57d0", "#fff")}\n  `,
);
await writeFile(promoPath, promo);
await sharp(Buffer.from(promo)).flatten({ background: "#0b57d0" }).removeAlpha().png()
  .toFile(path.join(root, "docs/chrome-web-store-assets/stashwell-small-promo-440x280.png"));
console.log("Updated Stashwell logos, light/dark variants, transparent extension icons, and Chrome Web Store promo.");
