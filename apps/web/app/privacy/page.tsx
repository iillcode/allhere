import type { Metadata } from "next";
import LegalPage from "../LegalPage";

export const metadata: Metadata = {
  title: "Privacy Policy — Allhere",
  description: "How the Allhere extension and web library handle page resources and local data.",
};

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy policy"
      description="How Allhere collects, uses, stores, and shares information when you use its Chrome extension or web library."
      sections={[
        {
          title: "What Allhere does",
          paragraphs: [
            "Allhere helps you collect and organize resources from webpages in a local library. A scan starts only when you choose Scan page. Opening the extension panel, switching tabs, navigating, or changes to page content do not start a scan. Choose Scan page again whenever you want to refresh a page's collection.",
            "After a requested scan, a small helper supports file drag and drop on that page. It may remain until the page closes or navigates, but it does not watch for page-resource changes or start scans. Chrome does not allow Allhere to scan restricted browser pages.",
          ],
        },
        {
          title: "Information Allhere uses",
          paragraphs: [
            "A scan can save the source page's URL, title, hostname, and favicon, together with resource URLs, names, descriptions, types, dimensions, and other details needed to show and organize images, icons, fonts, links, media, and files. Some inline SVGs, generated icon previews, and temporary page images are stored as image data so they remain available after the page closes. URLs or page content can contain personal information; consider this before scanning a page or exporting a collection.",
            "Allhere also stores your saved-item choices, deleted-page exclusions, and recent download status and filenames. It uses page and resource URLs to show your library and to calculate local link signals. It does not intentionally read passwords, form-field values, or cookies.",
          ],
        },
        {
          title: "Where information is stored",
          paragraphs: [
            "The extension stores its collection and recent download status in Chrome's local extension storage on your device. The separate web library stores its collection in your browser's local storage. Allhere does not automatically sync either collection to an account or upload it to an Allhere server. Collection entries remain until you delete them or clear the relevant browser or extension data; older download status may be removed automatically.",
            "You can export a collection as a JSON file and import one you choose. Exported files may include page addresses, resource metadata, and embedded image data. You control where you save or share that file.",
          ],
        },
        {
          title: "Network requests and sharing",
          paragraphs: [
            "During a scan, Allhere may request an SVG sprite or page-generated image needed for a usable preview. Loading a preview, checking a resource, or downloading a file may also contact the resource's original website or image host. That host receives the normal network information associated with the request. When you drag a resource into a website's upload field, that website receives the file you choose to drop. Copying a URL places it on your device's clipboard.",
            "Allhere does not sell your library data, send it to an advertising or analytics service, or allow its developer to read your local collection. Link signals are calculated locally; Allhere does not send URLs to an external reputation service.",
            "Visiting the Allhere website sends ordinary connection information, such as your IP address and browser details, to its hosting provider to deliver the site. The website does not receive your local library collection unless you separately choose to share it.",
          ],
        },
        {
          title: "Website access and limited use",
          paragraphs: [
            "The extension uses the active tab's URL when you request a scan or site access to identify which website permission to request. It asks Chrome for access to that specific HTTP or HTTPS site when needed, rather than requiring access to every website when installed. Your decision to allow access is stored by Chrome; you can change it in the extension's site-access settings. Granting access does not start automatic scans.",
            "Downloading, copying an icon as SVG, preparing a file to drag, or creating a ZIP may ask for access to the original hosts of the selected resources. A bulk action can request the hosts of all resources you selected. Allhere also uses browser storage, downloads, and the side panel to provide the library and file actions you choose.",
            "Allhere's use of information received from Chrome APIs adheres to the Chrome Web Store User Data Policy, including the Limited Use requirements. That information is used only to provide or improve the features described here and is not used for personalized advertising or sold to third parties.",
          ],
        },
        {
          title: "Contact",
          paragraphs: [
            "For questions about this policy or your Allhere data, email business.adilsha@gmail.com.",
          ],
        },
      ]}
    />
  );
}
