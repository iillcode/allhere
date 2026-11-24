# Stashwell Chrome Web Store submission

## Release package

Build from the repository root with `pnpm build`, then run `pnpm package:extension`. Upload `apps/web/public/downloads/stashwell-extension.zip`. The ZIP must contain `manifest.json` at its root. The current manifest version is `0.1.26`. The first scan of a tab uses optional website access. Automatic updates apply to the scanned tab on the same site, even with the panel closed. Image previews can use saved alternates, and file actions use the displayed item name. The extension upgrades existing local libraries on first open and supports earlier JSON backups.

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

The screenshots show the rebuilt installed Stashwell extension after a real scan of a clearly named **Stashwell sample collection** in an isolated browser profile. Sample artwork is genuinely served and scanned; UI text, resource counts, source hostname, and menus are unmodified. The local source hostname is intentional. The 1280 × 800 files use a 2× display scale for crisp text, with the same 640 × 400 layout. Regenerate with `pnpm --filter @stashwell/extension build`, then `node scripts/generate-store-assets.mjs`. This refreshes only store artwork. The public site was still branded Allhere at capture time on October 18, 2026; check that the listing's website reflects Stashwell before submission.

## Store listing copy

**Store title:** Stashwell — Web Media Downloader

**Short description (127 characters; matches the manifest):**

Download images, SVG icons and media files from web pages. Save links, remove duplicates and export assets to your design apps.

**Single purpose:** Stashwell collects resources from the active webpage and organizes them in a local library for reviewing, saving, copying, downloading, and preparing selected assets for design applications.

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

1. Open an HTTP or HTTPS webpage and click Stashwell’s toolbar icon. Choose Scan page and allow access to the website when Chrome asks.
2. Browse the collected images, icons, links, media, and files. Scroll or open content on the webpage to reveal assets that load later.
3. Save useful items, download individual files or a ZIP, or choose Send to app to prepare selected images and icons for your design tool.

After the first scan, automatic updates apply while the tab is active on the same site, even when the panel is closed. A new tab or a different site needs its own first scan. Chrome can reuse an existing grant for a site.

Stashwell collects resources the browser can access on the scanned page. Direct video and audio files are supported; YouTube videos, protected streams, and files the browser has not received are not extracted or downloaded. Design app handoff uses clipboard content and importable files, so you complete the paste or import in the destination app.

Stashwell stores page addresses, resource details, selected previews, and download status locally in Chrome's extension storage. It does not sync your library to a Stashwell account or send it to a Stashwell analytics service. Opening previews or downloading files may contact the resources' original hosts. Copying or exporting a prepared set, exporting a JSON archive, or dragging a chosen file to a website shares that data only when you take that action. See the published Stashwell privacy policy for details.

**Reviewer instructions**. Open a webpage with images or icons and open Stashwell. Choose Scan page and allow access if Chrome asks. Close the panel and load another image in the same tab. Reopen the panel and verify the image appears. Open a second tab on the same site and confirm that its first scan still requires a click. Navigate to a new website and verify that Chrome can request access to that site when you scan it. Downloads, SVG copying, and ZIP exports can request access to the selected files’ hosts.

## Privacy practices and permission justifications

Verify that the published privacy policy describes first-scan approval by tab, optional website access, background updates on approved tabs, and local storage. Disclose Website content, Web history for captured source and resource addresses, and User activity for saved choices and download status.

| Access | Why Stashwell uses it |
| --- | --- |
| Optional HTTP and HTTPS host access | Request the website of the active tab when the user chooses Scan page. File actions can request the hosts of the selected files. |
| `tabs` | Identify the active webpage and find an open source page when the user chooses Go to tab. |
| `scripting` | Collect resource metadata from the active webpage and its accessible frames. Attach packaged resource and file-drop helpers. |
| `sidePanel` | Display the resource library beside the active tab. |
| `storage` | Keep the local library, exclusions, and download status. |
| `unlimitedStorage` | Preserve large collections and embedded previews that may exceed Chrome's ordinary local-storage quota. |
| `downloads` | Start, monitor, cancel, and show user-requested file downloads. |
| `offscreen` | Verify media and hold a temporary file while Chrome saves the user's download. |
| `alarms` | Refresh ongoing download status after the side panel closes or the service worker restarts. |

Chrome asks for website access when a user first scans a site without an existing grant. Users can review and remove grants in Chrome’s extension settings.

The production package does not execute remotely hosted code. Its UI JavaScript and page helper are packaged inside the extension. Page resources are fetched as data for collection, preview, or download, not as extension code.

## Required dashboard entries: ready to paste

These developer-dashboard declarations describe package version 0.1.26. Enter each justification in the Privacy practices tab. Each entry is under 1,000 characters.

**Single purpose description**

Stashwell collects resources from webpages the user chooses to scan and organizes them in a local library for reviewing, saving, copying, and downloading.

**tabs justification**

Stashwell reads the active tab’s URL, title, favicon, and loading state to show the matching collection and keep first-scan approval scoped to the correct tab and site. When the user chooses Go to tab in a preview, Stashwell checks open tabs for the resource’s source page so it can switch to it.

**alarms justification**

Stashwell uses alarms to refresh the status of downloads the user started, including while the side panel is closed or after the service worker restarts. The refresh alarm is scheduled only while downloads are active and is cleared when they finish.

**downloads justification**

Stashwell uses Chrome's download manager to save files the user chooses. It tracks progress, reports completion or failure, supports cancellation and retry, and lets the user show a completed file in its folder.

**offscreen justification**

Stashwell uses a temporary offscreen document to check media formats and assemble finished, unencrypted HLS streams on the device. It keeps the prepared file available to Chrome's download manager if the side panel closes. The document closes when media preparation and file saving finish.

**scripting justification**

After the first scan is approved for a tab, Stashwell injects a packaged collector to inspect resource URLs and metadata. The watcher reports resource changes. The file-drop helper handles drops the user initiates.

**sidePanel justification**

Stashwell displays its resource library in Chrome's side panel so users can browse, save, copy, and download collected resources beside the current webpage.

**storage justification**

Stashwell stores captured page and resource details, saved-item choices, deletion exclusions, and recent download information locally in the extension. This keeps the library available after the panel closes or the browser restarts.

**unlimitedStorage justification**

Captured collections can include many resources and embedded SVG, image, and generated icon previews. Stashwell uses unlimitedStorage to retain these collections in the extension's local IndexedDB database as the library grows.

**Host permission justification, if shown**

Stashwell requests optional access to the active HTTP or HTTPS website when the user chooses Scan page and the site has yet to be approved. Each tab needs a first scan. After that scan, Stashwell can update resources while the tab is active on the same site, even with the panel closed. Downloads, ZIP exports, SVG copying, and file preparation can request access to the original hosts of the selected files. The captured library stays in the browser.

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
