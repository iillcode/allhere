# Allhere Chrome Web Store submission

## Release package

Build from the repository root with `pnpm build`, then run `pnpm package:extension`. Upload `apps/web/public/downloads/allhere-extension.zip`. The ZIP must contain `manifest.json` at its root. The current manifest version is `0.1.1`; increase it before every later package upload. Replace the previous 0.1.0 draft package with this version before submitting.

**Privacy-policy URL:** https://allhere-ten.vercel.app/privacy

**Support email:** business.adilsha@gmail.com

## Store images

- Required 128 × 128 px icon: `apps/extension/public/icons/allhere-128.png` (included in the ZIP).
- Required 440 × 280 px small promotional image: `docs/chrome-web-store-assets/allhere-small-promo-440x280.png`. Its editable source is the adjacent `.svg` file.
- Installed-extension UI screenshots, each 640 × 400 px: `docs/chrome-web-store-assets/allhere-screenshot-images-640x400.png` (shows the manual scanning notice), `docs/chrome-web-store-assets/allhere-screenshot-images-scrolled-640x400.png`, and `docs/chrome-web-store-assets/allhere-screenshot-download-formats-scrolled-640x400.png`.

The screenshots show the built extension after a requested scan of the locally served Allhere homepage in an isolated browser profile. The capture harness pre-grants only the local fixture host because a headless browser cannot approve Chrome's native permission dialog; the production ZIP uses optional site access. To regenerate them, start the built website on port 3002. Run `node scripts/capture-store-screenshot.mjs` for the gallery; set `ALLHERE_SCREENSHOT_SCROLL_Y=0` for the scanning-notice view; set `ALLHERE_SCREENSHOT_VIEW=download-formats` and `ALLHERE_SCREENSHOT_SCROLL_Y=140` for the format menu. Check each screenshot before uploading it. They contain a local `127.0.0.1` source label because they are reproducible local captures.

## Store listing copy

**Single purpose:** Collect and organize resources from webpages in a local browser library.

**Detailed description:**

Allhere turns the resources on a webpage into an organized library in Chrome's side panel. Choose Scan page to collect images, icons, fonts, links, direct video and audio files, and other downloadable files from the active page. Chrome may ask you to allow access to that site before its first scan. Opening the panel, switching tabs, navigating, or changes to page content do not start scans. Choose Scan page again to refresh a collection.

Browse by resource type, save useful items, inspect previews, copy addresses, and download individual files or a ZIP of selected resources. Direct video and audio files are supported; YouTube videos are not extracted or downloaded.

Allhere stores page addresses, resource details, selected previews, and download status locally in Chrome's extension storage. It does not sync your library to an Allhere account or send it to an Allhere analytics service. Opening previews or downloading files may contact the resources' original hosts; file actions can ask you to allow access to those specific hosts. Exporting a JSON archive or dragging a chosen file to a website shares that data only when you take that action. See the published Allhere privacy policy for details.

**Reviewer instructions:** Install the extension, open a regular HTTP or HTTPS webpage containing images and links, and click the Allhere toolbar icon. Choose Scan page and approve Chrome's site-access request if shown. Switch tabs: the saved collection stays visible until you choose Scan page again. Select a resource's menu to copy or download it; select multiple resources to create a ZIP. Approve access to the selected resource hosts if Chrome asks. No account or credentials are required.

## Privacy practices and permission justifications

Verify that `https://allhere-ten.vercel.app/privacy` describes manual scanning and optional site access before entering the URL in the dashboard. Disclose website content and browsing activity, including source page URLs, resource URLs, descriptions, and selected previews, even though the library is stored locally. Review the dashboard's current data categories for saved-item choices and download status too. Do not claim that Allhere handles no user data.

| Access | Why Allhere uses it |
| --- | --- |
| Optional HTTP and HTTPS host access | The wildcard declarations allow sites discovered at runtime. Scan page requests only the active site's hostname. File actions request only the original hosts of the selected resources. There is no required all-site host access or runtime request for wildcard hosts. Granted access persists in Chrome until the user removes it. |
| `tabs` | Read the active tab's URL when the user presses Scan page or Allow access to this site, so Allhere can request permission for that specific site from an already open panel. Confirm that the same requested tab and URL remain active before returning a capture. Allhere does not subscribe to browsing activity or read Chrome's History API. |
| `scripting` | Inspect the active page's resources only after Scan page is pressed and permission is granted. Install the packaged file-drop helper on that requested page and its accessible frames. |
| `sidePanel` | Display the resource library beside the active tab. |
| `storage` | Keep the local library, exclusions, and download status. |
| `unlimitedStorage` | Preserve large collections and embedded previews that may exceed Chrome's ordinary local-storage quota. |
| `downloads` | Start, monitor, cancel, and show user-requested file downloads. |
| `alarms` | Refresh ongoing download status after the side panel closes or the service worker restarts. |

The old `declarativeNetRequestWithHostAccess` permission was used for YouTube player header rules and cleanup, which are no longer part of the product. It is absent from this release. `activeTab` alone cannot grant access when the user clicks Scan page inside an already open panel after switching tabs; Allhere instead uses the active URL to request a specific optional site grant. The file-drop helper is injected only after requested scans and no longer observes resource changes. Older manually installed builds that created a dynamic YouTube rule or granted every site should be removed and reinstalled to clear that legacy state.

Optional site permissions reduce access granted at installation, but do not guarantee a shorter review or removal of the dashboard warning. Chrome may still review the broad optional declarations, `tabs`, and download capabilities closely. Explain the actual narrow runtime requests; do not claim there is no user data access.

The production package does not execute remotely hosted code. Its UI JavaScript and page helper are packaged inside the extension. Page resources are fetched as data for collection, preview, or download, not as extension code.

## Final dashboard fields

After publishing and checking the updated privacy page, supply its public URL, your developer and support contact details, an accurate category and language, the prepared screenshots, and the prepared small promotional image. Choose public, unlisted, or private visibility, then submit for review. The store's review decision is made by Google.
