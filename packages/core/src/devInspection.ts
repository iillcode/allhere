export type DevColor = {
  hex: string;
  rgb: string;
  hsl: string;
  /** Number of sampled elements using this color, not percentage of page pixels. */
  count: number;
  properties: string[];
  variables: string[];
};

/** The visible palette prioritizes repeated colors; full scan records remain in the capture. */
export function selectMostUsedDevColors(colors: readonly DevColor[]): DevColor[] {
  const byHex = new Map<string, DevColor>();
  for (const color of colors) {
    if (!/^#[\da-f]{6}(?:ff)?$/i.test(color.hex) || !Number.isFinite(color.count) || color.count <= 0) continue;
    const hex = color.hex.slice(0, 7).toLowerCase();
    const previous = byHex.get(hex);
    byHex.set(hex, previous ? { ...previous, count: previous.count + color.count,
      properties: [...new Set([...previous.properties, ...color.properties])],
      variables: [...new Set([...previous.variables, ...color.variables])] } : { ...color, hex });
  }
  const ranked = [...byHex.values()].sort((a, b) => b.count - a.count || a.hex.localeCompare(b.hex));
  const repeated = ranked.filter(color => color.count > 1);
  return (repeated.length ? repeated : ranked).slice(0, 12);
}

export type DevInspection = {
  version: 1;
  capturedAt: string;
  page: {
    url: string; title: string; description?: string; canonicalUrl?: string; language?: string;
    charset?: string; viewport?: string; robots?: string; generator?: string; author?: string;
    themeColor?: string; ogImageUrl?: string;
    metadata: Array<{ name: string; value: string }>;
    links: Array<{ rel: string; url: string; language?: string }>;
  };
  technologies: Array<{ name: string; category: string; evidence: string[] }>;
  document: {
    elementCount: number; imageCount: number; imagesWithoutAlt: number; svgCount: number;
    linkCount: number; externalLinkCount: number; buttonCount: number; formCount: number;
    inputCount: number; iframeCount: number; stylesheetCount: number; scriptCount: number;
    headingCounts: Record<"h1" | "h2" | "h3" | "h4" | "h5" | "h6", number>;
    landmarks: string[];
  };
  fonts: string[];
  colors: DevColor[];
  cssVariables: Array<{ name: string; value: string }>;
  timing?: {
    navigationType?: string; domContentLoadedMs?: number; loadMs?: number; responseMs?: number;
    transferBytes?: number; encodedBytes?: number; decodedBytes?: number;
  };
  viewport: { width: number; height: number; devicePixelRatio: number; colorScheme: string; documentMode: string };
  coverage: { sampledElements: number; truncated: boolean; unreadableStylesheets: number; omittedColors: number };
};

/** Validate both persisted captures and imported archives before displaying or copying their data. */
export function normalizeDevInspection(value: unknown): DevInspection | undefined {
  const record = (input: unknown): Record<string, unknown> | undefined => input !== null
    && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : undefined;
  const text = (input: unknown, limit = 500): string => typeof input === "string"
    ? input.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, limit) : "";
  const number = (input: unknown, max = 1_000_000): number => typeof input === "number" && Number.isFinite(input)
    ? Math.min(max, Math.max(0, Math.round(input))) : 0;
  const strings = (input: unknown, cap: number, limit = 120): string[] => Array.isArray(input)
    ? [...new Set(input.slice(0, cap).map(item => text(item, limit)).filter(Boolean))] : [];
  const url = (input: unknown): string | undefined => {
    if (typeof input !== "string" || input.length > 8000 || /[\u0000-\u0020\u007f]/.test(input)) return undefined;
    try {
      const parsed = new URL(input);
      return ["http:", "https:"].includes(parsed.protocol) && !parsed.username && !parsed.password ? parsed.href : undefined;
    } catch { return undefined; }
  };
  const cssValue = (input: unknown): string => typeof input === "string" && input.length <= 600
    && !/[;{}\r\n\u0000]/.test(input) && !/(?:url\s*\(|expression\s*\(|javascript:|<\/?(?:script|style))/i.test(input)
    ? input.trim() : "";
  const cssName = (input: unknown): string => {
    if (typeof input !== "string" || !/^--[a-zA-Z_][\w-]{0,118}$/.test(input)) return "";
    const words = input.slice(2).replace(/([a-z\d])([A-Z])/g, "$1-$2").replace(/_/g, "-").toLowerCase();
    // "Token" alone is a normal design term; credential-related tokens are not.
    const sensitive = /(?:^|-)(?:password|passwd|passphrase|secret|private|credentials?|authorization|authentication|auth|session|cookie|jwt|csrf|xsrf|bearer)(?:-|$)/.test(words)
      || /(?:^|-)(?:api|client|access|refresh|signing|encryption|public)[-]?(?:key|token|secret)(?:-|$)/.test(words)
      || /(?:^|-)id[-]?token(?:-|$)/.test(words);
    return sensitive ? "" : input;
  };
  const input = record(value);
  const page = record(input?.page);
  const pageUrl = url(page?.url);
  const document = record(input?.document);
  const viewport = record(input?.viewport);
  const coverage = record(input?.coverage);
  if (input?.version !== 1 || !page || !pageUrl || !document || !viewport || !coverage
    || typeof input.capturedAt !== "string" || input.capturedAt.length > 80 || !Number.isFinite(Date.parse(input.capturedAt))) return undefined;
  const optionalText = (key: string, limit = 500) => text(page[key], limit) || undefined;
  const metadata = Array.isArray(page.metadata) ? page.metadata.slice(0, 100).flatMap(item => {
    const entry = record(item);
    const name = text(entry?.name, 120);
    const content = text(entry?.value, 2000);
    return name && content && /^(?:title|description|keywords|author|generator|robots|googlebot|bingbot|viewport|theme-color|application-name|apple-mobile-web-app-(?:title|capable|status-bar-style)|format-detection|color-scheme|referrer|content-(?:type|language)|og:[\w:.-]+|twitter:[\w:.-]+|article:[\w:.-]+|product:[\w:.-]+)$/i.test(name)
      ? [{ name, value: content }] : [];
  }) : [];
  const links = Array.isArray(page.links) ? page.links.slice(0, 100).flatMap(item => {
    const entry = record(item);
    const href = url(entry?.url);
    const rel = text(entry?.rel, 100);
    return href && /^[\w -]+$/.test(rel) ? [{ rel, url: href, language: text(entry?.language, 50) || undefined }] : [];
  }) : [];
  const properties = new Set(["color", "background-color", "background-image", "border-top-color", "border-right-color", "border-bottom-color", "border-left-color", "outline-color", "text-decoration-color", "box-shadow", "text-shadow", "fill", "stroke", "accent-color", "caret-color"]);
  const colors: DevColor[] = Array.isArray(input.colors) ? input.colors.slice(0, 50_000).flatMap(item => {
    const entry = record(item);
    if (typeof entry?.hex !== "string" || !/^#[\da-f]{6}(?:[\da-f]{2})?$/i.test(entry.hex)) return [];
    const hex = entry.hex.toLowerCase().replace(/^((?:#[\da-f]{6}))ff$/, "$1");
    const red = parseInt(hex.slice(1, 3), 16), green = parseInt(hex.slice(3, 5), 16), blue = parseInt(hex.slice(5, 7), 16);
    const alpha = hex.length === 9 ? parseInt(hex.slice(7, 9), 16) / 255 : 1;
    if (alpha < 1) return [];
    const channels = [red / 255, green / 255, blue / 255];
    const max = Math.max(...channels), min = Math.min(...channels), delta = max - min;
    const lightness = (max + min) / 2;
    let hue = 0;
    if (delta) hue = max === channels[0] ? ((channels[1] - channels[2]) / delta) % 6
      : max === channels[1] ? (channels[2] - channels[0]) / delta + 2 : (channels[0] - channels[1]) / delta + 4;
    hue = Math.round((hue * 60 + 360) % 360);
    const saturation = delta ? delta / (1 - Math.abs(2 * lightness - 1)) : 0;
    const opacity = Math.round(alpha * 1000) / 1000;
    return [{ hex, rgb: alpha < 1 ? `rgba(${red}, ${green}, ${blue}, ${opacity})` : `rgb(${red}, ${green}, ${blue})`,
      hsl: `hsl(${hue} ${Math.round(saturation * 100)}% ${Math.round(lightness * 100)}%${alpha < 1 ? ` / ${opacity}` : ""})`,
      count: number(entry.count), properties: strings(entry.properties, 20).filter(property => properties.has(property)),
      variables: strings(entry.variables, 30).filter(name => !!cssName(name)),
    }];
  }).sort((left, right) => right.count - left.count || left.hex.localeCompare(right.hex)).slice(0, 500) : [];
  const counts = record(document.headingCounts);
  const headingCounts = { h1: number(counts?.h1), h2: number(counts?.h2), h3: number(counts?.h3), h4: number(counts?.h4), h5: number(counts?.h5), h6: number(counts?.h6) };
  const timingInput = record(input.timing);
  const timing: DevInspection["timing"] = timingInput ? {} : undefined;
  if (timing && timingInput) {
    if (typeof timingInput.navigationType === "string" && ["navigate", "reload", "back_forward", "prerender"].includes(timingInput.navigationType)) timing.navigationType = timingInput.navigationType;
    for (const name of ["domContentLoadedMs", "loadMs", "responseMs", "transferBytes", "encodedBytes", "decodedBytes"] as const) {
      if (typeof timingInput[name] === "number" && Number.isFinite(timingInput[name]) && timingInput[name] >= 0) timing[name] = number(timingInput[name], name.endsWith("Bytes") ? 1_000_000_000_000 : 86_400_000);
    }
  }
  const result: DevInspection = {
    version: 1, capturedAt: new Date(input.capturedAt).toISOString(),
    page: { url: pageUrl, title: text(page.title, 1000), description: optionalText("description", 2000), canonicalUrl: url(page.canonicalUrl),
      language: optionalText("language", 50), charset: optionalText("charset", 60), viewport: optionalText("viewport"), robots: optionalText("robots"),
      generator: optionalText("generator"), author: optionalText("author"), themeColor: optionalText("themeColor", 100), ogImageUrl: url(page.ogImageUrl), metadata, links },
    technologies: Array.isArray(input.technologies) ? input.technologies.slice(0, 50).flatMap(item => {
      const entry = record(item), name = text(entry?.name, 80), category = text(entry?.category, 60), evidence = strings(entry?.evidence, 8, 300);
      return name && category && evidence.length ? [{ name, category, evidence }] : [];
    }) : [],
    document: { elementCount: number(document.elementCount), imageCount: number(document.imageCount), imagesWithoutAlt: number(document.imagesWithoutAlt),
      svgCount: number(document.svgCount), linkCount: number(document.linkCount), externalLinkCount: number(document.externalLinkCount),
      buttonCount: number(document.buttonCount), formCount: number(document.formCount), inputCount: number(document.inputCount), iframeCount: number(document.iframeCount),
      stylesheetCount: number(document.stylesheetCount), scriptCount: number(document.scriptCount), headingCounts, landmarks: strings(document.landmarks, 30, 80) },
    fonts: strings(input.fonts, 100, 300).filter(font => !!cssValue(font)), colors,
    cssVariables: Array.isArray(input.cssVariables) ? input.cssVariables.slice(0, 300).flatMap(item => {
      const entry = record(item), name = cssName(entry?.name), value = cssValue(entry?.value);
      return name && value ? [{ name, value }] : [];
    }) : [],
    timing,
    viewport: { width: number(viewport.width, 100_000), height: number(viewport.height, 100_000),
      devicePixelRatio: typeof viewport.devicePixelRatio === "number" && Number.isFinite(viewport.devicePixelRatio) ? Math.max(0.1, Math.min(20, viewport.devicePixelRatio)) : 1,
      colorScheme: viewport.colorScheme === "dark" ? "dark" : "light", documentMode: viewport.documentMode === "CSS1Compat" ? "Standards" : viewport.documentMode === "BackCompat" || viewport.documentMode === "Quirks" ? "Quirks" : "Standards" },
    coverage: { sampledElements: number(coverage.sampledElements, 10_000), truncated: coverage.truncated === true,
      unreadableStylesheets: number(coverage.unreadableStylesheets, 10_000), omittedColors: number(coverage.omittedColors, 1_000_000) },
  };
  // Match chrome.storage/JSON archive shape: omit absent optional fields consistently.
  return JSON.parse(JSON.stringify(result)) as DevInspection;
}
