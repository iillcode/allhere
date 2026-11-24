import { resourceIdentityKeys, type PageCapture } from "@stashwell/core";

// Retain exclusions made before the Stashwell rename during automatic rescans.
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
  const keys = exclusions.resources[capture.pageUrl];
  if (!keys?.length) return capture;
  const excluded = new Set(keys);
  return { ...capture, resources: capture.resources.filter((resource) => !resourceIdentityKeys(resource).some(key => excluded.has(key))) };
}

export function restorePageCapture(exclusions: CaptureExclusions, pageUrl: string): CaptureExclusions {
  if (!exclusions.pages.includes(pageUrl) && !Object.hasOwn(exclusions.resources, pageUrl)) return exclusions;
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
