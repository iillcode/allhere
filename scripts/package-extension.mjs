import { createRequire } from "node:module";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

const require = createRequire(new URL("../packages/library-ui/package.json", import.meta.url));
const { zipSync, unzipSync } = require("fflate");
const root = resolve("apps/extension/out");
const destination = resolve("apps/web/public/downloads/allhere-extension.zip");
const files = {};

async function addFiles(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await addFiles(path);
    else if (entry.isFile()) files[relative(root, path).split(sep).join("/")] = new Uint8Array(await readFile(path));
    else throw new Error(`Unexpected release entry: ${path}`);
  }
}

await addFiles(root);
if (!files["manifest.json"] || !files["index.html"] || !files["service-worker.js"]) {
  throw new Error("Build the extension before packaging it. The ZIP needs manifest.json at its root.");
}
const manifest = JSON.parse(Buffer.from(files["manifest.json"]).toString());
if (manifest.manifest_version !== 3 || !manifest.version) throw new Error("The built extension manifest is invalid.");
for (const file of Object.values(manifest.icons ?? {})) {
  if (!files[file]) throw new Error(`The manifest icon is missing: ${file}`);
}
const archive = zipSync(files, { level: 9 });
const unpacked = unzipSync(archive);
if (Object.keys(unpacked).length !== Object.keys(files).length || !unpacked["manifest.json"]) {
  throw new Error("The ZIP did not preserve the extension files at its root.");
}
await mkdir(resolve("apps/web/public/downloads"), { recursive: true });
await writeFile(destination, archive);
console.log(`Packaged Allhere ${manifest.version}: ${Object.keys(files).length} files, ${archive.length} bytes`);
console.log(destination);
