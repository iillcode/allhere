# Stashwell Chrome Web Store submission

## Release package

Build from the repository root with `pnpm build`, then run `pnpm package:extension`. Upload `apps/web/public/downloads/stashwell-extension.zip`. The ZIP must contain `manifest.json` at its root. The current manifest version is `0.1.18`; increase it before every later package upload. Upload this package to the existing store item to replace the previous draft. This release uses the extension title Stashwell — Web Media Downloader and feature-focused metadata. It includes the custom application selector, locally bundled destination logos, and refined transfer and preview modals. The installed extension uses the approved A2 (Twin fold) mark in its panel header, toolbar, extension-manager icons, and page favicon, and the website's landing pages, library, favicon, and reusable brand exports share A2; the refreshed store promotional artwork and screenshots use A2 too. Saved libraries and earlier JSON backups remain compatible. The Manage list retains each saved site’s favicon. Older pages without a saved favicon URL try their own site’s /favicon.ico; unavailable icons retain the globe fallback. Icons load using existing access without a permission prompt or third-party lookup service. Existing stored libraries, automatic updates after the first manual scan, webpage image order, and source image dimensions are retained. The update adds the `tabs` permission so the panel follows the active tab.

**Privacy-policy URL:** https://allhere-ten.vercel.app/privacy

**Support email:** business.adilsha@gmail.com

## Store images

- Category: **Developer Tools**. Language: **English (United States)**.
- Complete artwork bundle: `docs/chrome-web-store-assets/stashwell-store-assets.zip`. This contains listing images, not the installable extension package.
- Required 128 × 128 px icon: `docs/chrome-web-store-assets/stashwell-store-icon-128.png`, an exact copy of the current extension icon at `apps/extension/public/icons/stashwell-128.png`.
- Required 440 × 280 px small promotional image: `docs/chrome-web-store-assets/stashwell-small-promo-440x280.png`. Its editable source is the adjacent `.svg` file.
- Screenshot 1, showing the current brand and source selector: `docs/chrome-web-store-assets/stashwell-screenshot-images-1280x800.png`.
- Screenshot 2, showing the image gallery: `docs/chrome-web-store-assets/stashwell-screenshot-images-scrolled-1280x800.png`.
- Screenshot 3, showing the custom format menu: `docs/chrome-web-store-assets/stashwell-screenshot-download-formats-scrolled-1280x800.png`.
- Matching `640x400` versions are supplied as smaller alternatives. Upload one size per screenshot; all screenshots and promotional PNGs are RGB without alpha.

The screenshots show the rebuilt installed Stashwell extension after a real scan of a clearly named **Stashwell sample collection** in an isolated browser profile. Sample artwork is genuinely served and scanned; UI text, resource counts, source hostname, and menus are unmodified. The local source hostname is intentional. The capture harness pre-grants only that fixture host because a headless browser cannot click Chrome's native toolbar icon; production extension permissions are unchanged. The 1280 × 800 files use a 2× display scale for crisp text, with the same 640 × 400 layout. Regenerate with `pnpm --filter @stashwell/extension build`, then `node scripts/generate-store-assets.mjs`. This refreshes only store artwork. The public site was still branded Allhere at capture time on October 18, 2026; check that the listing's website reflects Stashwell before submission.

## Store listing copy

**Store title:** Stashwell — Web Media Downloader

**Short description (127 characters; matches the manifest):**

Download images, SVG icons and media files from web pages. Save links, remove duplicates and export assets to your design apps.

**Single purpose:** Stashwell collects resources from webpages the user chooses to scan and organizes them in a local library for reviewing, saving, copying, downloading, and preparing selected assets for design applications.

**Detailed description:**

Stashwell is a web media downloader for designers, developers, and anyone saving useful things from the web. Download images, extract SVG icons, collect links, and save direct media files from webpages you choose to scan, all from Chrome's side panel.

FEATURES

- Image downloader: preview webpage images and download them at their source dimensions. Keep the original format or convert locally to PNG, JPEG, or WebP. Download selected images together in a ZIP.
- Icon extractor: collect accessible SVG icons, inline artwork, and icon-font previews. Download supported icons as SVG or a raster image format; artwork that starts as a raster stays raster.
- Media and file downloads: find direct video, audio, font, and downloadable file URLs exposed by the page. Preview supported media before saving.
- Fewer duplicates: merge repeated resource entries and declared image variants while retaining source references. Prepared design sets also remove byte-identical duplicates.
- Design app exports: select images and icons, prepare SVG and PNG files with optional sizing, padding, and backgrounds, then copy or download the set. Destination presets include Figma, Penpot, Sketch, Canva, Adobe Illustrator, Adobe Photoshop, Affinity, Photopea, and Inkscape. Paste or import the prepared assets into your chosen app; drag individual files into supported web upload areas.
- Saved links and assets: bookmark useful resources and browse saved items across captured pages. Filter your collection into Images, Icons, Fonts, Video & audio, Links, and Files.
- A local library: keep captured resources and saved choices in Chrome's extension storage. Export and import a JSON archive to back up or transfer your library. No Stashwell account is required.

HOW IT WORKS

1. Click Stashwell's toolbar icon to open the panel, then choose Scan page on the active webpage. Allow access to that website if Chrome asks.
2. Browse the collected images, icons, links, media, and files. Scroll or open content on the webpage to reveal assets that load later.
3. Save useful items, download individual files or a ZIP, or choose Send to app to prepare selected images and icons for your design tool.

Your first manual scan also enables automatic resource updates for that active tab while the side panel is open and visible. Close Stashwell to stop them. Updates may follow navigation within the same origin; a new tab, another origin, permission loss, or a reopened panel requires a new manual scan. The Scan page button can request access to the active website without closing and reopening the panel. Downloads and preparation can ask for access to the selected resources' original hosts.

Stashwell collects resources the browser can access on the scanned page. Direct video and audio files are supported; YouTube videos, protected streams, and files the browser has not received are not extracted or downloaded. Design app handoff uses clipboard content and importable files, so you complete the paste or import in the destination app.

Stashwell stores page addresses, resource details, selected previews, and download status locally in Chrome's extension storage. It does not sync your library to a Stashwell account or send it to a Stashwell analytics service. Opening previews or downloading files may contact the resources' original hosts. Copying or exporting a prepared set, exporting a JSON archive, or dragging a chosen file to a website shares that data only when you take that action. See the published Stashwell privacy policy for details.

**Reviewer instructions:** Open a normal HTTP/HTTPS webpage, click Stashwell's toolbar icon, and read the short automatic-update hint in the Source page line (the hint and Scan page tooltips explain its scope). Opening the panel must not scan. Choose Scan page and allow access to the active website if Chrome asks. Add or load resources on that page: its collection updates automatically. Add a second resource and verify that it is collected without another click. Scan again performs an additional manual refresh while automatic updates remain enabled. Switch to a new, unscanned tab: its favicon and first-scan view should replace the old page's data without another toolbar click. It must remain unscanned until Scan page is chosen. A previously scanned tab can resume when active; same-origin navigation can update, while cross-origin navigation ends consent. Click the toolbar icon again to close the panel and stop automatic updates; click it once more to reopen. Reopening requires another manual scan. Manage pauses capture and automatic updates never restore deleted items. Test copying, downloading, and bulk ZIP actions separately; these may request original resource-host access. No account is required.

## Privacy practices and permission justifications

Verify that `https://allhere-ten.vercel.app/privacy` describes the first manual scan enabling limited automatic updates, the compact scan hint and closing the panel to stop updates, active-tab metadata from the `tabs` permission, temporary toolbar access, and optional scan-site and file-host access. Disclose Website content, Web history for captured source/resource addresses, and User activity for saved choices/download status. Keep the listing, privacy fields, permission justifications, and in-product disclosure consistent; local storage does not mean no user data is handled.

| Access | Why Stashwell uses it |
| --- | --- |
| Optional HTTP and HTTPS host access | Scan page can request only the active website so a user can scan after switching tabs without another toolbar click. User-requested downloads, ZIPs, enlarged-image preview preparation, SVG copying, and drag preparation request only selected resources' original hosts. Opening a preview never requests permission automatically; choosing a size or retrying can request its image host. No required all-site access or runtime wildcard request is made. A host grant never enables scanning automatically; every tab still needs a successful manual scan before automatic updates. |
| `activeTab` | Clicking the toolbar icon provides temporary access to that tab. A successful manual scan, with prior in-panel disclosure, enables automatic updates only while that tab is active and the panel is visible. Authorization is kept in memory; another origin, lost access, or panel hiding or closure ends authorization. |
| `tabs` | Read the active tab's URL, title, favicon, and loading state when the user changes tabs or navigates. This keeps the Scan button and current-page view accurate without another toolbar click. Stashwell does not use the History API or scan a tab merely because it became active. |
| `scripting` | Collect accessible resource metadata after a manual scan and during the limited automatic updates it enables. Install a packaged resource watcher connected to the visible panel, and a packaged file-drop helper. Observers disconnect when updates stop; no remote code is executed. |
| `sidePanel` | Display the resource library beside the active tab. |
| `storage` | Keep the local library, exclusions, and download status. |
| `unlimitedStorage` | Preserve large collections and embedded previews that may exceed Chrome's ordinary local-storage quota. |
| `downloads` | Start, monitor, cancel, and show user-requested file downloads. |
| `alarms` | Refresh ongoing download status after the side panel closes or the service worker restarts. |

The old `declarativeNetRequestWithHostAccess` permission and YouTube player rules remain removed. A button in an open panel does not grant activeTab; Scan page requests an optional grant for the active website when needed. Permission alone never enables automatic collection. Clicking the toolbar icon toggles the side panel; closing it ends automatic-update authorization. Existing optional host grants can be removed in Chrome settings; removing a grant clears the current automatic-update authorization. Older legacy builds with broad grants or YouTube rules should be reinstalled to clear legacy state.

The required `tabs` permission allows active-tab metadata to remain available as users switch tabs and may add a permission warning or review time. No website content access is granted at installation. Explain the narrow runtime host requests; do not claim there is no user data access.

The production package does not execute remotely hosted code. Its UI JavaScript and page helper are packaged inside the extension. Page resources are fetched as data for collection, preview, or download, not as extension code.

## Required dashboard entries: ready to paste

These are developer-dashboard declarations, not manifest fields. The manifest declares permissions; adding justifications to it does not populate the Privacy practices tab. This copy describes package version 0.1.18. Each justification below is under 1,000 characters.

**Single purpose description**

Stashwell collects resources from webpages the user chooses to scan and organizes them in a local library for reviewing, saving, copying, and downloading.

**activeTab justification**

Stashwell uses temporary access after its toolbar icon is clicked. Before Scan page, the panel explains that this action enables automatic resource updates for that tab while it is active and the panel is visible. Closing Stashwell stops automatic updates. Each new tab or origin needs its own manual scan; panel hiding or closure or loss of access ends authorization. Collections stay local.

**tabs justification**

Stashwell reads the active tab's URL, title, favicon, and loading state so its Scan button and source-page view follow tab switches without reopening the extension. It compares the URL with locally saved scans to show the correct page or a first-scan view. Tab changes do not trigger a scan; users choose Scan page for each new tab. Stashwell does not read Chrome's history database.

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

Stashwell requests optional access to the active website when the user chooses Scan page without a current site grant. It also needs original file bytes from resource hosts discovered at runtime for user-requested downloads, ZIP creation, format conversion, SVG copying, and file-drag preparation. Opening a preview or showing a saved-site logo uses existing access and never prompts for website permission automatically. It requests only the active scan site or selected resources' original hosts, never a wildcard grant to all websites. Optional host grants remain until removed in Chrome settings.

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
