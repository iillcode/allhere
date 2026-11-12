import { useEffect, useRef, useState } from "react";
import { ChevronDown, Copy, ExternalLink, Type } from "lucide-react";
import { normalizeTypography, type PageCapture, type TypographyFontSource, type TypographyStyle } from "@stashwell/core";
import { previewFontFamily } from "./fontPreview";

const sample = "AaBbCcDdEeFfGgHh";
type Entry = { capture: PageCapture; style: TypographyStyle };

export function typographyEntries(captures: PageCapture[], query = ""): Entry[] {
  const needle = query.trim().toLocaleLowerCase();
  return captures.flatMap(capture => normalizeTypography(capture.typography).map(style => ({ capture, style })))
    .filter(({ capture, style }) => !needle || [style.label, style.fontFamily, style.fontSize, style.fontWeight, capture.pageTitle, capture.hostname,
      ...style.sources.flatMap(source => [source.url, source.stylesheetUrl ?? ""])].some(value => value.toLocaleLowerCase().includes(needle)));
}

function includesSample(range?: string): boolean {
  if (!range) return true;
  const ranges = range.split(",").flatMap(part => {
    const match = part.trim().match(/^U\+([\da-f?]+)(?:-([\da-f]+))?$/i);
    return match ? [[parseInt(match[1].replaceAll("?", "0"), 16), parseInt(match[2] || match[1].replaceAll("?", "f"), 16)]] : [];
  });
  return [...sample].every(char => ranges.some(([start, end]) => char.codePointAt(0)! >= start && char.codePointAt(0)! <= end));
}

function preferredSource(style: TypographyStyle): TypographyFontSource | undefined {
  const family = style.fontFamily.split(",")[0].trim().replace(/^["']|["']$/g, "").toLowerCase();
  const weight = Number(style.fontWeight === "bold" ? 700 : style.fontWeight === "normal" ? 400 : style.fontWeight);
  return style.sources.filter(source => source.family.toLowerCase() === family && includesSample(source.unicodeRange))
    .sort((left, right) => {
      const score = (source: TypographyFontSource) => {
        const weights = source.weight.replace("normal", "400").replace("bold", "700").split(/\s+/).map(Number);
        return (weight >= weights[0] && weight <= (weights[1] ?? weights[0]) ? 4 : 0)
          + (source.style.split(" ")[0] === style.fontStyle.split(" ")[0] ? 2 : 0) + (/\.woff2(?:[?#]|$)/i.test(source.url) ? 1 : 0);
      };
      return score(right) - score(left);
    })[0];
}

function cssFor(style: TypographyStyle): string {
  const source = preferredSource(style);
  const face = source ? `@font-face {\n  font-family: ${JSON.stringify(source.family)};\n  src: url(${JSON.stringify(source.url)});\n  font-weight: ${source.weight};\n  font-style: ${source.style};\n  font-display: swap;${source.unicodeRange ? `\n  unicode-range: ${source.unicodeRange};` : ""}\n}\n\n` : "";
  const selector = style.label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return `${face}.${selector} {\n  font-family: ${style.fontFamily};\n  font-size: ${style.fontSize};\n  font-weight: ${style.fontWeight};\n  font-style: ${style.fontStyle};\n  line-height: ${style.lineHeight};\n  letter-spacing: ${style.letterSpacing};\n  text-transform: ${style.textTransform};\n}`;
}

function TypographyCard({ entry: { style, capture }, showPage, onCopy }: { entry: Entry; showPage: boolean; onCopy: (value: string, label: string) => Promise<void> }) {
  const source = preferredSource(style);
  const [font, setFont] = useState<{ url: string; family?: string; done: boolean }>();
  const sampleRef = useRef<HTMLParagraphElement>(null);
  const sampleWrapRef = useRef<HTMLDivElement>(null);
  const [fitted, setFitted] = useState(false);
  const sourceKey = source ? JSON.stringify([source.url, source.weight, source.style, source.unicodeRange]) : "";
  useEffect(() => {
    let active = true;
    if (!source) return;
    setFont({ url: sourceKey, done: false });
    void previewFontFamily(source.url, { weight: source.weight, style: source.style, ...(source.unicodeRange ? { unicodeRange: source.unicodeRange } : {}) })
      .then(family => { if (active) setFont({ url: sourceKey, family, done: true }); });
    return () => { active = false; };
  }, [sourceKey]);
  const loaded = font?.url === sourceKey ? font : undefined;
  useEffect(() => {
    const element = sampleRef.current, wrapper = sampleWrapRef.current;
    if (!element || !wrapper) return;
    const fit = () => {
      element.style.fontSize = style.fontSize;
      element.style.lineHeight = style.lineHeight;
      element.style.letterSpacing = style.letterSpacing;
      const ratio = Math.min(1, Math.max(1, wrapper.clientWidth - 2) / Math.max(1, element.scrollWidth));
      if (ratio < 1) {
        element.style.fontSize = `${parseFloat(style.fontSize) * ratio}px`;
        if (style.lineHeight !== "normal") element.style.lineHeight = `${parseFloat(style.lineHeight) * ratio}px`;
        if (style.letterSpacing !== "normal") element.style.letterSpacing = `${parseFloat(style.letterSpacing) * ratio}px`;
      }
      setFitted(ratio < .99);
    };
    fit();
    const observer = new ResizeObserver(fit); observer.observe(wrapper);
    return () => observer.disconnect();
  }, [style.fontSize, style.lineHeight, style.letterSpacing, loaded?.family]);
  const weightNames: Record<string, string> = { "100": "Thin", "200": "Extra light", "300": "Light", "400": "Regular", "500": "Medium", "600": "Semibold", "700": "Bold", "800": "Extra bold", "900": "Black" };
  const weightName = weightNames[style.fontWeight];
  const stylesheetUrls = [...new Set(style.sources.flatMap(value => value.stylesheetUrl ? [value.stylesheetUrl] : []))];
  return <article className="typography-card" data-typography-id={style.id}>
    <div className="typography-card__header"><h3>{style.label}</h3><span>{style.instances} {style.instances === 1 ? "instance" : "instances"}</span></div>
    {showPage && <p className="typography-card__page">{capture.pageTitle || capture.hostname}</p>}
    <div ref={sampleWrapRef} className="typography-card__sample-wrap">
      <p ref={sampleRef} className={`typography-card__sample${loaded?.family ? " typography-card__sample--loaded" : ""}`} style={{
        fontFamily: loaded?.family ? `"${loaded.family}", ${style.fontFamily}` : style.fontFamily,
        fontSize: style.fontSize, fontWeight: style.fontWeight, fontStyle: style.fontStyle,
        lineHeight: style.lineHeight, letterSpacing: style.letterSpacing, textTransform: style.textTransform as "none",
      }}>{sample}</p>
    </div>
    <div className="typography-card__actions"><button type="button" className="text-button" onClick={() => void onCopy(cssFor(style), "Typography CSS")}><Copy size={15} />Copy CSS</button>
      {fitted && <small title="Original font measurements are shown in details.">Sample scaled to fit</small>}
      {source && loaded?.done && !loaded.family && <small>Web font unavailable; showing fallback.</small>}
    </div>
    <details className="typography-card__details">
      <summary><ChevronDown size={15} /><span className="typography-card__show">Show details</span><span className="typography-card__hide">Hide details</span></summary>
      <dl>
        <div><dt>Font family</dt><dd>{style.fontFamily}</dd></div>
        <div><dt>Font size</dt><dd>{style.fontSize}{style.fontSizeRem && <small> ({style.fontSizeRem})</small>}</dd></div>
        <div><dt>Font weight</dt><dd>{style.fontWeight}{weightName && <small> ({weightName})</small>}</dd></div>
        <div><dt>Font style</dt><dd>{style.fontStyle}</dd></div>
        <div><dt>Line height</dt><dd>{style.lineHeight}</dd></div>
        <div><dt>Letter spacing</dt><dd>{style.letterSpacing}</dd></div>
        <div><dt>Text transform</dt><dd>{style.textTransform}</dd></div>
      </dl>
      <div className="typography-card__sources">
        <h4>Font sources</h4>
        {style.sources.length ? <>
          {style.sources.map((value, index) => <div className="typography-source" key={value.url}>
            <span>Font file{style.sources.length > 1 ? ` ${index + 1}` : ""} <small>· {value.weight} · {value.style}</small></span>
            <a href={value.url} target="_blank" rel="noreferrer">{value.url}<ExternalLink size={13} aria-hidden="true" /></a>
            <button type="button" className="text-button" onClick={() => void onCopy(value.url, "Font URL")}><Copy size={14} />Copy font URL</button>
          </div>)}
          {stylesheetUrls.map(url => <div className="typography-source" key={url}><span>Stylesheet / CDN link</span>
            <a href={url} target="_blank" rel="noreferrer">{url}<ExternalLink size={13} aria-hidden="true" /></a>
            <button type="button" className="text-button" onClick={() => void onCopy(url, "Stylesheet URL")}><Copy size={14} />Copy stylesheet URL</button>
          </div>)}
        </> : <p>No reusable font URL was exposed. This may be a system font or an inaccessible stylesheet. Copy CSS to reuse its font stack.</p>}
      </div>
    </details>
  </article>;
}

export function TypographyList({ entries, onCopy }: { entries: Entry[]; onCopy: (value: string, label: string) => Promise<void> }) {
  const showPage = new Set(entries.map(entry => entry.capture.id)).size > 1;
  return <section className="typography-list" aria-label="Typography">
    <h2><Type size={18} aria-hidden="true" />Typography <span>{entries.length}</span></h2>
    {entries.map(entry => <TypographyCard key={`${entry.capture.id}:${entry.style.id}`} entry={entry} showPage={showPage} onCopy={onCopy} />)}
  </section>;
}

