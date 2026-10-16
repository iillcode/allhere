# Stashwell Chrome Web Store submission

## Release package

Build from the repository root with `pnpm build`, then run `pnpm package:extension`. Upload `apps/web/public/downloads/stashwell-extension.zip`. The ZIP must contain `manifest.json` at its root. The current manifest version is `0.1.12`; increase it before every later package upload. Upload this package to the existing store item to replace the previous draft. This release renames the application to Stashwell and uses its folded S logo throughout the extension and website. Saved libraries and earlier JSON backups remain compatible. The Manage list retains each saved site’s favicon. Older pages without a saved favicon URL try their own site’s /favicon.ico; unavailable icons retain the globe fallback. Icons load using existing access without a permission prompt or third-party lookup service. Existing stored libraries, automatic updates after the first manual scan, webpage image order, and source image dimensions are retained. No extension permission is added.

**Privacy-policy URL:** https://allhere-ten.vercel.app/privacy

**Support email:** business.adilsha@gmail.com

## Store images

- Required 128 × 128 px icon: `apps/extension/public/icons/stashwell-128.png` (included in the ZIP).
- Required 440 × 280 px small promotional image: `docs/chrome-web-store-assets/stashwell-small-promo-440x280.png`. Its editable source is the adjacent `.svg` file.
- Installed-extension UI screenshots, each 640 × 400 px: `docs/chrome-web-store-assets/stashwell-screenshot-images-640x400.png` (shows the toolbar/scan instruction), `docs/chrome-web-store-assets/stashwell-screenshot-images-scrolled-640x400.png`, and `docs/chrome-web-store-assets/stashwell-screenshot-download-formats-scrolled-640x400.png`.

The screenshots show the rebuilt Stashwell extension after a requested scan of the local Stashwell homepage in an isolated browser profile. Regenerate against the published site before submitting store artwork. The capture harness pre-grants only the chosen homepage host because a headless browser cannot click Chrome's native toolbar icon; the production ZIP grants no required hosts. To regenerate them, set `STASHWELL_WEB_URL=https://allhere-ten.vercel.app/` and run `node scripts/capture-store-screenshot.mjs` for the gallery; set `STASHWELL_SCREENSHOT_SCROLL_Y=0` for the toolbar/scan instruction view; set `STASHWELL_SCREENSHOT_VIEW=download-formats` and `STASHWELL_SCREENSHOT_SCROLL_Y=140` for the format menu. Check each screenshot before uploading it. For store submission, the source label should show the published hostname. The existing deployment hostname remains unchanged until the hosting project is renamed; deploy the updated Stashwell site there before submitting.

## Store listing copy

**Single purpose:** Stashwell collects resources from webpages the user chooses to scan and organizes them in a local library for reviewing, saving, copying, and downloading.

**Detailed description:**

Stashwell turns webpage resources into an organized local library in Chrome's side panel. Click Stashwell's toolbar icon, then Scan page to collect source page addresses and titles, images, icons, fonts, links, direct video/audio, and downloadable files. The panel explains before scanning that this action also enables automatic resource updates for that tab while the panel is open and visible. Close Stashwell to stop automatic updates. Updates apply only to the active, previously scanned tab and may follow navigation within the same origin. A new tab, another origin, permission loss, or a reopened panel requires a new manual scan. Scanning uses temporary tab access and never requests persistent website permission.

Browse by resource type, save useful items, inspect previews, copy addresses, and download individual files or a ZIP of selected resources. Direct video and audio files are supported; YouTube videos are not extracted or downloaded.

Image previews and downloads keep their source dimensions. Download images in their original format or convert them locally to PNG, JPEG, or WebP. Icons also support SVG. The same format choices are available for bulk ZIP downloads.

Stashwell stores page addresses, resource details, selected previews, and download status locally in Chrome's extension storage. It does not sync your library to an Stashwell account or send it to an Stashwell analytics service. Opening previews or downloading files may contact the resources' original hosts; file actions can ask you to allow access to those specific hosts. Exporting a JSON archive or dragging a chosen file to a website shares that data only when you take that action. See the published Stashwell privacy policy for details.

**Reviewer instructions:** Open a normal HTTP/HTTPS webpage, click Stashwell's toolbar icon, and read the short automatic-update hint in the Source page line (the hint and Scan page tooltips explain its scope). Opening the panel must not scan. Choose Scan page, then add or load resources on that page: its collection updates automatically. Add a second resource and verify that it is collected without another click. Scan again performs an additional manual refresh while automatic updates remain enabled. An unscanned tab must remain manual even if file access to its host was previously allowed. A previously scanned tab can resume when active; same-origin navigation can update, while cross-origin navigation ends consent. Hiding or closing the panel ends authorization; showing it again requires another manual scan. Manage pauses capture and automatic updates never restore deleted items. Test copying, downloading, and bulk ZIP actions separately; these may request original resource-host access. No account is required.

## Privacy practices and permission justifications

Verify that `https://allhere-ten.vercel.app/privacy` describes the first manual scan enabling limited automatic updates, the compact scan hint and closing the panel to stop updates, temporary toolbar access, and optional file-host access. Disclose Website content, Web history for captured source/resource addresses, and User activity for saved choices/download status. Keep the listing, privacy fields, permission justifications, and in-product disclosure consistent; local storage does not mean no user data is handled.

| Access | Why Stashwell uses it |
| --- | --- |
| Optional HTTP and HTTPS host access | User-requested downloads, ZIPs, enlarged-image preview preparation, SVG copying, and drag preparation request only selected resources' original hosts. Opening a preview never requests permission automatically; choosing a size or retrying can request its image host. No required all-site access or runtime wildcard request is made. A file-host grant never enables scanning automatically; every tab still needs a successful manual scan before automatic updates. |
| `activeTab` | The toolbar gives temporary access to that tab. Available metadata shows its favicon and scan state. Its first successful manual scan, with prior in-panel disclosure, enables automatic updates only while that tab is active and the panel is visible. Authorization is kept in memory; another origin, lost access, or panel hiding or closure ends authorization. No broad tabs permission or History API is used. |
| `scripting` | Collect accessible resource metadata after a manual scan and during the limited automatic updates it enables. Install a packaged resource watcher connected to the visible panel, and a packaged file-drop helper. Observers disconnect when updates stop; no remote code is executed. |
| `sidePanel` | Display the resource library beside the active tab. |
| `storage` | Keep the local library, exclusions, and download status. |
| `unlimitedStorage` | Preserve large collections and embedded previews that may exceed Chrome's ordinary local-storage quota. |
| `downloads` | Start, monitor, cancel, and show user-requested file downloads. |
| `alarms` | Refresh ongoing download status after the side panel closes or the service worker restarts. |

The old `declarativeNetRequestWithHostAccess` permission and YouTube player rules remain removed. A button in an open panel does not grant activeTab; the toolbar click is required unless an existing host grant makes that page accessible. Permission alone never enables automatic collection. Chrome 116+ can keep the panel open on another toolbar click; Chrome 114-115 use the built-in toggle. Existing optional file-host grants can be removed in Chrome settings; removing a grant clears the current automatic-update authorization. Older legacy builds with broad grants or YouTube rules should be reinstalled to clear legacy state.

Temporary tab access and optional file-host permissions reduce access granted at installation, but do not guarantee a shorter review or removal of the dashboard warning. Chrome may still review the broad optional declarations and download capabilities closely. Explain the actual narrow runtime requests; do not claim there is no user data access.

The production package does not execute remotely hosted code. Its UI JavaScript and page helper are packaged inside the extension. Page resources are fetched as data for collection, preview, or download, not as extension code.

## Required dashboard entries: ready to paste

These are developer-dashboard declarations, not manifest fields. The manifest declares permissions; adding justifications to it does not populate the Privacy practices tab. This copy describes package version 0.1.12. Each justification below is under 1,000 characters.

**Single purpose description**

Stashwell collects resources from webpages the user chooses to scan and organizes them in a local library for reviewing, saving, copying, and downloading.

**activeTab justification**

Stashwell uses temporary access after its toolbar icon is clicked. Available tab metadata shows the favicon and scan status. Before Scan page, the panel explains that this action enables automatic resource updates for that tab while it is active and the panel is visible. Closing Stashwell stops automatic updates. Each new tab or origin needs its own manual scan; panel hiding or closure or loss of access ends authorization. Collections stay local. Stashwell does not read Chrome's history database.

**alarms justification**

Stashwell uses alarms to refresh the status of downloads the user started, including while the side panel is closed or after the service worker restarts. The refresh alarm is scheduled only while downloads are active and is cleared when they finish.

**downloads justification**

Stashwell uses Chrome's download manager to save files the user chooses. It tracks progress, reports completion or failure, supports cancellation and retry, and lets the user show a completed file in its folder.

**scripting justification**

Stashwell inspects resource URLs and metadata after a manual scan and during the automatic updates that action enables, only while the authorized tab is active and the panel is visible. It injects a packaged resource watcher, which disconnects when updates stop, and a packaged file-drop helper for upload fields. Scripts are included in the extension; fetched resources are data, not executed remote code.

**sidePanel justification**

Stashwell displays its resource library in Chrome's side panel so users can browse, save, copy, and download collected resources beside the current webpage.

**storage justification**

Stashwell stores captured page and resource details, saved-item choices, deletion exclusions, and recent download information locally in the extension. This keeps the library available after the panel closes or the browser restarts.

**unlimitedStorage justification**

Captured collections can include many resources and embedded SVG, image, and generated icon previews. Stashwell uses unlimitedStorage so locally saved libraries can exceed Chrome's normal storage.local quota without losing resources.

**Host permission justification, if shown**

Stashwell needs original file bytes from resource hosts discovered at runtime for user-requested downloads, ZIP creation, format conversion, SVG copying, and file-drag preparation. Opening a preview or showing a saved-site logo uses existing access and never prompts for website permission automatically. It requests only selected resources' original hosts, never a wildcard grant to all websites. Scanning does not request persistent site access. Optional host grants remain until removed in Chrome settings.

**Remote code**

Select **No, I am not using remote code**. If an explanation field is shown, enter:

Stashwell's JavaScript and scanning and file-drop helpers are bundled in the extension package. It does not load or execute code from external servers. Web resources are fetched as data for previews or user-requested file downloads and are not executed as extension code.

**Privacy-policy URL**

https://allhere-ten.vercel.app/privacy

**Data usage and certifications**

Disclose Website content (collected resource content and metadata) and Web history (the source page and resource addresses the user chooses to collect). Disclose User activity for locally stored saved-item choices and download actions/status. Do not claim that no user data is handled merely because storage is local. Read the dashboard descriptions and keep the selections consistent with the published privacy policy.

Review all required certification statements and check them when accurate. The current implementation does not sell user data or transfer it outside the allowed functional uses, use it for unrelated purposes, or use it for creditworthiness or lending. These are declarations by the publisher and cannot be supplied through a ZIP.

**Publisher contact email and verification**

In the dashboard's Settings/Account page, enter business.adilsha@gmail.com as the contact email. Save it, request email verification, and open Google's verification link in that inbox. Confirm that the dashboard shows the address as verified. Adding an email to the manifest or privacy page does not verify the publisher's email. Save the item's draft after filling the Privacy practices tab, then check the publishing requirements again.

References: https://developer.chrome.com/docs/webstore/cws-dashboard-privacy and https://developer.chrome.com/docs/webstore/set-up-account

## Final dashboard fields

After publishing and checking the updated privacy page, supply its public URL, your developer and support contact details, an accurate category and language, the prepared screenshots, and the prepared small promotional image. Choose public, unlisted, or private visibility, then submit for review. The store's review decision is made by Google.
