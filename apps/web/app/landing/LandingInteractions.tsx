"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import styles from "./interactions.module.css";

const navigation = [
  ["How it works", "#workflow"],
  ["What you can save", "#features"],
  ["Your workspace", "#workspaces"],
  ["Questions", "#questions"],
] as const;

export function LandingHeader() {
  const [open, setOpen] = useState(false);
  const header = useRef<HTMLElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const navigationId = useId();

  useEffect(() => {
    if (!open) return;
    const dismissOutside = (event: Event) => {
      if (event.target instanceof Node && !header.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    const dismissOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        toggle.current?.focus();
      }
    };
    const desktop = window.matchMedia("(min-width: 1024px)");
    const dismissOnDesktop = () => {
      if (desktop.matches) setOpen(false);
    };
    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("focusin", dismissOutside);
    document.addEventListener("keydown", dismissOnEscape);
    desktop.addEventListener("change", dismissOnDesktop);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("focusin", dismissOutside);
      document.removeEventListener("keydown", dismissOnEscape);
      desktop.removeEventListener("change", dismissOnDesktop);
    };
  }, [open]);

  return (
    <header className={styles.header} ref={header}>
      <div className={styles.headerInner}>
        <a className={styles.brand} href="/" aria-label="Allhere home">
          <img src="/icons/allhere.svg" width="34" height="34" alt="" />
          <span>allhere</span>
        </a>
        <nav
          className={styles.navigation}
          id={navigationId}
          aria-label="Primary navigation"
          data-open={open}
        >
          {navigation.map(([label, href]) => (
            <a key={href} href={href} onClick={() => setOpen(false)}>{label}</a>
          ))}
        </nav>
        <div className={styles.headerActions}>
          <a
            className={styles.download}
            href="/downloads/allhere-extension.zip"
            download="allhere-extension.zip"
            onClick={() => setOpen(false)}
          >
            Get Allhere
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3v9m-3-3 3 3 3-3M4 13v4h12v-4" /></svg>
          </a>
          <button
            ref={toggle}
            className={styles.menuToggle}
            type="button"
            aria-label={open ? "Close navigation" : "Open navigation"}
            aria-expanded={open}
            aria-controls={navigationId}
            onClick={() => setOpen(!open)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              {open ? <path d="m6 6 12 12M6 18 18 6" /> : <path d="M4 6h16M4 12h16M4 18h16" />}
            </svg>
          </button>
        </div>
      </div>
    </header>
  );
}

const resources = [
  { kind: "images", label: "Images", title: "Good finds deserve a second look.", description: "Bring the images on a page into view. Inspect available dimensions, keep the original address, and save the references you want to return to.", detail: "From a moment of inspiration to your next project." },
  { kind: "icons", label: "Icons", title: "The small details, all together.", description: "Find the icons a page exposes alongside its other resources. See available previews and keep each resource connected to where you found it.", detail: "A closer look at the details that make a page." },
  { kind: "fonts", label: "Fonts", title: "Follow a typeface back to its source.", description: "Discover font resources referenced by a page and inspect their addresses. Keep useful typography references with the rest of your collection.", detail: "Your visual research, with its context intact." },
  { kind: "links", label: "Links", title: "Keep the thread of your research.", description: "Collect useful links, revisit the original page, and inspect local URL signals when you need more context before opening a destination.", detail: "Transparent clues to support your own judgment." },
  { kind: "media", label: "Video & audio", title: "Give your media references a home.", description: "Gather video and audio addresses that are exposed on the page. Browse available resources by type and return to the original source.", detail: "Availability depends on how the page serves its media." },
  { kind: "files", label: "Files", title: "Find that useful file again.", description: "Keep reports, downloads, and other file URLs with the page that surfaced them. Search your collection when it is time to put a reference to work.", detail: "Less retracing your steps. More picking up where you left off." },
] as const;

type ResourceKind = (typeof resources)[number]["kind"];

function ResourceIcon({ kind }: { kind: ResourceKind }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {kind === "images" && <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8" cy="9" r="1.5" /><path d="m4 18 6-6 4 4 3-3 4 4" /></>}
      {kind === "icons" && <><rect x="3" y="3" width="7" height="7" rx="2" /><circle cx="17.5" cy="6.5" r="3.5" /><path d="m6.5 14 4 7h-8z" /><rect x="14" y="14" width="7" height="7" rx="2" /></>}
      {kind === "fonts" && <><path d="M4 5h16M12 5v15M8 20h8M4 5v3M20 5v3" /></>}
      {kind === "links" && <><path d="m10 14 4-4M9 16l-1.5 1.5a4.2 4.2 0 0 1-6-6L6 7a4.2 4.2 0 0 1 6 0m0 10a4.2 4.2 0 0 0 6 0l4.5-4.5a4.2 4.2 0 0 0-6-6L15 8" transform="translate(1 0) scale(.9 1)" /></>}
      {kind === "media" && <><path d="M4 10v4M8 6v12M12 3v18M16 7v10M20 10v4" /></>}
      {kind === "files" && <><path d="M6 3h8l4 4v14H6zM14 3v5h4M9 12h6M9 16h6" /></>}
    </svg>
  );
}

function ImagePreview() {
  const [replay, setReplay] = useState(0);
  return (
    <div className={styles.imagePreview}>
      <div className={styles.previewTopline}>
        <span>Sample image resource</span>
        <button className={styles.replay} type="button" onClick={() => setReplay(replay + 1)}>
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 6a7 7 0 1 1-1 7M4 2v4h4" /></svg>
          {replay ? "Replay scan" : "See a sample scan"}
        </button>
      </div>
      <div className={styles.imageFrame} key={replay} data-replay={replay > 0}>
        <img
          src="/images/studio-workspace-generated.jpg"
          alt="A sunlit studio with a desk, books, and a potted plant"
          width="1200"
          height="800"
          loading="lazy"
        />
        {replay > 0 && <span className={styles.scanLine} aria-hidden="true" />}
        <div className={styles.imageCaption}>
          <span className={styles.captionIcon}><ResourceIcon kind="images" /></span>
          <span><strong>Quiet studio workspace</strong><small>Image · 1200 × 800</small></span>
          <span className={styles.savedMark} aria-label="Illustrative saved state"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 10 3 3 7-7" /></svg></span>
        </div>
      </div>
    </div>
  );
}

function SamplePreview({ kind }: { kind: ResourceKind }) {
  if (kind === "images") return <ImagePreview />;
  if (kind === "icons") return (
    <div className={styles.iconsPreview}>
      <div className={styles.previewTopline}><span>Sample icon collection</span><span>SVG resources</span></div>
      <div className={styles.iconSheet} aria-hidden="true">
        <svg viewBox="0 0 32 32"><path d="M9 5h14v23l-7-5-7 5z" /></svg>
        <svg viewBox="0 0 32 32"><path d="m16 4 3.5 8 8.5 1-6.5 6 2 9-7.5-4.5L8.5 28l2-9L4 13l8.5-1z" /></svg>
        <svg viewBox="0 0 32 32"><rect x="5" y="7" width="22" height="20" rx="4" /><path d="M5 13h22M11 4v6M21 4v6M10 19h3M19 19h3" /></svg>
        <svg viewBox="0 0 32 32"><path d="M5 8h9l3 4h10v14H5z" /></svg>
        <svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="11" /><path d="M16 9v8l5 3" /></svg>
        <svg viewBox="0 0 32 32"><path d="M16 26S4 19 4 11a6 6 0 0 1 12-1 6 6 0 0 1 12 1c0 8-12 15-12 15Z" /></svg>
      </div>
      <div className={styles.previewFootnote}><span>bookmark.svg</span><span>Original address retained</span></div>
    </div>
  );
  if (kind === "fonts") return (
    <div className={styles.fontPreview}>
      <div className={styles.previewTopline}><span>Sample font resource</span><span>WOFF2</span></div>
      <p className={styles.typeSample}>A place<br />for ideas.</p>
      <div className={styles.previewFootnote}><strong>Roboto</strong><span>Aa Bb Cc 0123456789</span></div>
    </div>
  );
  if (kind === "links") return (
    <div className={styles.listPreview}>
      <div className={styles.previewTopline}><span>Sample research links</span><ResourceIcon kind="links" /></div>
      <div className={styles.sampleRow}><span className={styles.rowIcon}><ResourceIcon kind="links" /></span><span><strong>Building for the web</strong><small>example.com / guides / web</small></span></div>
      <div className={styles.sampleRow}><span className={styles.rowIcon}><ResourceIcon kind="links" /></span><span><strong>Designing with accessibility</strong><small>example.com / accessibility</small></span></div>
      <div className={styles.linkSignal}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2 16 5v5c0 3-3 6-6 8-3-2-6-5-6-8V5zM10 6v4M10 13h.01" /></svg><span><strong>Local URL signals</strong><small>Context to review, not a safety guarantee.</small></span></div>
    </div>
  );
  if (kind === "media") return (
    <div className={styles.mediaPreview}>
      <div className={styles.previewTopline}><span>Sample media resources</span><ResourceIcon kind="media" /></div>
      <div className={styles.videoSample}>
        <div className={styles.videoPlay} aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m9 6 9 6-9 6z" /></svg></div>
        <span><strong>A look inside the studio</strong><small>Video reference · MP4</small></span>
      </div>
      <div className={styles.audioSample}><ResourceIcon kind="media" /><span><strong>Notes from the field</strong><small>Audio reference · MP3</small></span><span className={styles.audioBars} aria-hidden="true">{[14, 26, 18, 32, 22, 12, 26, 34, 16, 24, 12].map((height, index) => <i key={index} style={{ height }} />)}</span></div>
    </div>
  );
  return (
    <div className={styles.listPreview}>
      <div className={styles.previewTopline}><span>Sample file resources</span><span>From your research</span></div>
      {[
        ["PDF", "Accessibility review", "Report · PDF document"],
        ["ZIP", "Project resources", "Download · ZIP archive"],
        ["JSON", "Research collection", "Data · JSON file"],
      ].map(([extension, title, subtitle]) => (
        <div className={styles.sampleRow} key={extension}><span className={styles.fileBadge} data-format={extension}>{extension}</span><span><strong>{title}</strong><small>{subtitle}</small></span><svg className={styles.fileArrow} viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3v10m-4-4 4 4 4-4M4 17h12" /></svg></div>
      ))}
    </div>
  );
}

export function ResourceExplorer() {
  const [selected, setSelected] = useState(0);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const id = useId();

  const navigateTabs = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next: number;
    if (event.key === "ArrowRight") next = (index + 1) % resources.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + resources.length) % resources.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = resources.length - 1;
    else return;
    event.preventDefault();
    setSelected(next);
    tabRefs.current[next]?.focus({ preventScroll: true });
    tabRefs.current[next]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  };

  return (
    <div className={styles.explorer}>
        <div className={styles.tabs} role="tablist" aria-label="Resource types">
          {resources.map((resource, index) => (
            <button
              className={styles.tab}
              type="button"
              key={resource.kind}
              id={`${id}-tab-${resource.kind}`}
              role="tab"
              aria-selected={selected === index}
              aria-controls={`${id}-panel-${resource.kind}`}
              tabIndex={selected === index ? 0 : -1}
              ref={(element) => { tabRefs.current[index] = element; }}
              onClick={() => setSelected(index)}
              onKeyDown={(event) => navigateTabs(event, index)}
            >
              <ResourceIcon kind={resource.kind} />{resource.label}
            </button>
          ))}
        </div>
        {resources.map((resource, index) => (
          <div
            className={styles.resourcePanel}
            key={resource.kind}
            role="tabpanel"
            id={`${id}-panel-${resource.kind}`}
            aria-labelledby={`${id}-tab-${resource.kind}`}
            hidden={selected !== index}
            tabIndex={0}
          >
            {selected === index && <>
              <div className={styles.preview}><SamplePreview kind={resource.kind} /></div>
              <div className={styles.resourceCopy}>
                <h3>{resource.title}</h3>
                <p>{resource.description}</p>
                <p className={styles.resourceDetail}>{resource.detail}</p>
                <a className={styles.demoLink} href="#extension-demo">Try the interactive demo <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h12m-5-5 5 5-5 5" /></svg></a>
              </div>
            </>}
          </div>
        ))}
    </div>
  );
}
