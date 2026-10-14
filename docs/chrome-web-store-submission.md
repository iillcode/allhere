# Allhere Chrome Web Store submission

## Release package

Build from the repository root with `pnpm build`, then run `pnpm package:extension`. Upload `apps/web/public/downloads/allhere-extension.zip`. The ZIP must contain `manifest.json` at its root. The current manifest version is `0.1.2`; increase it before every later package upload. Upload this package to the existing Allhere item to replace the previous draft. This release uses temporary toolbar access for scanning and no longer requests persistent site access before a scan.

**Privacy-policy URL:** https://allhere-ten.vercel.app/privacy

**Support email:** business.adilsha@gmail.com

## Store images

- Required 128 × 128 px icon: `apps/extension/public/icons/allhere-128.png` (included in the ZIP).
- Required 440 × 280 px small promotional image: `docs/chrome-web-store-assets/allhere-small-promo-440x280.png`. Its editable source is the adjacent `.svg` file.
- Installed-extension UI screenshots, each 640 × 400 px: `docs/chrome-web-store-assets/allhere-screenshot-images-640x400.png` (shows the toolbar/scan instruction), `docs/chrome-web-store-assets/allhere-screenshot-images-scrolled-640x400.png`, and `docs/chrome-web-store-assets/allhere-screenshot-download-formats-scrolled-640x400.png`.

The screenshots show the built extension after a requested scan of the live Allhere homepage in an isolated browser profile. The capture harness pre-grants only the chosen homepage host because a headless browser cannot click Chrome's native toolbar icon; the production ZIP grants no required hosts. To regenerate them, set `ALLHERE_WEB_URL=https://allhere-ten.vercel.app/` and run `node scripts/capture-store-screenshot.mjs` for the gallery; set `ALLHERE_SCREENSHOT_SCROLL_Y=0` for the toolbar/scan instruction view; set `ALLHERE_SCREENSHOT_VIEW=download-formats` and `ALLHERE_SCREENSHOT_SCROLL_Y=140` for the format menu. Check each screenshot before uploading it. The source label should show `allhere-ten.vercel.app`, not a local development address.

## Store listing copy

**Single purpose:** Collect and organize resources from webpages in a local browser library.

**Detailed description:**

Allhere turns the resources on a webpage into an organized library in Chrome's side panel. Click Allhere's toolbar icon on the webpage, then choose Scan page to collect images, icons, fonts, links, direct video and audio files, and other downloadable files. The toolbar click gives temporary tab access without a persistent site-access prompt for scanning. On a new tab or after navigating to a different site, click the toolbar icon again before scanning. Opening the panel, switching tabs, navigating, or changes to page content do not start scans. Choose Scan page again to refresh a collection.

Browse by resource type, save useful items, inspect previews, copy addresses, and download individual files or a ZIP of selected resources. Direct video and audio files are supported; YouTube videos are not extracted or downloaded.

Allhere stores page addresses, resource details, selected previews, and download status locally in Chrome's extension storage. It does not sync your library to an Allhere account or send it to an Allhere analytics service. Opening previews or downloading files may contact the resources' original hosts; file actions can ask you to allow access to those specific hosts. Exporting a JSON archive or dragging a chosen file to a website shares that data only when you take that action. See the published Allhere privacy policy for details.

**Reviewer instructions:** Install the extension, open a regular HTTP or HTTPS webpage containing images and links, and click the Allhere toolbar icon. This opens the panel and grants temporary access without scanning or showing a site-access dialog. Choose Scan page to collect resources. Switch tabs: the saved collection stays visible. Click the Allhere toolbar icon on the new tab, then choose Scan page to collect that tab. Repeat the toolbar click after navigating to a different site. Select a resource's menu to copy or download it; select multiple resources to create a ZIP. File actions may ask for access to the selected resource hosts; approve those requests to test fetching and conversion. No account or credentials are required.

## Privacy practices and permission justifications

Verify that `https://allhere-ten.vercel.app/privacy` describes manual scans using temporary toolbar access and optional host access for file actions before entering the URL in the dashboard. Disclose website content and browsing activity, including source page URLs, resource URLs, descriptions, and selected previews, even though the library is stored locally. Review the dashboard's current data categories for saved-item choices and download status too. Do not claim that Allhere handles no user data. Replace any previous `tabs` justification with the `activeTab` text below.

| Access | Why Allhere uses it |
| --- | --- |
| Optional HTTP and HTTPS host access | The wildcard declarations allow resource hosts discovered at runtime. User-requested file downloads, ZIP creation, SVG copying, and file-drag preparation request only the original hosts of the selected resources when required to fetch their bytes. Scanning never calls the host-permission request API. There is no required all-site access or runtime request for wildcard hosts. Optional grants persist until removed in Chrome settings. A grant may also make pages on that host accessible, but scans still require Scan page. |
| `activeTab` | Give temporary access to the current tab when the user clicks Allhere's toolbar icon. Allhere uses it to read that page's URL and inspect resources only after Scan page is pressed. On a new tab or after navigating to another site, the user invokes the toolbar icon again. There is no broad `tabs` permission, background scanning, browsing-activity subscription, or use of Chrome's History API. |
| `scripting` | Inspect the active page's resources only after Scan page is pressed and Chrome has granted temporary tab access or an existing host grant. Install the packaged file-drop helper on that requested page and its accessible frames. |
| `sidePanel` | Display the resource library beside the active tab. |
| `storage` | Keep the local library, exclusions, and download status. |
| `unlimitedStorage` | Preserve large collections and embedded previews that may exceed Chrome's ordinary local-storage quota. |
| `downloads` | Start, monitor, cancel, and show user-requested file downloads. |
| `alarms` | Refresh ongoing download status after the side panel closes or the service worker restarts. |

The old `declarativeNetRequestWithHostAccess` permission was used for YouTube player header rules and cleanup, which are no longer part of the product. It is absent from this release, as is the broad `tabs` permission. A button in an already open side panel does not grant `activeTab`; the toolbar click on that tab is required unless an existing allowed host makes the page accessible. The toolbar opens the panel without scanning, and the panel gives guidance if access is missing. Chrome 116+ keeps the panel open on another toolbar click; Chrome 114–115 use the built-in toggle. The file-drop helper is injected only after requested scans and does not observe resource changes. Previously granted optional site access can remain after an upgrade; users can remove it in Chrome settings. Older manually installed builds that created a dynamic YouTube rule or granted every site should be removed and reinstalled to clear that legacy state.

Temporary tab access and optional file-host permissions reduce access granted at installation, but do not guarantee a shorter review or removal of the dashboard warning. Chrome may still review the broad optional declarations and download capabilities closely. Explain the actual narrow runtime requests; do not claim there is no user data access.

The production package does not execute remotely hosted code. Its UI JavaScript and page helper are packaged inside the extension. Page resources are fetched as data for collection, preview, or download, not as extension code.

## Final dashboard fields

After publishing and checking the updated privacy page, supply its public URL, your developer and support contact details, an accurate category and language, the prepared screenshots, and the prepared small promotional image. Choose public, unlisted, or private visibility, then submit for review. The store's review decision is made by Google.
