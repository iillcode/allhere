export const CAPTURE_ACCESS_KEY = "stashwell.capture.enabled-tabs";

export function websiteOrigin(url?: string): string | undefined {
  try {
    const parsed = new URL(url ?? "");
    if (/^https?:$/.test(parsed.protocol) && !parsed.username && !parsed.password && !parsed.hostname.includes("*")) return parsed.origin;
  } catch { /* Inline and browser resources have no website grant. */ }
}

export function websitePattern(url?: string): string | undefined {
  const origin = websiteOrigin(url);
  if (!origin) return undefined;
  const { protocol, hostname } = new URL(origin);
  return `${protocol}//${hostname}/*`;
}

type PermissionsApi = { request: (permissions: { origins: string[] }) => Promise<boolean> };

// Call directly from a click, while Chrome still has the user gesture.
export function requestWebsiteAccess(urls: readonly (string | undefined)[]): Promise<boolean> {
  const origins = [...new Set(urls.map(websitePattern).filter((origin): origin is string => Boolean(origin)))];
  if (!origins.length || globalThis.location?.protocol !== "chrome-extension:") return Promise.resolve(true);
  const permissions = (globalThis as typeof globalThis & { chrome?: { permissions?: PermissionsApi } }).chrome?.permissions;
  if (!permissions) return Promise.reject(new Error("Reload Stashwell to enable website access."));
  return permissions.request({ origins });
}
