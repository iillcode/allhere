import type { Metadata } from "next";
import LegalPage from "../LegalPage";

export const metadata: Metadata = {
  title: "Privacy — Allhere",
  description: "How the Allhere preview handles captured resources and link checks.",
};

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy overview"
      description="A plain-language summary of how the current Allhere preview handles library data."
      sections={[
        {
          title: "Scans start with you",
          paragraphs: [
            "Allhere does not scan pages automatically. When you choose Scan page, the extension reads resource addresses it can access on the active webpage and adds them to your collection.",
          ],
        },
        {
          title: "Local library storage",
          paragraphs: [
            "The extension stores its collection in Chrome local storage. The web library stores its own collection in browser local storage. These collections are separate and are not automatically synced to a cloud account.",
            "You can move a collection between the two surfaces by exporting and importing a JSON archive.",
          ],
        },
        {
          title: "Link signals",
          paragraphs: [
            "Link checks run locally using visible URL patterns. The preview does not send URLs to an external reputation service.",
          ],
        },
        {
          title: "Opening resources",
          paragraphs: [
            "When you choose to open, preview, or download a captured resource, your browser may connect to that resource's original host. That host and your browser apply their own data practices.",
          ],
        },
      ]}
    />
  );
}
