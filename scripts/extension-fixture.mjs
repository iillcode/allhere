import { cp, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

// Headless browsers cannot accept Chrome's native optional-permission dialog.
// Install the unchanged built code with only the local fixture host pre-granted.
// The production manifest remains optional; tests separately assert scope,
// denied permission handling, and that requests carry a user gesture.
export async function localFixtureExtension(profile) {
  const destination = join(profile, "fixture-extension");
  await cp(resolve("apps/extension/out"), destination, { recursive: true });
  const manifestPath = join(destination, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.host_permissions = ["http://127.0.0.1/*"];
  await writeFile(manifestPath, JSON.stringify(manifest));
  return destination;
}
