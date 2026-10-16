import type { Metadata } from "next";
import LegalPage from "../LegalPage";

export const metadata: Metadata = {
  title: "Privacy Policy — Stashwell",
  description: "How the Stashwell extension and web library handle page resources and local data.",
};

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy policy"
      description="How Stashwell collects, uses, stores, and shares information when you use its Chrome extension or web library."
      sections={[
        {
          title: "What Stashwell does",
          paragraphs: [
            "Stashwell helps you collect and organize resources from webpages in a local library. Click Stashwell's toolbar icon on a webpage, then choose Scan page. Before that action, the Source page line notes that scanning enables automatic updates; its tooltip and the Scan page tooltip explain that these updates apply to this tab while Stashwell is open and visible. Close Stashwell to stop automatic updates. Scan again performs an additional manual refresh while automatic updates remain enabled.",
            "Automatic updates apply only to the active tab after its first successful manual scan in the current panel session. They can refresh resources as the page changes and after navigation within the same origin. They pause when you leave that tab or open library management. Hiding or closing the panel ends the session, even if Chrome retains the panel document. A new tab, a different origin, or loss of access requires another manual scan; temporary Chrome access may also require another toolbar click. Opening the panel or having permission to download from a website does not enable scanning of an unscanned tab.",
            "While updates are enabled, a small helper observes resource-related page changes, loads, fonts, and accessible open shadow roots, and signals the panel to refresh its local collection. Its observers disconnect when updates stop or the panel closes. A separate file-drop helper may remain until the page closes or navigates. Neither helper reads passwords, form-field values, or cookies. Chrome does not allow Stashwell to scan restricted browser pages.",
          ],
        },
        {
          title: "Information Stashwell uses",
          paragraphs: [
            "While the extension panel is open, Stashwell uses tab metadata that Chrome makes available, including the active tab's address, title, favicon, and loading state, to display its site icon, show scan status, and limit automatic updates to tabs you have manually scanned. The tab's automatic-update authorization is kept only in memory for that panel session, not saved as a browsing log. Chrome may withhold the site icon and address until you click Stashwell's toolbar icon or have already allowed access to that host.",
            "A scan can save the source page's URL, title, hostname, and favicon, together with resource URLs, names, descriptions, types, dimensions, and other details needed to show and organize images, icons, fonts, links, media, and files. Some inline SVGs, generated icon previews, and temporary page images are stored as image data so they remain available after the page closes. URLs or page content can contain personal information; consider this before scanning a page or exporting a collection.",
            "Stashwell also stores your saved-item choices, deleted-page exclusions, and recent download status and filenames. It uses page and resource URLs to show your library and to calculate local link signals. It does not intentionally read passwords, form-field values, or cookies.",
          ],
        },
        {
          title: "Where information is stored",
          paragraphs: [
            "The extension stores its collection and recent download status in Chrome's local extension storage on your device. The separate web library stores its collection in your browser's local storage. Stashwell does not automatically sync either collection to an account or upload it to an Stashwell server. Collection entries remain until you delete them or clear the relevant browser or extension data; older download status may be removed automatically.",
            "You can export a collection as a JSON file and import one you choose. Exported files may include page addresses, resource metadata, and embedded image data. You control where you save or share that file.",
            "Image previews and downloads keep the source image dimensions. Optional image and icon format conversion for single downloads and ZIPs runs locally in your browser. Stashwell does not upload images to an image-processing service.",
          ],
        },
        {
          title: "Network requests and sharing",
          paragraphs: [
            "Displaying the current tab's favicon or saved-page logos, including in Manage, can request icons from their original hosts. Pages without a saved favicon URL may use their original site's standard /favicon.ico address; Stashwell does not use a third-party favicon lookup service. During a scan, Stashwell may request an SVG sprite or page-generated image needed for a usable preview. Loading a preview, checking a resource, or downloading a file may also contact the resource's original website or image host. That host receives the normal network information associated with the request. When you drag a resource into a website's upload field, that website receives the file you choose to drop. Copying a URL places it on your device's clipboard.",
            "Stashwell does not sell your library data, send it to an advertising or analytics service, or allow its developer to read your local collection. Link signals are calculated locally; Stashwell does not send URLs to an external reputation service.",
            "Visiting the Stashwell website sends ordinary connection information, such as your IP address and browser details, to its hosting provider to deliver the site. The website does not receive your local library collection unless you separately choose to share it.",
          ],
        },
        {
          title: "Website access and limited use",
          paragraphs: [
            "Clicking Stashwell's toolbar icon gives it Chrome's temporary activeTab access to that tab. This access lasts while the tab stays on the same origin and ends when the tab closes or navigates to a different origin. Stashwell uses available tab metadata for the scan button and reads resources after a manual scan or during the automatic updates that action enables. It does not request persistent website access for scanning. A host grant previously allowed for a file action may also make a page accessible, but permission alone never starts automatic collection; that tab still requires its own manual scan. Removing optional website access ends the current automatic-update authorization.",
            "Downloading, copying an icon as SVG, preparing a file to drag, or creating a ZIP may ask for access to the original hosts of the selected resources. Opening a preview does not request permission automatically. A bulk action can request the hosts of all resources you selected. Stashwell requires no access to all websites when installed and does not request a wildcard grant to all websites. Chrome remembers optional host grants until you remove them in the extension's site-access settings. Stashwell also uses browser storage, downloads, and the side panel to provide the library and file actions you choose.",
            "Stashwell's use of information received from Chrome APIs adheres to the Chrome Web Store User Data Policy, including the Limited Use requirements. That information is used only to provide or improve the features described here and is not used for personalized advertising or sold to third parties.",
          ],
        },
        {
          title: "Contact",
          paragraphs: [
            "For questions about this policy or your Stashwell data, email business.adilsha@gmail.com.",
          ],
        },
      ]}
    />
  );
}
