# Allhere Chrome Web Store submission

## Release package

Build from the repository root with `pnpm build`, then run `pnpm package:extension`. Upload `apps/web/public/downloads/allhere-extension.zip`. The ZIP must contain `manifest.json` at its root. The current manifest version is `0.1.0`; increase it before every later package upload.

**Privacy-policy URL:** https://allhere-ten.vercel.app/privacy

**Support email:** business.adilsha@gmail.com

## Store images

- Required 128 × 128 px icon: `apps/extension/public/icons/allhere-128.png` (included in the ZIP).
- Required 440 × 280 px small promotional image: `docs/chrome-web-store-assets/allhere-small-promo-440x280.png`. Its editable source is the adjacent `.svg` file.
- Actual installed-extension screenshots, each 640 × 400 px: `docs/chrome-web-store-assets/allhere-screenshot-images-640x400.png` (shows the automatic scanning notice), `docs/chrome-web-store-assets/allhere-screenshot-images-scrolled-640x400.png`, and `docs/chrome-web-store-assets/allhere-screenshot-download-formats-scrolled-640x400.png`.

The screenshots show the built extension scanning the locally served Allhere homepage in an isolated browser profile. To regenerate them, start the built website on port 3002. Run `node scripts/capture-store-screenshot.mjs` for the gallery; set `ALLHERE_SCREENSHOT_SCROLL_Y=0` for the scanning-notice view; set `ALLHERE_SCREENSHOT_VIEW=download-formats` and `ALLHERE_SCREENSHOT_SCROLL_Y=140` for the format menu. Check each screenshot before uploading it. They contain a local `127.0.0.1` source label because they are reproducible local captures.

## Store listing copy

**Single purpose:** Collect and organize resources from webpages in a local browser library.

**Detailed description:**

Allhere turns the resources on a webpage into an organized library in Chrome's side panel. Open the panel to scan the active page for images, icons, fonts, links, direct video and audio files, and other downloadable files. While the panel is open, switching tabs, navigating, or changes to the active page can refresh its collection. Use Scan page to rescan manually.

Browse by resource type, save useful items, inspect previews, copy addresses, and download individual files or a ZIP of selected resources. Direct video and audio files are supported; YouTube videos are not extracted or downloaded.

Allhere stores page addresses, resource details, selected previews, and download status locally in Chrome's extension storage. It does not sync your library to an Allhere account or send it to an Allhere analytics service. Opening previews or downloading files may contact the resources' original hosts. Exporting a JSON archive or dragging a chosen file to a website shares that data only when you take that action. See the published Allhere privacy policy for details.

**Reviewer instructions:** Install the extension, open a regular HTTP or HTTPS webpage containing images and links, and click the Allhere toolbar icon. The side panel scans the active page. Switch tabs to see the new active page scanned. Use Scan page for a manual rescan. Select a resource's menu to copy or download it; select multiple resources to create a ZIP. No account or credentials are required.

## Privacy practices and permission justifications

Verify that `https://allhere-ten.vercel.app/privacy` describes automatic scanning before entering the URL in the dashboard. Disclose website content and browsing activity, including source page URLs, resource URLs, descriptions, and selected previews, even though the library is stored locally. Review the dashboard's current data categories for saved-item choices and download status too. Do not claim that Allhere handles no user data.

| Access | Why Allhere uses it |
| --- | --- |
| HTTP and HTTPS host access | Scan whichever regular page the user opens in the side panel, including accessible frames, and retrieve resource previews or downloads from their original hosts. |
| `scripting` | Inspect the active page's resources and install a helper only on pages scanned by the open side panel. |
| `sidePanel` | Display the resource library beside the active tab. |
| `storage` | Keep the local library, exclusions, and download status. |
| `unlimitedStorage` | Preserve large collections and embedded previews that may exceed Chrome's ordinary local-storage quota. |
| `downloads` | Start, monitor, cancel, and show user-requested file downloads. |
| `alarms` | Refresh ongoing download status after the side panel closes or the service worker restarts. |

The old `declarativeNetRequestWithHostAccess` permission was used for YouTube player header rules and cleanup, which are no longer part of the product. It and the redundant `activeTab` permission are absent from this release. The all-site HTTP/HTTPS host access remains because opening the panel and switching tabs can scan any regular website. The file-drop helper is injected only into pages scanned by the open panel; it is no longer a static script on every site. Older manually installed builds that created a dynamic YouTube rule should be removed and reinstalled to clear that legacy state.

The production package does not execute remotely hosted code. Its UI JavaScript and page helper are packaged inside the extension. Page resources are fetched as data for collection, preview, or download, not as extension code.

## Final dashboard fields

After publishing and checking the updated privacy page, supply its public URL, your developer and support contact details, an accurate category and language, the prepared screenshots, and the prepared small promotional image. Choose public, unlisted, or private visibility, then submit for review. The store's review decision is made by Google.
