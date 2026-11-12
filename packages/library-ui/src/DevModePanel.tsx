import { useMemo, useState, type ReactNode } from "react";
import { Check, ChevronDown, Copy, ExternalLink, Globe, Info, Palette, Search, X } from "lucide-react";
import { normalizeDevInspection, selectMostUsedDevColors, type DevColor, type DevInspection, type PageCapture } from "@stashwell/core";

export type DevModeTab = "info" | "colors";
type CopyValue = (value: string, label?: string) => Promise<void>;
type InspectedPage = { capture: PageCapture; inspection: DevInspection };
type ColorFormat = "hex" | "rgb" | "hsl";
type Props = { captures: PageCapture[]; tab: DevModeTab; onCopy: CopyValue; onScan?: () => void; busy?: boolean };

function safeUrl(value?: string): string | undefined {
  if (!value) return;
  try {
    const url = new URL(value);
    if (["https:", "http:"].includes(url.protocol) && !url.username && !url.password) return url.href;
  } catch { /* Old imports may contain addresses that cannot be opened safely. */ }
}

function pageName(capture: PageCapture, inspection?: DevInspection): string {
  return inspection?.page.title || capture.pageTitle || capture.hostname || "Captured page";
}

function countLabel(count: number, noun: string, plural = `${noun}s`): string {
  return `${count.toLocaleString()} ${count === 1 ? noun : plural}`;
}

function CopyButton({ value, label, onCopy, children }: { value: string; label: string; onCopy: CopyValue; children?: ReactNode }) {
  return <button className="dev-copy" type="button" onClick={() => void onCopy(value, label.replace(/^Copy /, ""))} aria-label={label}><Copy size={14} aria-hidden="true" />{children}</button>;
}

function FactList({ facts }: { facts: [string, ReactNode][] }) {
  return <dl className="dev-facts">{facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value ?? "Not exposed"}</dd></div>)}</dl>;
}

function Section({ title, children, open = false, count, onCopy, copyText }: { title: string; children: ReactNode; open?: boolean; count?: number; onCopy?: CopyValue; copyText?: string }) {
  return <details className="dev-section" open={open}>
    <summary><ChevronDown size={16} aria-hidden="true" /><span>{title}</span>{count !== undefined && <small>{count.toLocaleString()}</small>}</summary>
    <div className="dev-section__body">{onCopy && copyText && <div className="dev-section__copy"><CopyButton value={copyText} label={`Copy ${title.toLowerCase()}`} onCopy={onCopy}>Copy details</CopyButton></div>}{children}</div>
  </details>;
}

function PaletteStrip({ colors, onCopy }: { colors: DevColor[]; onCopy: CopyValue }) {
  const mostUsed = selectMostUsedDevColors(colors);
  return <div className="dev-palette-strip" aria-label="Most-used computed colors">{mostUsed.map(color => <button key={color.hex} className="dev-palette-strip__color" type="button" style={{ flexGrow: Math.max(1, color.count) }} title={`${color.hex} · ${countLabel(color.count, "recorded use")}. Click to copy.`} aria-label={`Copy ${color.hex}, ${countLabel(color.count, "recorded use")}`} onClick={() => void onCopy(color.hex, "Color")}><span style={{ backgroundColor: color.hex }} /></button>)}</div>;
}

function paletteCss(colors: DevColor[]): string {
  return `:root {\n${colors.map((color, index) => `  --sw-color-${String(index + 1).padStart(3, "0")}: ${color.hex};`).join("\n")}\n}`;
}

function PageImage({ url, title }: { url?: string; title: string }) {
  const source = safeUrl(url);
  const [failed, setFailed] = useState<string>();
  if (!source || failed === source) return null;
  return <figure className="dev-site__image"><img src={source} alt={`${title} — page-declared social preview`} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(source)} /><figcaption>Page-declared social preview</figcaption></figure>;
}

function SourceLinks({ links, onCopy }: { links: { rel: string; url: string; language?: string }[]; onCopy: CopyValue }) {
  return <ul className="dev-source-list">{links.flatMap((link, index) => {
    const url = safeUrl(link.url);
    return url ? [<li key={`${link.rel}:${url}:${index}`}><span>{link.rel}{link.language ? ` · ${link.language}` : ""}</span><a href={url} target="_blank" rel="noreferrer">{url}<ExternalLink size={12} aria-hidden="true" /></a><CopyButton value={url} label={`Copy ${link.rel} URL`} onCopy={onCopy} /></li>] : [];
  })}</ul>;
}

function PageInfo({ page: { capture, inspection }, onCopy }: { page: InspectedPage; onCopy: CopyValue }) {
  const { page, document: doc, viewport, timing, technologies } = inspection;
  const title = pageName(capture, inspection);
  const source = safeUrl(page.url) || safeUrl(capture.pageUrl);
  const mediaCount = capture.resources.filter(resource => ["image", "video", "audio"].includes(resource.kind)).length;
  const mostUsed = selectMostUsedDevColors(inspection.colors);
  const links = [...page.links];
  if (page.canonicalUrl && !links.some(link => link.url === page.canonicalUrl && link.rel === "canonical")) links.unshift({ rel: "canonical", url: page.canonicalUrl });
  const uniqueLinks = links.filter((link, index) => links.findIndex(other => other.rel === link.rel && other.url === link.url && other.language === link.language) === index);
  const headingTotal = Object.values(doc.headingCounts).reduce((sum, count) => sum + count, 0);
  const milliseconds = (value?: number): string => value === undefined ? "Not available" : `${Math.round(value).toLocaleString()} ms`;
  const bytes = (value?: number): string => value === undefined ? "Not available" : `${value.toLocaleString()} bytes`;
  const viewportFacts: [string, ReactNode][] = [["Viewport", `${viewport.width.toLocaleString()} × ${viewport.height.toLocaleString()} CSS px`], ["Pixel ratio", viewport.devicePixelRatio], ["Color scheme", viewport.colorScheme], ["Document mode", viewport.documentMode]];
  const documentFacts: [string, ReactNode][] = [["Elements", doc.elementCount.toLocaleString()], ["Images", doc.imageCount.toLocaleString()], ["Images without alt", doc.imagesWithoutAlt.toLocaleString()], ["SVG elements", doc.svgCount.toLocaleString()], ["Links", doc.linkCount.toLocaleString()], ["External links", doc.externalLinkCount.toLocaleString()], ["Buttons", doc.buttonCount.toLocaleString()], ["Forms", doc.formCount.toLocaleString()], ["Inputs", doc.inputCount.toLocaleString()], ["Frames", doc.iframeCount.toLocaleString()], ["Stylesheets", doc.stylesheetCount.toLocaleString()], ["Scripts", doc.scriptCount.toLocaleString()]];
  const timingFacts: [string, ReactNode][] = timing ? [["Navigation type", timing.navigationType || "Not available"], ["Response duration", milliseconds(timing.responseMs)], ["DOM content loaded", milliseconds(timing.domContentLoadedMs)], ["Page load", milliseconds(timing.loadMs)], ["Transferred", bytes(timing.transferBytes)], ["Encoded document", bytes(timing.encodedBytes)], ["Decoded document", bytes(timing.decodedBytes)]] : [];
  const pageFacts: [string, ReactNode][] = [["Title", page.title || "Not exposed"], ["Description", page.description || "Not exposed"], ["Language", page.language || "Not exposed"], ["Charset", page.charset || "Not exposed"], ["Viewport metadata", page.viewport || "Not exposed"], ["Robots", page.robots || "Not exposed"], ["Generator", page.generator || "Not exposed"], ["Author", page.author || "Not exposed"], ["Theme color", page.themeColor || "Not exposed"]];
  return <article className="dev-page-info" data-dev-page={capture.id}>
    <section className="dev-site" aria-label={`Site overview: ${title}`}>
      <div className="dev-site__identity"><Globe size={20} aria-hidden="true" /><div><h2>{title}</h2><p>{capture.hostname || source || "Captured page"}</p></div></div>
      <PageImage url={page.ogImageUrl} title={title} />
      <div className="dev-site__body">{page.description && <p className="dev-site__description">{page.description}</p>}{source && <div className="dev-site__source"><a href={source} target="_blank" rel="noreferrer">{source}<ExternalLink size={13} aria-hidden="true" /></a><CopyButton value={source} label="Copy page URL" onCopy={onCopy} /></div>}<p className="dev-site__captured">Captured {new Date(inspection.capturedAt).toLocaleString()}</p></div>
    </section>
    <dl className="dev-resource-counts" aria-label="Captured resource counts">{[[capture.resources.length, "Resources"], [mediaCount, "Media items"], [doc.svgCount, "SVG elements"], [inspection.colors.length, "CSS colors"], [inspection.fonts.length, "Font families"]].map(([count, label]) => <div key={String(label)}><dt>{label}</dt><dd>{Number(count).toLocaleString()}</dd></div>)}</dl>
    {mostUsed.length > 0 && <section className="dev-most-used"><div className="dev-section-heading"><h3><Palette size={17} aria-hidden="true" />Most-used colors</h3><CopyButton value={mostUsed.map(color => color.hex).join("\n")} label="Copy most-used colors" onCopy={onCopy}>Copy</CopyButton></div><PaletteStrip colors={mostUsed} onCopy={onCopy} /></section>}
    <Section title="Built with" open count={technologies.length} onCopy={onCopy} copyText={technologies.map(tech => `${tech.name} (${tech.category})`).join("\n")}>
      {technologies.length ? <div className="dev-tech-list">{technologies.map(tech => <span className="dev-tech-badge" key={`${tech.category}:${tech.name}`}><span>{tech.name}</span><small>{tech.category}</small></span>)}</div> : <p className="dev-note">No technology signals detected.</p>}
    </Section>
    <Section title="SEO & page metadata" open onCopy={onCopy} copyText={pageFacts.map(([label, value]) => `${label}: ${value}`).join("\n")}>
      <ul className="dev-presence" aria-label="Page metadata presence">{[["Title", !!page.title], ["Description", !!page.description], ["Social image", !!safeUrl(page.ogImageUrl)], ["Canonical", !!safeUrl(page.canonicalUrl)]].map(([label, present]) => <li key={String(label)} className={present ? "dev-presence--present" : "dev-presence--missing"}>{present ? <Check size={13} aria-hidden="true" /> : <span aria-hidden="true">—</span>}{label}<span className="dev-sr-only">{present ? " found" : " not exposed"}</span></li>)}</ul>
      <FactList facts={pageFacts} />
      {page.metadata.length > 0 && <details className="dev-subdetails"><summary>All meta tags <small>{page.metadata.length.toLocaleString()}</small></summary><div className="dev-subdetails__body"><div className="dev-section__copy"><CopyButton value={page.metadata.map(meta => `${meta.name}: ${meta.value}`).join("\n")} label="Copy all meta tags" onCopy={onCopy}>Copy meta tags</CopyButton></div><dl className="dev-facts dev-facts--metadata">{page.metadata.map((meta, index) => <div key={`${meta.name}:${index}`}><dt>{meta.name}</dt><dd>{meta.value}</dd></div>)}</dl></div></details>}
    </Section>
    <Section title="Document structure" count={doc.elementCount} onCopy={onCopy} copyText={`${documentFacts.map(([label, value]) => `${label}: ${value}`).join("\n")}\n${Object.entries(doc.headingCounts).map(([name, count]) => `${name.toUpperCase()}: ${count}`).join("\n")}\nLandmarks: ${doc.landmarks.join(", ") || "Not exposed"}`}>
      <FactList facts={documentFacts} /><h4>Headings · {headingTotal.toLocaleString()}</h4><dl className="dev-heading-counts">{Object.entries(doc.headingCounts).map(([heading, count]) => <div key={heading}><dt>{heading.toUpperCase()}</dt><dd>{count.toLocaleString()}</dd></div>)}</dl><h4>Landmarks</h4>{doc.landmarks.length ? <ul className="dev-inline-list">{doc.landmarks.map(name => <li key={name}>{name}</li>)}</ul> : <p className="dev-note">No landmarks were exposed.</p>}
    </Section>
    <Section title="Viewport & rendering" onCopy={onCopy} copyText={viewportFacts.map(([label, value]) => `${label}: ${value}`).join("\n")}><FactList facts={viewportFacts} /></Section>
    <Section title="Navigation timing" onCopy={onCopy} copyText={timingFacts.map(([label, value]) => `${label}: ${value}`).join("\n")}>
      {timing ? <FactList facts={timingFacts} /> : <p className="dev-note">Navigation timing was not exposed by this page.</p>}
    </Section>
    <Section title="Font families" count={inspection.fonts.length} onCopy={onCopy} copyText={inspection.fonts.join("\n")}>
      {inspection.fonts.length ? <ul className="dev-font-list">{inspection.fonts.map(family => <li key={family}><span>{family}</span><CopyButton value={family} label={`Copy font family ${family}`} onCopy={onCopy} /></li>)}</ul> : <p className="dev-note">No font families were recorded in the sampled styles.</p>}
    </Section>
    <Section title="Page & stylesheet URLs" count={uniqueLinks.length} onCopy={onCopy} copyText={uniqueLinks.flatMap(link => safeUrl(link.url) ? [`${link.rel}: ${link.url}${link.language ? ` (${link.language})` : ""}`] : []).join("\n")}>
      {uniqueLinks.length ? <SourceLinks links={uniqueLinks} onCopy={onCopy} /> : <p className="dev-note">No reusable page links were exposed.</p>}
    </Section>
  </article>;
}

function ColorsPanel({ pages, onCopy }: { pages: InspectedPage[]; onCopy: CopyValue }) {
  const [format, setFormat] = useState<ColorFormat>("hex");
  const [query, setQuery] = useState("");
  const colors = useMemo(() => {
    const byHex = new Map<string, DevColor>();
    for (const { inspection } of pages) for (const color of inspection.colors) {
      const key = color.hex.toLowerCase();
      const previous = byHex.get(key);
      byHex.set(key, previous ? { ...previous, count: previous.count + color.count, properties: [...new Set([...previous.properties, ...color.properties])].sort(), variables: [...new Set([...previous.variables, ...color.variables])].sort() } : { ...color });
    }
    return selectMostUsedDevColors([...byHex.values()]);
  }, [pages]);
  const needle = query.trim().toLowerCase();
  const matches = colors.filter(color => !needle || [color.hex, color.rgb, color.hsl, ...color.properties, ...color.variables].join(" ").toLowerCase().includes(needle));
  return <section className="dev-colors" aria-label="Page colors" data-dev-panel="colors">
    <div className="dev-section-heading"><h2>Colors <span>{colors.length.toLocaleString()}</span></h2><CopyButton value={colors.map(color => color[format]).join("\n")} label="Copy all colors" onCopy={onCopy}>Copy all</CopyButton></div>
    {colors.length > 0 ? <>
      <section className="dev-most-used"><h3>Most used</h3><PaletteStrip colors={colors} onCopy={onCopy} /></section>
      <div className="dev-color-toolbar"><div className="dev-color-formats" role="group" aria-label="Color format">{(["hex", "rgb", "hsl"] as ColorFormat[]).map(value => <button type="button" key={value} aria-pressed={format === value} onClick={() => setFormat(value)}>{value.toUpperCase()}</button>)}</div><CopyButton value={paletteCss(colors)} label="Copy palette CSS" onCopy={onCopy}>Copy palette CSS</CopyButton></div>
      <label className="dev-color-search"><Search size={16} aria-hidden="true" /><input type="search" placeholder="Find a color, property or token" aria-label="Search colors" value={query} onChange={event => setQuery(event.target.value)} />{query && <button type="button" aria-label="Clear color search" onClick={() => setQuery("")}><X size={15} /></button>}</label>
      <p className="dev-color-results" role="status">{countLabel(matches.length, "color")}{needle ? ` matching “${query.trim()}”` : ", ordered by recorded uses"}</p>
      <div className="dev-color-list">{matches.map(color => <article className="dev-color" key={color.hex} data-dev-color={color.hex}>
        <button type="button" className="dev-color__swatch" aria-label={`Copy color ${color[format]}`} title={`Copy ${color[format]}`} onClick={() => void onCopy(color[format], "Color")}><span style={{ backgroundColor: color.hex }} /></button>
        <div className="dev-color__content"><div className="dev-color__heading"><strong>{color[format]}</strong><CopyButton value={color[format]} label={`Copy ${color[format]}`} onCopy={onCopy} /></div><span className="dev-color__count">{countLabel(color.count, "recorded use")}</span><details className="dev-color__details"><summary>Values & usage<ChevronDown size={13} aria-hidden="true" /></summary><div><FactList facts={[["HEX", color.hex], ["RGB", color.rgb], ["HSL", color.hsl]]} />{color.properties.length > 0 && <><h4>CSS properties</h4><p>{color.properties.join(", ")}</p></>}{color.variables.length > 0 && <><h4>Matching CSS tokens</h4><p>{color.variables.join(", ")}</p></>}</div></details></div>
      </article>)}</div>
      {!matches.length && <div className="dev-inline-empty"><h3>No matching colors</h3><p>Try a hex value, CSS property or token name.</p><button type="button" className="text-button" onClick={() => setQuery("")}>Clear search</button></div>}
    </> : <div className="dev-inline-empty"><Palette size={26} aria-hidden="true" /><h3>No colors recorded</h3><p>The sampled page did not expose usable computed color values.</p></div>}
  </section>;
}

export function DevModePanel({ captures, tab, onCopy, onScan, busy }: Props) {
  const pages = useMemo(() => captures.flatMap(capture => {
    const inspection = normalizeDevInspection(capture.devInspection);
    return inspection ? [{ capture, inspection }] : [];
  }), [captures]);
  const missing = captures.length - pages.length;
  if (!pages.length) return <section className="dev-empty" data-dev-panel={tab} aria-label={tab === "info" ? "Page information" : "Page colors"}><div className="dev-empty__mark">{tab === "info" ? <Info size={25} aria-hidden="true" /> : <Palette size={25} aria-hidden="true" />}</div><h2>Scan to inspect this page</h2><p>{onScan ? "Use Scan page to collect site details, technology signals and computed CSS colors. Older captures need a new scan to include this information." : "Open the source page in Chrome and use Scan page in the Stashwell extension to collect inspection details. For the web library, export the updated collection from the extension and import it here."}</p>{onScan && <button className="button button--primary" type="button" disabled={busy} onClick={onScan}>{busy ? "Scanning…" : "Scan page"}</button>}</section>;
  return <div className="dev-panel">
    {missing > 0 && <div className="dev-missing"><Info size={15} aria-hidden="true" /><p>{countLabel(missing, "captured page")} {missing === 1 ? "has" : "have"} no inspection details yet. Open {missing === 1 ? "it" : "each page"} and scan again to include {missing === 1 ? "it" : "them"}.</p></div>}
    {tab === "info" ? <section aria-label="Page information" data-dev-panel="info">{pages.length > 1 && <p className="dev-pages-count">Inspection details for {countLabel(pages.length, "captured page")}</p>}{pages.map(page => <PageInfo key={page.capture.id} page={page} onCopy={onCopy} />)}</section> : <ColorsPanel pages={pages} onCopy={onCopy} />}
  </div>;
}
