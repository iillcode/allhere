"use client";

import { sampleCaptures, type LibraryAdapter } from "@allhere/library-ui";

type PageCaptures = Awaited<ReturnType<LibraryAdapter["load"]>>;

function withLocalSampleImage(captures: PageCaptures): PageCaptures {
  if (typeof window === "undefined") return captures;

  const image = captures[0]?.resources.find(
    (resource) => resource.kind === "image",
  );
  if (image) {
    image.url = new URL(
      "/images/studio-workspace-generated.jpg",
      window.location.origin,
    ).href;
    image.width = 1200;
    image.height = 800;
  }
  return captures;
}

/** Isolated, reset-on-refresh data for the marketing previews. */
export function createDemoAdapter(): LibraryAdapter {
  let captures: PageCaptures = withLocalSampleImage(
    structuredClone(sampleCaptures),
  );
  const listeners = new Set<(captures: PageCaptures) => void>();

  return {
    getActivePage: async () => ({ tabId: 1, url: sampleCaptures[0].pageUrl, title: sampleCaptures[0].pageTitle, faviconUrl: sampleCaptures[0].faviconUrl, loading: false, revision: 0 }),
    subscribeActivePage: (listener) => {
      listener({ tabId: 1, url: sampleCaptures[0].pageUrl, title: sampleCaptures[0].pageTitle, faviconUrl: sampleCaptures[0].faviconUrl, loading: false, revision: 0 });
      return () => {};
    },
    load: async () => captures,
    save: async (next) => {
      captures = next;
      listeners.forEach((listener) => listener(captures));
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    captureCurrentPage: async () =>
      withLocalSampleImage(structuredClone(sampleCaptures))[0],
  };
}
