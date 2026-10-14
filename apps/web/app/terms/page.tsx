import type { Metadata } from "next";
import LegalPage from "../LegalPage";

export const metadata: Metadata = {
  title: "Terms — Allhere",
  description: "Terms for using the Allhere developer preview.",
};

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of use"
      description="These terms describe the current Allhere browser extension preview."
      sections={[
        {
          title: "Developer preview",
          paragraphs: [
            "Allhere is a product preview. Features, supported resources, and availability may change as the product is developed.",
          ],
        },
        {
          title: "Using Allhere",
          paragraphs: [
            "Click Allhere's toolbar icon on a webpage to give temporary access to that tab, then choose Scan page to start a scan. On a new tab or after navigating to a different site, click the toolbar icon again before scanning. Chrome may ask you to allow access to a resource's original host before a file action. Use Allhere only with webpages and resources you are authorized to access. The extension can collect only resources available under Chrome's permissions.",
          ],
        },
        {
          title: "Link signals",
          paragraphs: [
            "Link signals describe URL patterns and connection details that Allhere can inspect locally. They are informational and do not guarantee that a destination, page, or file is safe.",
          ],
        },
        {
          title: "Your library",
          paragraphs: [
            "The extension and web library keep separate local collections. They do not sync automatically; moving a collection between them requires a JSON export and import.",
          ],
        },
      ]}
    />
  );
}
