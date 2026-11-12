import type { DevColor, DevInspection } from "@stashwell/core";

/** Runs inside the inspected page. Keep every runtime helper inside this serialized function. */
export async function collectDevInspection(): Promise<DevInspection> {
  const MAX_ELEMENTS = 50_000, MAX_SAMPLED = 5_000, MAX_COLORS = 500, MAX_VARIABLES = 300, MAX_RULES = 8_000;
  const clean = (value: string | null | undefined, limit = 500) => (value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, limit);
  const safeUrl = (value: string | null | undefined): string | undefined => {
    if (!value || value.length > 8000) return undefined;
    try {
      const url = new URL(value, document.baseURI);
      return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : undefined;
    } catch { return undefined; }
  };
  const metadata: DevInspection["page"]["metadata"] = [];
  for (const element of Array.from(document.head?.querySelectorAll("meta") ?? []).slice(0, 300)) {
    const name = clean(element.getAttribute("property") || element.getAttribute("name") || element.getAttribute("http-equiv"), 120).toLowerCase();
    const value = clean(element.getAttribute("content"), 2000);
    // Only public document descriptors; arbitrary app tokens and form/session values are excluded.
    if (value && /^(?:title|description|keywords|author|generator|robots|googlebot|bingbot|viewport|theme-color|application-name|apple-mobile-web-app-(?:title|capable|status-bar-style)|format-detection|color-scheme|referrer|content-(?:type|language)|og:[\w:.-]+|twitter:[\w:.-]+|article:[\w:.-]+|product:[\w:.-]+)$/.test(name)) {
      metadata.push({ name, value });
      if (metadata.length >= 100) break;
    }
  }
  const meta = (...names: string[]) => names.map(name => metadata.find(item => item.name === name)?.value).find(Boolean);
  const links: DevInspection["page"]["links"] = [];
  for (const element of Array.from(document.head?.querySelectorAll<HTMLLinkElement>("link[rel][href]") ?? []).slice(0, 400)) {
    const rel = clean(element.rel.toLowerCase(), 100);
    const url = safeUrl(element.getAttribute("href"));
    if (url && /\b(?:canonical|alternate|icon|apple-touch-icon|apple-touch-startup-image|mask-icon|manifest|stylesheet|preconnect|dns-prefetch|preload|modulepreload)\b/.test(rel)) {
      links.push({ rel, url, language: clean(element.hreflang, 50) || undefined });
      if (links.length >= 100) break;
    }
  }
  const colors = new Map<string, DevColor>();
  const omitted = new Set<string>();
  const fonts = new Set<string>();
  const variableNames = new Set<string>();
  const variables = new Map<string, string>();
  const variableColors = new Map<string, Set<string>>();
  const variableColorValues = new Map<string, string>();
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const parsedColors = new Map<string, Omit<DevColor, "count" | "properties" | "variables"> | null>();
  const parseColor = (input: string): Omit<DevColor, "count" | "properties" | "variables"> | undefined => {
    const source = input.trim();
    if (!source || ["none", "transparent", "currentcolor", "inherit", "initial", "unset", "auto"].includes(source.toLowerCase()) || source.length > 200) return undefined;
    if (parsedColors.has(source)) return parsedColors.get(source) || undefined;
    let red = 0, green = 0, blue = 0, alpha = 1;
    const rgb = source.match(/^rgba?\(\s*([\d.]+)(%?)\s*[, ]\s*([\d.]+)(%?)\s*[, ]\s*([\d.]+)(%?)(?:\s*[,/]\s*([\d.]+)(%?))?\s*\)$/i);
    const hex = source.match(/^#([\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i);
    if (rgb) {
      red = Math.round(Math.min(255, Number(rgb[1]) * (rgb[2] ? 2.55 : 1)));
      green = Math.round(Math.min(255, Number(rgb[3]) * (rgb[4] ? 2.55 : 1)));
      blue = Math.round(Math.min(255, Number(rgb[5]) * (rgb[6] ? 2.55 : 1)));
      alpha = rgb[7] ? Math.min(1, Number(rgb[7]) / (rgb[8] ? 100 : 1)) : 1;
    } else if (hex) {
      const digits = hex[1].length <= 4 ? [...hex[1]].map(character => character + character).join("") : hex[1];
      red = parseInt(digits.slice(0, 2), 16); green = parseInt(digits.slice(2, 4), 16); blue = parseInt(digits.slice(4, 6), 16);
      alpha = digits.length === 8 ? parseInt(digits.slice(6, 8), 16) / 255 : 1;
    } else if (context && CSS.supports("color", source)) {
      context.clearRect(0, 0, 1, 1); context.fillStyle = source; context.fillRect(0, 0, 1, 1);
      const pixel = context.getImageData(0, 0, 1, 1).data;
      red = pixel[0]; green = pixel[1]; blue = pixel[2]; alpha = pixel[3] / 255;
    } else { parsedColors.set(source, null); return undefined; }
    const alphaByte = Math.round(alpha * 255);
    if (alpha < 1) { parsedColors.set(source, null); return undefined; }
    alpha = alphaByte / 255;
    const canonical = `#${[red, green, blue, ...(alphaByte < 255 ? [alphaByte] : [])].map(value => value.toString(16).padStart(2, "0")).join("")}`;
    const channels = [red / 255, green / 255, blue / 255], max = Math.max(...channels), min = Math.min(...channels), delta = max - min;
    const lightness = (max + min) / 2;
    let hue = 0;
    if (delta) hue = max === channels[0] ? ((channels[1] - channels[2]) / delta) % 6
      : max === channels[1] ? (channels[2] - channels[0]) / delta + 2 : (channels[0] - channels[1]) / delta + 4;
    const saturation = delta ? delta / (1 - Math.abs(2 * lightness - 1)) : 0;
    const opacity = Math.round(alpha * 1000) / 1000;
    const result = { hex: canonical, rgb: alphaByte < 255 ? `rgba(${red}, ${green}, ${blue}, ${opacity})` : `rgb(${red}, ${green}, ${blue})`,
      hsl: `hsl(${Math.round((hue * 60 + 360) % 360)} ${Math.round(saturation * 100)}% ${Math.round(lightness * 100)}%${alphaByte < 255 ? ` / ${opacity}` : ""})` };
    if (parsedColors.size < 4000) parsedColors.set(source, result);
    return result;
  };
  const colorTokens = (value: string): string[] => value.match(/#[\da-f]{3,8}\b|(?:rgba?|hsla?|color|oklab|oklch|lab|lch)\([^()]*\)/gi) ?? [];
  const safeVariableName = (name: string): boolean => {
    if (!/^--[a-zA-Z_][\w-]{0,118}$/.test(name)) return false;
    const words = name.slice(2).replace(/([a-z\d])([A-Z])/g, "$1-$2").replace(/_/g, "-").toLowerCase();
    // Keep ordinary design-token names while excluding credential-bearing properties.
    return !(/(?:^|-)(?:password|passwd|passphrase|secret|private|credentials?|authorization|authentication|auth|session|cookie|jwt|csrf|xsrf|bearer)(?:-|$)/.test(words)
      || /(?:^|-)(?:api|client|access|refresh|signing|encryption|public)[-]?(?:key|token|secret)(?:-|$)/.test(words)
      || /(?:^|-)id[-]?token(?:-|$)/.test(words));
  };
  const variableValue = (name: string, value: string) => {
    if (!safeVariableName(name) || !value || value.length > 600 || /[;{}\r\n\u0000]/.test(value)
      || /(?:url\s*\(|expression\s*\(|javascript:|<\/?(?:script|style))/i.test(value)) return;
    variableNames.add(name);
    if (variables.size < MAX_VARIABLES || variables.has(name)) variables.set(name, value.trim());
    const previous = variableColorValues.get(name);
    if (previous) variableColors.get(previous)?.delete(name);
    variableColorValues.delete(name);
    const color = parseColor(value);
    if (color) {
      const names = variableColors.get(color.hex) ?? new Set<string>();
      if (names.size < 30) names.add(name);
      variableColors.set(color.hex, names);
      variableColorValues.set(name, color.hex);
    }
  };
  const rootStyle = getComputedStyle(document.documentElement);
  // Root computed custom properties include inherited tokens from accessible and inaccessible sheets.
  for (let index = 0; index < Math.min(rootStyle.length, 3000); index++) {
    const name = rootStyle.item(index);
    if (name.startsWith("--")) variableValue(name, rootStyle.getPropertyValue(name).trim());
  }
  let unreadableStylesheets = 0, ruleCount = 0, cssTruncated = false;
  const seenSheets = new Set<CSSStyleSheet>();
  let tailwindSignal = false, bootstrapSignal = false;
  const readRules = (rules: CSSRuleList, depth: number) => {
    if (depth > 8) { cssTruncated = true; return; }
    for (let index = 0; index < rules.length; index++) {
      const rule = rules[index];
      if (++ruleCount > MAX_RULES) { cssTruncated = true; break; }
      const style = (rule as CSSStyleRule).style;
      if (style) {
        for (let index = 0; index < Math.min(style.length, 500); index++) {
          const name = style.item(index);
          if (name.startsWith("--tw-")) tailwindSignal = true;
          if (name.startsWith("--bs-")) bootstrapSignal = true;
          if (name.startsWith("--") && variableNames.size < 600) variableValue(name, style.getPropertyValue(name).trim());
        }
      }
      const children = (rule as CSSGroupingRule).cssRules;
      if (children) readRules(children, depth + 1);
      const imported = (rule as CSSImportRule).styleSheet;
      if (imported) readSheet(imported);
      if (ruleCount >= MAX_RULES) break;
    }
  };
  const readSheet = (sheet: CSSStyleSheet) => {
    if (seenSheets.has(sheet)) return;
    seenSheets.add(sheet);
    try { readRules(sheet.cssRules, 0); } catch { unreadableStylesheets++; }
  };
  const sheets = [...Array.from(document.styleSheets), ...Array.from(document.adoptedStyleSheets ?? [])];
  if (sheets.length > 200) cssTruncated = true;
  for (const sheet of sheets.slice(0, 200)) readSheet(sheet);
  // Resolve root tokens after reading stylesheet definitions so active root values win over inactive rules.
  for (const name of [...variableNames].slice(0, 600)) {
    const value = rootStyle.getPropertyValue(name).trim();
    if (value) variableValue(name, value);
  }
  const documentInfo: DevInspection["document"] = {
    elementCount: 0, imageCount: 0, imagesWithoutAlt: 0, svgCount: 0, linkCount: 0, externalLinkCount: 0,
    buttonCount: 0, formCount: 0, inputCount: 0, iframeCount: 0,
    stylesheetCount: document.styleSheets.length, scriptCount: 0,
    headingCounts: { h1: 0, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0 }, landmarks: [],
  };
  const landmarks = new Set<string>();
  const signals = new Map<string, { name: string; category: string; evidence: Set<string> }>();
  const signal = (name: string, category: string, evidence: string) => {
    const entry = signals.get(name) ?? { name, category, evidence: new Set<string>() };
    if (entry.evidence.size < 8) entry.evidence.add(evidence);
    signals.set(name, entry);
  };
  const inspectAssetUrl = (raw: string | null) => {
    const href = safeUrl(raw);
    if (!href) return;
    const url = new URL(href), path = url.pathname.toLowerCase(), host = url.hostname.toLowerCase();
    if (path.includes("/_next/")) signal("Next.js", "Framework", "Asset path contains /_next/");
    if (path.includes("/_nuxt/")) signal("Nuxt", "Framework", "Asset path contains /_nuxt/");
    if (path.includes("/wp-content/") || path.includes("/wp-includes/")) signal("WordPress", "CMS", "Asset path contains a WordPress directory");
    if (/^(?:www\.)?googletagmanager\.com$/.test(host)) {
      if (path.includes("/gtm.js")) signal("Google Tag Manager", "Analytics", "Script is loaded from googletagmanager.com/gtm.js");
      if (path.includes("/gtag/js")) signal("Google Analytics", "Analytics", "Google gtag script is present");
    }
    if (host === "www.google-analytics.com" || host === "google-analytics.com") signal("Google Analytics", "Analytics", "Asset is loaded from google-analytics.com");
    if (host === "cdn.shopify.com" || host.endsWith(".myshopify.com")) signal("Shopify", "Commerce", "Shopify asset host is present");
    if (host.endsWith(".webflow.com") || host === "cdn.prod.website-files.com" || host === "assets.website-files.com") signal("Webflow", "Site builder", "Webflow asset host is present");
    if (host === "js.stripe.com") signal("Stripe", "Payments", "Script is loaded from js.stripe.com");
    if (/^(?:www\.)?clarity\.ms$/.test(host)) signal("Microsoft Clarity", "Analytics", "Script is loaded from clarity.ms");
    if (host.endsWith(".hotjar.com") || host.endsWith(".hotjar.io")) signal("Hotjar", "Analytics", "Hotjar asset host is present");
    if (host.endsWith(".vercel-insights.com") || path.startsWith("/_vercel/insights/")) signal("Vercel Analytics", "Analytics", "Vercel Insights script path is present; hosting is not confirmed");
    if (host === "fonts.googleapis.com" || host === "fonts.gstatic.com") signal("Google Fonts", "Fonts", "Google Fonts asset host is present");
    if (/\bjquery(?:[.-][\d.]+)?(?:\.min)?\.js$/.test(path)) signal("jQuery", "Library", "jQuery script filename is present");
    if (/\bbootstrap(?:\.bundle)?(?:\.min)?\.(?:css|js)$/.test(path)) signal("Bootstrap", "UI library", "Bootstrap asset filename is present");
  };
  const generatedBy = meta("generator");
  if (generatedBy) {
    const known: Array<[RegExp, string, string]> = [[/\bnext(?:\.?js)?\b/i, "Next.js", "Framework"], [/\bnuxt\b/i, "Nuxt", "Framework"], [/\bwordpress\b/i, "WordPress", "CMS"], [/\bdrupal\b/i, "Drupal", "CMS"], [/\bjoomla\b/i, "Joomla", "CMS"], [/\bhugo\b/i, "Hugo", "Site generator"], [/\bgatsby\b/i, "Gatsby", "Framework"], [/\bwebflow\b/i, "Webflow", "Site builder"], [/\bwix\b/i, "Wix", "Site builder"], [/\bsquarespace\b/i, "Squarespace", "Site builder"]];
    for (const [pattern, name, category] of known) if (pattern.test(generatedBy)) signal(name, category, `Generator meta tag: ${clean(generatedBy, 180)}`);
  }
  for (const link of links) inspectAssetUrl(link.url);
  const isOpaqueStyle = (style: CSSStyleDeclaration): boolean => Number(style.opacity || "1") >= 1
    && ![...style.filter.matchAll(/opacity\(\s*([\d.]+)(%?)\s*\)/g)].some(match => Number(match[1]) / (match[2] ? 100 : 1) < 1);
  const opaqueAncestors = new WeakMap<Element, boolean>();
  const isFullyOpaque = (element: Element, elementStyle: CSSStyleDeclaration): boolean => {
    let current: Element | null = element;
    const chain: Element[] = [];
    let opaque = true;
    while (current) {
      const cached = opaqueAncestors.get(current);
      if (cached !== undefined) { opaque = cached; break; }
      chain.push(current);
      const style = current === element ? elementStyle : getComputedStyle(current);
      if (!isOpaqueStyle(style) || style.display === "none" || style.contentVisibility === "hidden") { opaque = false; break; }
      const root = current.getRootNode();
      current = current.assignedSlot || current.parentElement || (root instanceof ShadowRoot ? root.host : null);
    }
    for (const ancestor of chain) opaqueAncestors.set(ancestor, opaque);
    return opaque;
  };
  const addStyleColors = (style: CSSStyleDeclaration, used: Map<string, Set<string>>, hasText: boolean, isSvg = false, svgElement = isSvg) => {
    if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse" || !isOpaqueStyle(style)) return;
    const add = (property: string, value: string) => {
      for (const token of property.includes("image") || property.includes("shadow") ? colorTokens(value) : [value]) {
        const color = parseColor(token);
        if (!color) continue;
        if (!colors.has(color.hex)) {
          // Rank the whole sampled palette before applying the persisted-color limit.
          // Otherwise early one-off colors can displace a frequently used later color.
          if (colors.size >= 50_000) { if (omitted.size < 10_000) omitted.add(color.hex); continue; }
          colors.set(color.hex, { ...color, count: 0, properties: [], variables: [] });
        }
        const properties = used.get(color.hex) ?? new Set<string>();
        properties.add(property); used.set(color.hex, properties);
      }
    };
    for (const property of ["background-color", "background-image", "box-shadow"]) add(property, style.getPropertyValue(property));
    if (hasText && !svgElement) { add("color", style.color); add("text-shadow", style.textShadow); }
    for (const side of ["top", "right", "bottom", "left"]) {
      if (parseFloat(style.getPropertyValue(`border-${side}-width`)) > 0 && !["none", "hidden"].includes(style.getPropertyValue(`border-${side}-style`))) add(`border-${side}-color`, style.getPropertyValue(`border-${side}-color`));
    }
    if (parseFloat(style.outlineWidth) > 0 && style.outlineStyle !== "none") add("outline-color", style.outlineColor);
    if (style.textDecorationLine !== "none") add("text-decoration-color", style.textDecorationColor);
    if (isSvg) {
      if (Number(style.getPropertyValue("fill-opacity") || "1") >= 1) add("fill", style.getPropertyValue("fill"));
      if (Number(style.getPropertyValue("stroke-opacity") || "1") >= 1 && parseFloat(style.getPropertyValue("stroke-width")) > 0) add("stroke", style.getPropertyValue("stroke"));
    }
    const family = clean(style.fontFamily, 300);
    if (hasText && family && fonts.size < 100) fonts.add(family);
  };
  let sampledElements = 0, elementTruncated = false, lazyCount = 0;
  const queue: Element[] = document.documentElement ? [document.documentElement] : [];
  while (queue.length) {
    const element = queue.pop()!;
    if (++documentInfo.elementCount > MAX_ELEMENTS) { documentInfo.elementCount = MAX_ELEMENTS; elementTruncated = true; break; }
    const tag = element.localName.toLowerCase();
    for (let index = element.children.length - 1; index >= 0; index--) queue.push(element.children[index]);
    if (element.shadowRoot) {
      for (let index = element.shadowRoot.children.length - 1; index >= 0; index--) queue.push(element.shadowRoot.children[index]);
      for (const sheet of [...Array.from(element.shadowRoot.styleSheets ?? []), ...Array.from(element.shadowRoot.adoptedStyleSheets ?? [])].slice(0, 40)) readSheet(sheet);
    }
    if (/^h[1-6]$/.test(tag)) documentInfo.headingCounts[tag as keyof DevInspection["document"]["headingCounts"]]++;
    if (["header", "nav", "main", "aside", "footer"].includes(tag)) landmarks.add(tag);
    const role = element.getAttribute("role");
    if (role && /^(?:banner|navigation|main|complementary|contentinfo|search|region)$/.test(role)) landmarks.add(`role=${role}`);
    if (tag === "img") { documentInfo.imageCount++; if (!element.hasAttribute("alt")) documentInfo.imagesWithoutAlt++; }
    if (tag === "svg") documentInfo.svgCount++;
    if (tag === "button" || role === "button") documentInfo.buttonCount++;
    if (tag === "form") documentInfo.formCount++;
    if (["input", "textarea", "select"].includes(tag)) documentInfo.inputCount++;
    if (tag === "iframe") documentInfo.iframeCount++;
    if (tag === "script") { documentInfo.scriptCount++; inspectAssetUrl(element.getAttribute("src")); }
    if (tag === "a" && element.hasAttribute("href")) {
      documentInfo.linkCount++;
      const href = safeUrl(element.getAttribute("href"));
      if (href && new URL(href).origin !== location.origin) documentInfo.externalLinkCount++;
    }
    if ((tag === "img" || tag === "iframe") && element.getAttribute("loading") === "lazy") lazyCount++;
    if (element.hasAttribute("ng-version")) signal("Angular", "Framework", "DOM includes the Angular ng-version marker");
    if (element.hasAttribute("data-v-app") || Array.from(element.attributes).some(attribute => /^data-v-[a-f\d]{6,}$/i.test(attribute.name))) signal("Vue.js", "Framework", "DOM includes Vue application or scoped-style markers");
    if (element.hasAttribute("data-reactroot")) signal("React", "UI library", "DOM includes the data-reactroot marker");
    if (element.id === "__next" || element.id === "__NEXT_DATA__") signal("Next.js", "Framework", "DOM includes a Next.js root or data marker");
    if (element.id === "__nuxt" || element.id === "__NUXT_DATA__") signal("Nuxt", "Framework", "DOM includes a Nuxt root or data marker");
    if (element.hasAttribute("data-astro-cid") || tag.startsWith("astro-")) signal("Astro", "Framework", "DOM includes an Astro element or hydration marker");
    if (element.hasAttribute("data-framer-name") || element.hasAttribute("data-framer-component-type")) signal("Framer", "Site builder", "DOM includes Framer component markers");
    if (element.hasAttribute("data-wf-page") || element.hasAttribute("data-wf-site")) signal("Webflow", "Site builder", "DOM includes a Webflow page or site marker");
    if (element.hasAttribute("data-radix-collection-item") || element.hasAttribute("data-radix-popper-content-wrapper")) signal("Radix UI", "UI library", "DOM includes Radix UI component markers");
    if (sampledElements >= MAX_SAMPLED) { elementTruncated = true; continue; }
    if (["script", "style", "link", "meta", "head", "title", "noscript", "template"].includes(tag) || !element.getClientRects().length) continue;
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse" || !isFullyOpaque(element, style)) continue;
    sampledElements++;
    const used = new Map<string, Set<string>>();
    const hasText = Array.from(element.childNodes).slice(0, 200).some(node => node.nodeType === Node.TEXT_NODE && !!node.textContent?.trim());
    const svgElement = element.namespaceURI === "http://www.w3.org/2000/svg";
    const paintedSvg = svgElement && ["path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "text", "tspan", "use"].includes(tag);
    addStyleColors(style, used, hasText, paintedSvg, svgElement);
    for (const pseudo of svgElement ? [] : ["::before", "::after"]) {
      const pseudoStyle = getComputedStyle(element, pseudo);
      if (pseudoStyle.content && !["none", "normal"].includes(pseudoStyle.content)) addStyleColors(pseudoStyle, used, !['""', "''"].includes(pseudoStyle.content));
    }
    for (const [hex, properties] of used) {
      const color = colors.get(hex)!;
      color.count++;
      color.properties = [...new Set([...color.properties, ...properties])].slice(0, 20);
    }
  }
  if (tailwindSignal) signal("Tailwind CSS", "UI library", "Readable CSS declares --tw- utility variables");
  if (bootstrapSignal) signal("Bootstrap", "UI library", "Readable CSS declares --bs- design variables");
  if (lazyCount) signal("Native lazy loading", "Browser feature", `${lazyCount} image or iframe elements use loading=lazy`);
  documentInfo.landmarks = [...landmarks].sort();
  for (const color of colors.values()) color.variables = [...(variableColors.get(color.hex) ?? [])].sort();
  const rankedColors = [...colors.values()].sort((left, right) => right.count - left.count || left.hex.localeCompare(right.hex));
  const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  const metric = (value: number | undefined) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined;
  return {
    version: 1, capturedAt: new Date().toISOString(),
    page: { url: safeUrl(location.href) || "", title: clean(document.title, 1000), description: meta("description", "og:description", "twitter:description"),
      canonicalUrl: links.find(link => link.rel.split(/\s+/).includes("canonical"))?.url,
      language: clean(document.documentElement.lang, 50) || undefined, charset: clean(document.characterSet, 60) || undefined,
      viewport: meta("viewport"), robots: meta("robots"), generator: generatedBy, author: meta("author"), themeColor: meta("theme-color"),
      ogImageUrl: safeUrl(meta("og:image", "og:image:url", "twitter:image")), metadata, links },
    technologies: [...signals.values()].map(entry => ({ ...entry, evidence: [...entry.evidence] })).sort((left, right) => left.category.localeCompare(right.category) || left.name.localeCompare(right.name)),
    document: documentInfo, fonts: [...fonts].sort(), colors: rankedColors.slice(0, MAX_COLORS),
    cssVariables: [...variables].map(([name, value]) => ({ name, value })).sort((left, right) => left.name.localeCompare(right.name)),
    timing: navigation ? { navigationType: navigation.type, domContentLoadedMs: navigation.domContentLoadedEventEnd > 0 ? metric(navigation.domContentLoadedEventEnd - navigation.startTime) : undefined,
      loadMs: navigation.loadEventEnd > 0 ? metric(navigation.loadEventEnd - navigation.startTime) : undefined,
      responseMs: metric(navigation.responseEnd - navigation.requestStart), transferBytes: metric(navigation.transferSize), encodedBytes: metric(navigation.encodedBodySize), decodedBytes: metric(navigation.decodedBodySize) } : undefined,
    viewport: { width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio,
      colorScheme: matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light", documentMode: document.compatMode },
    coverage: { sampledElements, truncated: elementTruncated || cssTruncated || variableNames.size > MAX_VARIABLES, unreadableStylesheets, omittedColors: omitted.size + Math.max(0, rankedColors.length - MAX_COLORS) },
  };
}
