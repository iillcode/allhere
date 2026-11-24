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
            "Choose Scan page to start collecting resources from the active webpage. Stashwell saves the collection in a local library. After the first scan, automatic updates apply while that tab is active on the same site, even with the side panel closed. Closing the tab, navigating to a different site, or restarting the browser ends its automatic updates. Each tab needs its own first scan.",
            "A page helper observes resource-related changes, loads, fonts, and accessible shadow roots and signals the extension's background worker to refresh the local collection. Its observers pause when the page becomes hidden. A separate helper handles file drops you initiate. The helpers do not read passwords, form-field values, or cookies. Chrome blocks collection on protected pages.",
          ],
        },
        {
          title: "Information Stashwell uses",
          paragraphs: [
            "Stashwell uses Chrome's tabs permission to read the active tab's address, title, favicon, and loading state. This lets the panel follow the active tab and lets the background worker keep approved scans scoped to the tab and website. The tab's scan approval lasts for the browser session. Stashwell does not read Chrome's history database.",
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
            "Stashwell requests optional access to the active HTTP or HTTPS website when you choose Scan page and Chrome has not granted access to that site. File actions such as downloads, ZIP exports, SVG copying, and drag preparation can request access to the original hosts of the files you select. Chrome can remember site grants between tabs. You can review or remove them in Chrome's extension settings. Removing site access ends automatic collection for that site.",
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
