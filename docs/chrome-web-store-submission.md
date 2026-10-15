# Allhere Chrome Web Store submission

## Release package

Build from the repository root with `pnpm build`, then run `pnpm package:extension`. Upload `apps/web/public/downloads/allhere-extension.zip`. The ZIP must contain `manifest.json` at its root. The current manifest version is `0.1.3`; increase it before every later package upload. Upload this package to the existing Allhere item to replace the previous draft. This release adds the freeform Allhere logo and current-tab favicon with amber Scan page / blue Scan again states. Scans still use temporary toolbar access and never request persistent site access.

**Privacy-policy URL:** https://allhere-ten.vercel.app/privacy

**Support email:** business.adilsha@gmail.com

## Store images

- Required 128 × 128 px icon: `apps/extension/public/icons/allhere-128.png` (included in the ZIP).
- Required 440 × 280 px small promotional image: `docs/chrome-web-store-assets/allhere-small-promo-440x280.png`. Its editable source is the adjacent `.svg` file.
- Installed-extension UI screenshots, each 640 × 400 px: `docs/chrome-web-store-assets/allhere-screenshot-images-640x400.png` (shows the toolbar/scan instruction), `docs/chrome-web-store-assets/allhere-screenshot-images-scrolled-640x400.png`, and `docs/chrome-web-store-assets/allhere-screenshot-download-formats-scrolled-640x400.png`.

The screenshots show the built extension after a requested scan of the live Allhere homepage in an isolated browser profile. The capture harness pre-grants only the chosen homepage host because a headless browser cannot click Chrome's native toolbar icon; the production ZIP grants no required hosts. To regenerate them, set `ALLHERE_WEB_URL=https://allhere-ten.vercel.app/` and run `node scripts/capture-store-screenshot.mjs` for the gallery; set `ALLHERE_SCREENSHOT_SCROLL_Y=0` for the toolbar/scan instruction view; set `ALLHERE_SCREENSHOT_VIEW=download-formats` and `ALLHERE_SCREENSHOT_SCROLL_Y=140` for the format menu. Check each screenshot before uploading it. The source label should show `allhere-ten.vercel.app`, not a local development address.

## Store listing copy

**Single purpose:** Allhere collects resources from webpages the user chooses to scan and organizes them in a local library for reviewing, saving, copying, and downloading.

**Detailed description:**

Allhere turns the resources on a webpage into an organized library in Chrome's side panel. Click Allhere's toolbar icon on the webpage, then choose Scan page to collect images, icons, fonts, links, direct video and audio files, and other downloadable files. The toolbar click gives temporary tab access without a persistent site-access prompt for scanning. On a new tab or after navigating to a different site, click the toolbar icon again before scanning. Opening the panel, switching tabs, navigating, or changes to page content do not start scans. After a successful scan, choose Scan again to refresh a collection.

Browse by resource type, save useful items, inspect previews, copy addresses, and download individual files or a ZIP of selected resources. Direct video and audio files are supported; YouTube videos are not extracted or downloaded.

Allhere stores page addresses, resource details, selected previews, and download status locally in Chrome's extension storage. It does not sync your library to an Allhere account or send it to an Allhere analytics service. Opening previews or downloading files may contact the resources' original hosts; file actions can ask you to allow access to those specific hosts. Exporting a JSON archive or dragging a chosen file to a website shares that data only when you take that action. See the published Allhere privacy policy for details.

**Reviewer instructions:** Install the extension, open a regular HTTP or HTTPS webpage containing images and links, and click the Allhere toolbar icon. This opens the panel and grants temporary access without scanning or showing a site-access dialog. Choose Scan page to collect resources. Switch tabs: the saved collection stays visible. Click the Allhere toolbar icon on the new tab, then choose Scan page to collect that tab. Repeat the toolbar click after navigating to a different site. Select a resource's menu to copy or download it; select multiple resources to create a ZIP. File actions may ask for access to the selected resource hosts; approve those requests to test fetching and conversion. No account or credentials are required.

## Privacy practices and permission justifications

Verify that `https://allhere-ten.vercel.app/privacy` describes manual scans using temporary toolbar access and optional host access for file actions before entering the URL in the dashboard. Disclose website content and browsing activity, including source page URLs, resource URLs, descriptions, and selected previews, even though the library is stored locally. Review the dashboard's current data categories for saved-item choices and download status too. Do not claim that Allhere handles no user data. Replace any previous `tabs` justification with the `activeTab` text below.

| Access | Why Allhere uses it |
| --- | --- |
| Optional HTTP and HTTPS host access | The wildcard declarations allow resource hosts discovered at runtime. User-requested file downloads, ZIP creation, SVG copying, and file-drag preparation request only the original hosts of the selected resources when required to fetch their bytes. Scanning never calls the host-permission request API. There is no required all-site access or runtime request for wildcard hosts. Optional grants persist until removed in Chrome settings. A grant may also make pages on that host accessible, but scans still require Scan page. |
| `activeTab` | Give temporary access to the current tab when the user clicks Allhere's toolbar icon. Available tab metadata updates the scan button's favicon and manual-scan indicator while the panel is open; that interface state is not saved as a browsing log. Page resources are inspected only after Scan page is pressed. On a new tab or after navigating to another site, the user invokes the toolbar icon again. There is no broad `tabs` permission, background scanning, or use of Chrome's History API. |
| `scripting` | Inspect the active page's resources only after Scan page is pressed and Chrome has granted temporary tab access or an existing host grant. Install the packaged file-drop helper on that requested page and its accessible frames. |
| `sidePanel` | Display the resource library beside the active tab. |
| `storage` | Keep the local library, exclusions, and download status. |
| `unlimitedStorage` | Preserve large collections and embedded previews that may exceed Chrome's ordinary local-storage quota. |
| `downloads` | Start, monitor, cancel, and show user-requested file downloads. |
| `alarms` | Refresh ongoing download status after the side panel closes or the service worker restarts. |

The old `declarativeNetRequestWithHostAccess` permission was used for YouTube player header rules and cleanup, which are no longer part of the product. It is absent from this release, as is the broad `tabs` permission. A button in an already open side panel does not grant `activeTab`; the toolbar click on that tab is required unless an existing allowed host makes the page accessible. The toolbar opens the panel without scanning, and the panel gives guidance if access is missing. Chrome 116+ keeps the panel open on another toolbar click; Chrome 114–115 use the built-in toggle. The file-drop helper is injected only after requested scans and does not observe resource changes. Previously granted optional site access can remain after an upgrade; users can remove it in Chrome settings. Older manually installed builds that created a dynamic YouTube rule or granted every site should be removed and reinstalled to clear that legacy state.

Temporary tab access and optional file-host permissions reduce access granted at installation, but do not guarantee a shorter review or removal of the dashboard warning. Chrome may still review the broad optional declarations and download capabilities closely. Explain the actual narrow runtime requests; do not claim there is no user data access.

The production package does not execute remotely hosted code. Its UI JavaScript and page helper are packaged inside the extension. Page resources are fetched as data for collection, preview, or download, not as extension code.

## Required dashboard entries: ready to paste

These are developer-dashboard declarations, not manifest fields. The manifest declares permissions; adding justifications to it does not populate the Privacy practices tab. This copy describes package version 0.1.3. Each justification below is under 1,000 characters.

**Single purpose description**

Allhere collects resources from webpages the user chooses to scan and organizes them in a local library for reviewing, saving, copying, and downloading.

**activeTab justification**

Allhere uses temporary access to the tab where the user clicks its toolbar icon. While the panel is open, available tab metadata displays the current site's favicon and indicates when a manual scan is needed. This interface state is not saved as a browsing log. Page resources are collected only after the user presses Scan page. Opening the panel or switching tabs does not start a scan. Allhere does not read Chrome's history database.

**alarms justification**

Allhere uses alarms to refresh the status of downloads the user started, including while the side panel is closed or after the service worker restarts. The refresh alarm is scheduled only while downloads are active and is cleared when they finish.

**downloads justification**

Allhere uses Chrome's download manager to save files the user chooses. It tracks progress, reports completion or failure, supports cancellation and retry, and lets the user show a completed file in its folder.

**scripting justification**

Allhere inspects resource URLs and metadata on the active webpage only after the user chooses Scan page and Chrome allows access. It injects a packaged file-drop helper on the scanned page and accessible frames so users can drop selected resources into upload fields.

**sidePanel justification**

Allhere displays its resource library in Chrome's side panel so users can browse, save, copy, and download collected resources beside the current webpage.

**storage justification**

Allhere stores captured page and resource details, saved-item choices, deletion exclusions, and recent download information locally in the extension. This keeps the library available after the panel closes or the browser restarts.

**unlimitedStorage justification**

Captured collections can include many resources and embedded SVG, image, and generated icon previews. Allhere uses unlimitedStorage so locally saved libraries can exceed Chrome's normal storage.local quota without losing resources.

**Host permission justification, if shown**

Allhere needs original file bytes from resource hosts discovered at runtime for user-requested downloads, ZIP creation, format conversion, SVG copying, and file-drag preparation. It requests access only to the original hosts of selected resources, never a wildcard grant to all websites. Scanning does not request persistent site access. Optional host grants remain until removed in Chrome settings.

**Remote code**

Select **No, I am not using remote code**. If an explanation field is shown, enter:

Allhere's JavaScript and scanning and file-drop helpers are bundled in the extension package. It does not load or execute code from external servers. Web resources are fetched as data for previews or user-requested file downloads and are not executed as extension code.

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
