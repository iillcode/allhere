import {
  createId,
  inspectResourceUrl,
  type CapturedResource,
  type PageCapture,
  type ResourceKind,
} from "@stashwell/core";

type SampleEntry = {
  kind: ResourceKind;
  url: string;
  label: string;
  alt?: string;
  width?: number;
  height?: number;
  mimeType?: string;
};

const pageUrl = "https://developer.chrome.com/docs/extensions/develop/concepts/activeTab/";
const pageTitle = "The activeTab permission";
const capturedAt = "2026-10-09T15:42:00.000Z";

const entries: SampleEntry[] = [
  {
    kind: "image",
    url: "https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=900&q=80",
    label: "Quiet studio workspace",
    alt: "A shared studio with a long wooden work table",
    width: 900,
    height: 600,
  },
  {
    kind: "link",
    url: "https://developer.chrome.com/docs/extensions/reference/api/sidePanel/",
    label: "Side Panel API reference",
  },
  {
    kind: "document",
    url: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
    label: "Accessibility review.pdf",
    mimeType: "pdf",
  },
  {
    kind: "video",
    url: "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
    label: "Flower study.mp4",
    mimeType: "video/mp4",
  },
  {
    kind: "link",
    url: "http://example.com/reading-list",
    label: "Reading list · HTTP",
  },
  {
    kind: "link",
    url: "https://bit.ly/field-notes",
    label: "Field notes · shortened link",
  },
  {
    kind: "stylesheet",
    url: "https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap",
    label: "Roboto web font",
    mimeType: "text/css",
  },
];

const resources: CapturedResource[] = entries.map((entry) => ({
  ...entry,
  id: createId("sample"),
  pageUrl,
  pageTitle,
  capturedAt,
  security: inspectResourceUrl(entry.url, pageUrl, capturedAt),
}));

export const sampleCaptures: PageCapture[] = [
  {
    id: "sample_capture_browser_fundamentals",
    pageUrl,
    pageTitle,
    hostname: "developer.chrome.com",
    capturedAt,
    resources,
  },
  {
    id: "sample_capture_design_notes",
    pageUrl: "https://material.io/design/introduction",
    pageTitle: "Design notes for the web",
    hostname: "material.io",
    capturedAt: "2026-10-08T09:15:00.000Z",
    resources: [
      {
        id: "sample_material_link",
        kind: "link",
        url: "https://material.io/design/introduction",
        pageUrl: "https://material.io/design/introduction",
        pageTitle: "Design notes for the web",
        label: "Material design foundations",
        capturedAt: "2026-10-08T09:15:00.000Z",
        security: inspectResourceUrl(
          "https://material.io/design/introduction",
          "https://material.io/design/introduction",
          "2026-10-08T09:15:00.000Z",
        ),
      },
    ],
  },
];
