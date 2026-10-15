import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Next already includes Sharp for image optimization; resolve its real workspace dependency.
const require = createRequire(createRequire(import.meta.url).resolve("next/package.json", { paths: [path.join(root, "apps/web")] }));
const sharp = require("sharp");
const icons = path.join(root, "apps/extension/public/icons");
const source = await readFile(path.join(icons, "allhere.svg"), "utf8");
await writeFile(path.join(root, "apps/web/public/icons/allhere.svg"), source);

for (const size of [16, 32, 48, 128]) {
  const inset = size === 128 ? 16 : size === 48 ? 3 : size === 32 ? 2 : 1;
  const mark = await sharp(Buffer.from(source), { density: 288 }).trim().resize(size - inset * 2, size - inset * 2, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: mark, left: inset, top: inset }]).png().toFile(path.join(icons, `allhere-${size}.png`));
}

const promoPath = path.join(root, "docs/chrome-web-store-assets/allhere-small-promo.svg");
const mark = source.match(/<svg[^>]*>([\s\S]*?)<\/svg>/)?.[1].trim();
if (!mark) throw new Error("The canonical Allhere mark must contain SVG artwork.");
const promo = (await readFile(promoPath, "utf8")).replace(
  /(<g id="allhere-mark"[^>]*>)[\s\S]*?(<\/g>)/,
  `$1\n    ${mark.replaceAll("#0b57d0", "#fff")}\n  $2`,
);
await writeFile(promoPath, promo);
await sharp(Buffer.from(promo)).flatten({ background: "#0b57d0" }).removeAlpha().png()
  .toFile(path.join(root, "docs/chrome-web-store-assets/allhere-small-promo-440x280.png"));
console.log("Updated Allhere SVGs, transparent extension icons, and Chrome Web Store promo.");
