import type { Metadata } from "next";
import LegalPage from "../LegalPage";

export const metadata: Metadata = {
  title: "Terms — Stashwell",
  description: "Terms for using the Stashwell developer preview.",
};

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of use"
      description="These terms describe the current Stashwell browser extension preview."
      sections={[
        {
          title: "Developer preview",
          paragraphs: [
            "Stashwell is a product preview. Features, supported resources, and availability may change as the product is developed.",
          ],
        },
        {
          title: "Using Stashwell",
          paragraphs: [
            "Choose Scan page to start collecting resources in a tab and allow site access if Chrome asks. Automatic updates apply to that tab while it is active on the same site. You can manage website access in Chrome's extension settings. Use Stashwell only with webpages and resources you are authorized to access.",
          ],
        },
        {
          title: "Link signals",
          paragraphs: [
            "Link signals describe URL patterns and connection details that Stashwell can inspect locally. They are informational and do not guarantee that a destination, page, or file is safe.",
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
