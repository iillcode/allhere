import { resourceIdentity, type PageCapture } from "@allhere/core";

export const CAPTURE_EXCLUSIONS_KEY = "allhere.capture-exclusions.v1";

export type CaptureExclusions = {
  pages: string[];
  resources: Record<string, string[]>;
};

export const emptyCaptureExclusions = (): CaptureExclusions => ({ pages: [], resources: {} });

export function normalizeCaptureExclusions(value: unknown): CaptureExclusions {
  if (!value || typeof value !== "object") return emptyCaptureExclusions();
  const record = value as Partial<CaptureExclusions>;
  return {
    pages: Array.isArray(record.pages) ? record.pages.filter((url): url is string => typeof url === "string") : [],
    resources: Object.fromEntries(Object.entries(record.resources && typeof record.resources === "object" ? record.resources : {})
      .filter(([, keys]) => Array.isArray(keys))
      .map(([url, keys]) => [url, keys.filter((key): key is string => typeof key === "string")])),
  };
}

export function filterExcludedCapture(capture: PageCapture, exclusions: CaptureExclusions): PageCapture | null {
  if (exclusions.pages.includes(capture.pageUrl)) return null;
  const excluded = new Set(exclusions.resources[capture.pageUrl] ?? []);
  return { ...capture, resources: capture.resources.filter((resource) => !excluded.has(resourceIdentity(resource))) };
}

export function restorePageCapture(exclusions: CaptureExclusions, pageUrl: string): CaptureExclusions {
  return {
    pages: exclusions.pages.filter((url) => url !== pageUrl),
    resources: Object.fromEntries(Object.entries(exclusions.resources).filter(([url]) => url !== pageUrl)),
  };
}

export function scopeSavedCaptures(captures: PageCapture[], savedOnly: boolean): PageCapture[] {
  return savedOnly ? captures.map((capture) => ({
    ...capture, resources: capture.resources.filter((resource) => resource.saved === true),
  })) : captures;
}
