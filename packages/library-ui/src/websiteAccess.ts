type PermissionsApi = {
  request: (permissions: { origins: string[] }) => Promise<boolean>;
};

export function websiteOrigins(urls: Array<string | undefined>): string[] {
  const origins = new Set<string>();
  for (const value of urls) {
    if (!value) continue;
    try {
      const url = new URL(value);
      if (/^https?:$/.test(url.protocol) && !url.hostname.includes("*")) {
        origins.add(`${url.protocol}//${url.hostname}/*`);
      }
    } catch { /* Inline resources do not need website access. */ }
  }
  return [...origins];
}

// Invoke from the requested scan, download, or preparation action. Never request
// all-site access or show a permission prompt from a hover or background event.
export function requestWebsiteAccess(origins: string[]): Promise<boolean> {
  if (!origins.length) return Promise.resolve(true);
  const scopedOrigins = websiteOrigins(origins);
  if (origins.some(origin => !scopedOrigins.includes(origin))) {
    return Promise.reject(new Error("Choose a specific website to allow access."));
  }
  const permissions = (globalThis as typeof globalThis & { chrome?: { permissions?: PermissionsApi } }).chrome?.permissions;
  if (!permissions) return Promise.reject(new Error("Reload the Stashwell extension to enable website access."));
  return permissions.request({ origins: scopedOrigins });
}
