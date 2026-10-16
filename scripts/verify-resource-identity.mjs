import assert from "node:assert/strict";
import { dedupeResources, resourceIdentity, resourceIdentityKeys, mergeCaptures, upsertPageCapture, parseArchive, createArchive } from "../packages/core/src/index.ts";

const capturedAt = "2026-01-01T00:00:00.000Z";
const resource = (id, url, extras = {}) => ({ id, kind: "image", url, label: "Image", pageUrl: "https://example.com/app", pageTitle: "App", capturedAt, ...extras });
const capture = (id, resources) => ({ id, pageUrl: "https://example.com/app", pageTitle: "App", hostname: "example.com", capturedAt, resources });
const small = resource("stable", "https://cdn.example.com/photo.png?w=100&utm_source=app", { width: 100, height: 100, saved: true, alt: "Source description" });
const large = resource("new", "https://cdn.example.com/photo.png?W=500", { width: 500, height: 500, label: "A landscape", kind: "icon" });
const merged = dedupeResources([small, large]);
assert.equal(merged.length, 1);
assert.equal(merged[0].id, "stable");
assert.equal(merged[0].url, large.url);
assert.equal(merged[0].saved, true);
assert.equal(merged[0].kind, "icon");
assert.equal(merged[0].alt, "Source description");
assert.equal(merged[0].label, "A landscape");

for (const urls of [
  ["https://cdn.example.com/sprite.svg#one", "https://cdn.example.com/sprite.svg#two"],
  ["https://cdn.example.com/asset#one", "https://cdn.example.com/asset#two"],
  ["https://cdn.example.com/file.png?sig=a&w=100", "https://cdn.example.com/file.png?sig=b&w=100"],
  ["https://cdn.example.com/file.png?sig=a&w=100", "https://cdn.example.com/file.png?sig=a&w=200"],
  ["https://cdn.example.com/file.png?X-Amz-Signature=a&w=100", "https://cdn.example.com/file.png?X-Amz-Signature=a&w=200"],
  ["https://cdn.example.com/file.png?crop=left", "https://cdn.example.com/file.png?crop=right"],
  ["https://cdn.example.com/file.png?asset=1", "https://cdn.example.com/file.png?asset=2"],
  ["data:image/svg+xml,<svg>one?width=100</svg>", "data:image/svg+xml,<svg>two?width=100</svg>"],
]) assert.equal(dedupeResources(urls.map((url, i) => resource(String(i), url))).length, 2, `Distinct assets were collapsed: ${urls}`);
assert.equal(resourceIdentity(resource("one", "https://cdn.example.com/asset#one")), resourceIdentity(resource("two", "https://cdn.example.com/asset#one", { kind: "icon" })));

const later = resource("later", "https://cdn.example.com/later.png");
const pages = mergeCaptures([capture("first", [small])], [capture("imported", [large, later])]);
assert.equal(pages.length, 1, "Importing a different capture ID of the same page must not create another page");
assert.equal(pages[0].id, "first");
assert.equal(pages[0].resources.length, 2);
assert.equal(pages[0].resources[0].id, "stable");
assert.equal(pages[0].resources[0].saved, true);
const updated = upsertPageCapture(pages, capture("rescan", [later]));
assert.deepEqual(updated[0].resources.map(item => item.id), ["later", "stable"], "Latest order and older resources must survive");
assert.deepEqual(upsertPageCapture(updated, capture("again", [later])), updated, "An identical rescan must be stable");
const repaired = upsertPageCapture([capture("first", [small]), capture("legacy-duplicate", [later])], capture("rescan", [large]));
assert.equal(repaired.length, 1);
assert.equal(repaired[0].resources.length, 2, "Repairing legacy duplicate pages must not lose their unique items");
assert.equal(parseArchive(createArchive([capture("archive", [small, large])])).captures[0].resources.length, 1);

const stashwellArchive = createArchive([capture("brand-upgrade", [small, large])]);
assert.equal(stashwellArchive.format, "stashwell-library", "New exports use the Stashwell format");
const legacyArchive = parseArchive({ ...stashwellArchive, format: "allhere-library" });
assert.equal(legacyArchive.format, "stashwell-library", "Legacy backups normalize to Stashwell on import");
assert.equal(legacyArchive.captures[0].resources[0].id, small.id);
assert.equal(legacyArchive.captures[0].resources[0].saved, true, "Legacy backup bookmarks survive the rename");
assert.throws(() => parseArchive({ ...stashwellArchive, format: "unrelated-library" }), /supported Stashwell/);

// Responsive declarations can relate different paths, formats, crops or signed
// URLs. Those relationships must repair old captures without guessing by label.
const urls = [
  "https://cdn.example.com/thumb/photo-100.jpg?crop=square",
  "https://cdn.example.com/medium/photo-500.webp?token=medium",
  "https://cdn.example.com/full/photo-1200.avif?token=full",
];
const legacy = [
  resource("legacy-earliest", urls[0], { width: 100, height: 100, alt: "A lake", mimeType: "image/jpeg" }),
  resource("legacy-saved", urls[1], { width: 500, height: 500, saved: true, description: "Lake at sunset" }),
  resource("legacy-largest", urls[2], { width: 1200, height: 1200, label: "Mountain lake" }),
];
const responsive = resource("responsive", urls[2], { identityUrl: urls[1], variantUrls: urls, width: 1200, height: 1200 });
const repairedResponsive = dedupeResources([...legacy, responsive]);
assert.equal(repairedResponsive.length, 1, "A declared responsive group must repair three legacy entries");
assert.equal(repairedResponsive[0].id, legacy[0].id, "The earliest stable ID survives a bridging merge");
assert.equal(repairedResponsive[0].saved, true, "Bookmarks from any legacy rendition survive");
assert.equal(repairedResponsive[0].url, urls[2], "Keep the highest-resolution download source");
assert.equal(repairedResponsive[0].identityUrl, urls[0], "The retained canonical identity cannot drift on rescan");
assert.equal(repairedResponsive[0].alt, "A lake");
assert.equal(repairedResponsive[0].description, "Lake at sunset");
assert.equal(repairedResponsive[0].label, "Mountain lake");
assert.equal(repairedResponsive[0].mimeType, undefined, "Do not copy another rendition's MIME type to a different format");
assert.deepEqual(new Set(repairedResponsive[0].variantUrls), new Set(urls));
assert.deepEqual(dedupeResources([...repairedResponsive, responsive]), repairedResponsive, "Repeated scans keep IDs, aliases and canonical identity stable");
assert.deepEqual(dedupeResources([...repairedResponsive, ...legacy]), repairedResponsive, "Importing legacy renditions cannot recreate duplicates");
assert.equal(resourceIdentity(responsive), resourceIdentity(resource("canonical", urls[1])));
assert.equal(resourceIdentityKeys(responsive).length, 3);
assert.deepEqual(resourceIdentityKeys({ ...responsive, kind: "link" }), [`link:${urls[2]}`], "Nonvisual kinds cannot borrow responsive aliases");

const fourth = "https://cdn.example.com/fourth.jpg";
const transitive = dedupeResources([
  resource("a", urls[0], { variantUrls: [urls[1]] }),
  resource("c", urls[2], { variantUrls: [fourth], saved: true }),
  resource("bridge", urls[1], { variantUrls: [urls[2]] }),
]);
assert.equal(transitive.length, 1, "Explicit aliases must merge transitively across two existing groups");
assert.equal(transitive[0].id, "a");
assert.equal(transitive[0].saved, true);
assert.equal(transitive[0].variantUrls.length, 4);
assert.equal(dedupeResources(legacy).length, 3, "Equal labels or dimensions do not imply aliases");

const orderedResponsive = mergeCaptures([capture("original", [...legacy, later])], [capture("rescan", [responsive, later])]);
assert.deepEqual(orderedResponsive[0].resources.map(item => item.id), ["legacy-earliest", "later"], "Latest order maps alias URLs back to retained records");
assert.ok(orderedResponsive[0].resources.every(Boolean), "Ordering a differently canonicalized rescan must never introduce undefined resources");
assert.deepEqual(upsertPageCapture(orderedResponsive, capture("again", [responsive, later])), orderedResponsive);
const reordered = upsertPageCapture(orderedResponsive, capture("again", [later, resource("legacy-rescan", urls[1])]));
assert.deepEqual(reordered[0].resources.map(item => item.id), ["later", "legacy-earliest"]);
assert.equal(reordered[0].resources[1].saved, true);

const archiveResponsive = parseArchive(createArchive([capture("archive", [responsive])]));
assert.equal(archiveResponsive.captures[0].resources[0].identityUrl, responsive.identityUrl);
assert.deepEqual(new Set(archiveResponsive.captures[0].resources[0].variantUrls), new Set(urls));
const repairedImport = mergeCaptures([capture("original", legacy)], archiveResponsive.captures);
assert.equal(repairedImport[0].resources.length, 1);
assert.equal(repairedImport[0].resources[0].id, "legacy-earliest");
assert.equal(repairedImport[0].resources[0].saved, true);
assert.deepEqual(mergeCaptures(repairedImport, archiveResponsive.captures), repairedImport, "Repeated import preserves the repaired record");

const invalidAliases = resource("invalid", urls[0], { identityUrl: "javascript:alert(1)", variantUrls: [urls[1], null, 7, "bad-url", "javascript:alert(1)", "data:text/html,<script/>"] });
const validated = parseArchive(createArchive([capture("archive", [invalidAliases])]));
assert.equal(validated.captures[0].resources[0].identityUrl, urls[0]);
assert.deepEqual(new Set(validated.captures[0].resources[0].variantUrls), new Set(urls.slice(0, 2)));
assert.deepEqual(resourceIdentityKeys(resource("invalid-only", urls[0], { identityUrl: 4, variantUrls: [null, {}, "javascript:alert(1)"] })), [resourceIdentity(legacy[0])]);
console.log("PASS resource identity: conservative URLs, explicit responsive aliases, transitive bridges, stable IDs/bookmarks, rescans/imports, validated archives, ordering, and retained resources.");
