import { cp, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

// Headless browsers cannot click the native toolbar or accept its site dialog.
// Install unchanged built code with only the requested fixture hosts pre-granted.
// The production ZIP has tabs metadata, activeTab, and optional scan/file host
// access, with no required hosts. Negative scan tests use an ungranted host.
export async function localFixtureExtension(profile, urls = ["http://127.0.0.1/"]) {
  const destination = join(profile, "fixture-extension");
  await cp(resolve("apps/extension/out"), destination, { recursive: true });
  const manifestPath = join(destination, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.host_permissions = [...new Set(urls.map(value => {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol) || url.hostname.includes("*")) throw new Error("Fixture access must name a specific HTTP(S) host.");
    return `${url.protocol}//${url.hostname}/*`;
  }))];
  await writeFile(manifestPath, JSON.stringify(manifest));
  return destination;
}
