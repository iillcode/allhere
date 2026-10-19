// Refresh store artwork without changing the website's independently approved logo.
// Screenshots use the real installed build and a clearly named, local sample page.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(createRequire(import.meta.url).resolve("next/package.json", { paths: [path.join(root, "apps/web")] }));
const sharp = require("sharp");
const extensionRequire = createRequire(path.join(root, "apps/extension/package.json"));
const { zipSync, strToU8 } = extensionRequire("fflate");
const directory = path.join(root, "docs/chrome-web-store-assets");
await mkdir(directory, { recursive: true });
const mark = await readFile(path.join(root, "apps/extension/public/icons/stashwell.svg"), "utf8");
const artwork = mark.match(/<svg[^>]*>([\s\S]*?)<\/svg>/)?.[1];
assert(artwork, "The current extension logo must contain SVG artwork.");
const promoPath = path.join(directory, "stashwell-small-promo.svg");
const oldPromo = await readFile(promoPath, "utf8");
const promo = oldPromo.replace(/(<g id="stashwell-mark"[^>]*>)[\s\S]*?(<\/g>)(?=\s*<text)/,
  `$1${artwork.replaceAll("#0b57d0", "#fff")}$2`);
assert(promo.includes(artwork.replaceAll("#0b57d0", "#fff")), "The promo must use the current extension mark.");
await writeFile(promoPath, promo);
await sharp(Buffer.from(promo)).flatten({ background: "#0b57d0" }).removeAlpha().png()
  .toFile(path.join(directory, "stashwell-small-promo-440x280.png"));
await copyFile(path.join(root, "apps/extension/public/icons/stashwell-128.png"), path.join(directory, "stashwell-store-icon-128.png"));

const fixtures = new Map([
  ["/favicon.svg", { type: "image/svg+xml", bytes: Buffer.from(mark) }],
  ["/studio.jpg", { type: "image/jpeg", bytes: await readFile(path.join(root, "apps/web/public/images/studio-workspace-generated.jpg")) }],
]);
// Original geometric sample artwork; these are actual page assets, not UI mockups.
const studies = [
  ["fold", "#d9eee7", '<path d="M0 280 280 0h200L0 480Z" fill="#26736c"/><path d="m220 0 260 260v220L0 0Z" fill="#a0cabe"/>'],
  ["blue", "#dce6fb", '<circle cx="240" cy="180" r="160" fill="#0b57d0"/><path d="M80 180h320v220H80z" fill="#7ba6ee"/><circle cx="240" cy="180" r="80" fill="#dce6fb"/>'],
  ["sun", "#f6dfbb", '<circle cx="240" cy="180" r="120" fill="#dc764b"/><path d="M0 320 240 200l240 120v160H0Z" fill="#edac6b"/><path d="m0 420 240-120 240 120v60H0Z" fill="#a75035"/>'],
  ["lilac", "#e9e1f1", '<path d="M80 400V200a160 160 0 0 1 320 0v200" fill="#8d72aa"/><path d="M150 400V200a90 90 0 0 1 180 0v200" fill="#c6afd9"/><path d="M220 400V200a20 20 0 0 1 40 0v200" fill="#e9e1f1"/>'],
  ["colour", "#f4eee2", '<path d="M40 40h180v180H40z" fill="#c86345"/><circle cx="330" cy="130" r="90" fill="#6b9183"/><path d="m130 260 90 180H40Z" fill="#c2ab63"/><path d="M240 260h180v180H240z" fill="#6c86b3"/>'],
];
for (const [name, background, shapes] of studies) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="480" viewBox="0 0 480 480"><rect width="480" height="480" fill="${background}"/>${shapes}</svg>`;
  fixtures.set(`/${name}.png`, { type: "image/png", bytes: await sharp(Buffer.from(svg)).png().toBuffer() });
}
const pictures = [["studio.jpg", "Studio workspace"], ["fold.png", "Fold study"], ["blue.png", "Blue forms"], ["sun.png", "Warm shapes"], ["lilac.png", "Lilac arches"], ["colour.png", "Colour studies"]];
fixtures.set("/", { type: "text/html", bytes: Buffer.from(`<!doctype html><html lang="en"><meta charset="utf-8"><title>Stashwell sample collection</title><link rel="icon" href="/favicon.svg"><style>body{font:16px Arial,sans-serif;margin:40px;color:#1f1f1f}main{max-width:1000px;margin:auto}.gallery{display:grid;grid-template-columns:repeat(3,1fr);gap:24px}figure{margin:0}img{display:block;width:100%;height:180px;object-fit:cover}figcaption{margin-top:8px}svg{width:32px;height:32px;margin:12px}</style><main><h1>Stashwell sample collection</h1><p>Sample images and icons for the Stashwell store screenshots.</p><div class="gallery">${pictures.map(([url, label]) => `<figure><img src="/${url}" alt="${label}"><figcaption>${label}</figcaption></figure>`).join("")}</div><h2>Sample vector icons</h2><svg aria-label="Bookmark icon" viewBox="0 0 24 24" fill="none" stroke="#0b57d0" stroke-width="2"><path d="M6 3h12v18l-6-4-6 4Z"/></svg><svg aria-label="Image icon" viewBox="0 0 24 24" fill="none" stroke="#26736c" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 16-5-5L5 21"/></svg><svg aria-label="Folder icon" viewBox="0 0 24 24" fill="none" stroke="#9a5d00" stroke-width="2"><path d="M3 7h7l2-3h9v16H3Z"/></svg></main></html>`) });
const server = createServer((request, response) => {
  const fixture = fixtures.get(new URL(request.url, "http://localhost").pathname);
  if (!fixture) { response.writeHead(404).end(); return; }
  response.writeHead(200, { "Content-Type": fixture.type, "Access-Control-Allow-Origin": "*" });
  response.end(fixture.bytes);
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
try {
  for (const [view, scroll] of [["images", 0], ["images", 140], ["download-formats", 140]]) {
    await new Promise((done, reject) => {
      const child = spawn(process.execPath, ["scripts/capture-store-screenshot.mjs"], { cwd: root, windowsHide: true, stdio: "inherit", env: {
        ...process.env, STASHWELL_WEB_URL: `http://127.0.0.1:${server.address().port}/`, STASHWELL_SCREENSHOT_SOURCE: "installed",
        STASHWELL_SCREENSHOT_WIDTH: "640", STASHWELL_SCREENSHOT_HEIGHT: "400", STASHWELL_SCREENSHOT_SCALE: "2",
        STASHWELL_SCREENSHOT_VIEW: view, STASHWELL_SCREENSHOT_SCROLL_Y: String(scroll),
      } });
      child.once("error", reject);
      child.once("exit", code => code === 0 ? done() : reject(new Error(`Store screenshot capture exited with ${code}.`)));
    });
    const base = `stashwell-screenshot-${view}${scroll ? "-scrolled" : ""}`;
    const rgb = await sharp(path.join(directory, `${base}-1280x800.png`)).flatten({ background: "#ffffff" }).removeAlpha().png().toBuffer();
    await writeFile(path.join(directory, `${base}-1280x800.png`), rgb);
    await sharp(rgb).resize(640, 400).removeAlpha().png().toFile(path.join(directory, `${base}-640x400.png`));
  }
} finally { await new Promise(done => server.close(done)); }

const readme = `# Stashwell Chrome Web Store images\n\nCategory: Developer Tools\nLanguage: English (United States)\nStore title: Stashwell — Web Media Downloader\n\nUpload stashwell-store-icon-128.png as the store icon and stashwell-small-promo-440x280.png as the small promo tile.\n\nUpload the three 1280x800 screenshots, in this order:\n1. stashwell-screenshot-images-1280x800.png\n2. stashwell-screenshot-images-scrolled-1280x800.png\n3. stashwell-screenshot-download-formats-scrolled-1280x800.png\n\nThe matching 640x400 files are smaller alternatives; upload one size per screenshot.\nThe SVG is the editable source for the small promo tile.\n\nThese are real captures of the current installed extension with its approved twin-fold S logo and Stashwell name. The gallery is an explicitly named local sample collection; its source hostname is intentionally localhost, not a fabricated public website. The sample images and icons are genuinely scanned from that page. No UI or resource counts are painted onto the screenshots. The existing live website still uses the older Allhere brand.\n\nRegenerate after building: pnpm --filter @stashwell/extension build, then node scripts/generate-store-assets.mjs. This only updates store assets; it does not change website branding or extension permissions.\n`;
await writeFile(path.join(directory, "README.md"), readme);
const filenames = ["stashwell-store-icon-128.png", "stashwell-small-promo-440x280.png", "stashwell-small-promo.svg",
  ...["images", "images-scrolled", "download-formats-scrolled"].flatMap(view => [640, 1280].map(width => `stashwell-screenshot-${view}-${width}x${width * 5 / 8}.png`))];
const archive = { "README.md": strToU8(readme) };
for (const filename of filenames) {
  const bytes = await readFile(path.join(directory, filename));
  if (filename.endsWith(".png")) {
    const { width, height, hasAlpha } = await sharp(bytes).metadata();
    const expected = filename.match(/(\d+)x(\d+)\.png$/);
    assert.equal(width, expected ? Number(expected[1]) : 128);
    assert.equal(height, expected ? Number(expected[2]) : 128);
    if (!filename.includes("store-icon")) assert.equal(hasAlpha, false, `${filename} must be RGB.`);
    console.log(`${filename}: ${width}×${height}${hasAlpha ? ", transparent" : ", RGB"}`);
  }
  archive[filename] = new Uint8Array(bytes);
}
await writeFile(path.join(directory, "stashwell-store-assets.zip"), zipSync(archive));
console.log("Created docs/chrome-web-store-assets/stashwell-store-assets.zip");
