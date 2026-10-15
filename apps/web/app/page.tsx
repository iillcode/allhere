import type { Metadata } from "next";
import { ChromeIcon, Icon } from "./landing/LandingIcons";
import { LandingHeader, ResourceExplorer } from "./landing/LandingInteractions";
import { ProductDemo } from "./landing/ProductDemo";
import styles from "./landing/home.module.css";

export const metadata: Metadata = {
  title: "Allhere — Your working library for the web",
  description: "Turn a webpage’s images, links, media, fonts, and files into a collection. Capture, organize, and revisit web resources with Allhere for Chrome.",
};

const questions = [
  { question: "What does Scan page collect?", answer: "Allhere gathers the resource addresses it can access on the current page: images, icons, fonts, links, video and audio, and files. Each resource stays associated with its source page. Some embedded or protected resources may not be accessible." },
  { question: "Does Allhere scan pages automatically?", answer: "First click Allhere’s toolbar icon and choose Scan page. The panel explains that this also starts automatic updates for that tab while it is active and the panel is visible. Pause or resume updates in the header. Same-origin navigation can update automatically; each new tab or different origin needs another manual scan. Hiding or closing the panel ends the automatic-update session. Collections stay locally in your browser." },
  { question: "Where is my collection stored?", answer: "Your collection is stored locally in the browser or extension where you created it. The extension and web library have separate storage. Export a JSON archive to keep a backup or move a collection between them; they don’t sync automatically." },
  { question: "Does a link signal mean a destination is safe?", answer: "No. Allhere checks visible URL patterns on your device and explains clues that may deserve a closer look. These local heuristics are context, not a safety guarantee or an external reputation check." },
  { question: "How do I install the Chrome extension?", answer: "Allhere is currently a developer preview for desktop Chrome 114 or later. Download the ZIP, extract it, turn on Developer mode in Chrome’s extensions page, and choose Load unpacked to select the extracted folder.", setup: true },
];

function DownloadButton() {
  return <a className={styles.primaryButton} href="/downloads/allhere-extension.zip" download="allhere-extension.zip"><ChromeIcon />Download for Chrome</a>;
}

function Brand() {
  return <a className={styles.brand} href="/" aria-label="Allhere home"><img src="/icons/allhere.svg" width="32" height="32" alt="" /><span>allhere</span></a>;
}

function WorkspacePreview({ wide = false }: { wide?: boolean }) {
  return (
    <div className={`${styles.workspacePreview} ${wide ? styles.widePreview : ""}`} aria-label={`Illustrative ${wide ? "web library" : "Chrome side panel"} layout`}>
      <div className={styles.miniBrowserBar}><span /><span /><span /><small>{wide ? "Allhere library" : "Your browser tab"}</small></div>
      <div className={styles.miniBrowserBody}>
        <div className={styles.miniSource}>
          {wide ? <><span className={styles.miniSelected}><Icon name="grid" />All resources</span><span><Icon name="bookmark" />Saved</span><span><Icon name="file" />Files</span></> : <><strong>The activeTab permission</strong><span>Extensions / Concepts</span><p>Make room for your next good find.</p><img src="/images/studio-workspace-generated.jpg" width="1200" height="800" loading="lazy" alt="" /></>}
        </div>
        <div className={styles.miniLibrary}>
          <div className={styles.miniLibraryHead}><img src="/icons/allhere.svg" width="20" height="20" alt="" /><strong>{wide ? "Your collection" : "allhere"}</strong><Icon name="search" /></div>
          <div className={styles.miniResource}><img src="/images/studio-workspace-generated.jpg" width="1200" height="800" loading="lazy" alt="" /><span>Studio workspace<small>Image · Sample resource</small></span></div>
          <div className={styles.miniResource}><Icon name="link" /><span>Side Panel API<small>developer.chrome.com</small></span></div>
          <div className={styles.miniResource}><Icon name="file" /><span>Accessibility review<small>PDF · Sample resource</small></span></div>
        </div>
      </div>
    </div>
  );
}

export default function HomePage() {
  return (
    <div className={`landing ${styles.page}`}>
      <a className={styles.skip} href="#main">Skip to content</a>
      <LandingHeader />
      <main id="main" tabIndex={-1}>
        <section className={styles.hero} aria-labelledby="hero-title">
          <div className={styles.container}>
            <h1 id="hero-title">Good finds.<br /><span>All in one place.</span></h1>
            <p className={styles.heroDescription}>Your working library for the web. Choose Scan page to collect images, links, fonts, and files from the active webpage, and keep this tab’s collection updated while the panel is open. Browse everything locally beside your work.</p>
            <div className={styles.heroActions}><DownloadButton /><a className={styles.textLink} href="#extension-demo">See Allhere in action<Icon name="arrow" /></a></div>
            <p className={styles.installNote}>For desktop Chrome 114+ · Developer preview <span aria-hidden="true">·</span> <a href="/install">Manual setup guide</a></p>
          </div>
        </section>

        <section className={styles.showcase} id="extension-demo" aria-label="Try the Allhere extension">
          <div className={styles.demoStage}>
            <div className={styles.demoHeading}><span><Icon name="panel" />Your page. Your resources. Side by side.</span><span className={styles.demoBadge}><span />Interactive demo</span></div>
            <ProductDemo />
            <div className={styles.demoCaption}><p>Go ahead, explore. This is the real Allhere interface with sample resources.</p><span>Changes reset on refresh<Icon name="info" /></span></div>
          </div>
          <ul className={styles.reassurance} aria-label="How Allhere works"><li><Icon name="scan" />Scan when you choose</li><li><Icon name="grid" />Organized by resource type</li><li><Icon name="shield" />Link checks stay on your device</li></ul>
        </section>

        <section className={`${styles.section} ${styles.workflow}`} id="workflow" aria-labelledby="workflow-title">
          <div className={styles.container}>
            <div className={styles.sectionHeading}><h2 id="workflow-title">From a page to a collection.<br /><span>Without the busywork.</span></h2><p>A simple rhythm for all the things you want to come back to.</p></div>
            <ol className={styles.steps}>
              <li><div className={styles.stepTop}><span>1</span><Icon name="scan" /></div><h3>Find something interesting.</h3><p>Click Allhere’s toolbar icon on the webpage, then choose <strong>Scan page</strong> to collect its available resource URLs. On a new tab, click the toolbar icon again before scanning.</p></li>
              <li><div className={styles.stepTop}><span>2</span><Icon name="grid" /></div><h3>Let the collection take shape.</h3><p>Browse by type, search what you’ve found, and inspect the details. The original source stays close at hand.</p></li>
              <li><div className={styles.stepTop}><span>3</span><Icon name="bookmark" /></div><h3>Keep what matters.</h3><p>Save useful finds. Open, copy, or download a resource when it’s time to bring it into your next piece of work.</p></li>
            </ol>
          </div>
        </section>

        <section className={`${styles.section} ${styles.resources}`} id="features" aria-labelledby="features-title">
          <div className={styles.container}>
            <div className={styles.sectionHeading}><h2 id="features-title">Different kinds of finds.<br /><span>One familiar home.</span></h2><p>Explore the useful parts of a page, without hunting through every tab.</p></div>
            <ResourceExplorer />
          </div>
        </section>

        <section className={`${styles.section} ${styles.useCases}`} id="use-cases" aria-labelledby="use-cases-title">
          <div className={`${styles.container} ${styles.useCasesGrid}`}>
            <div className={styles.inspiration}>
              <img className={styles.inspirationImage} src="/images/studio-workspace-generated.jpg" width="1200" height="800" loading="lazy" alt="A sunlit shared studio with a long wooden table and creative workspaces" />
              <div className={styles.savedExample}><span className={styles.savedIcon}><Icon name="bookmark" /></span><div><strong>A little inspiration for later.</strong><span>Studio workspace · Sample saved image</span></div><Icon name="check" /></div>
            </div>
            <div className={styles.useCaseCopy}>
              <h2 id="use-cases-title">Follow your curiosity.<br /><span>Keep the context.</span></h2>
              <p>For the research rabbit holes, visual discoveries, and useful references that become your next idea.</p>
              <div className={styles.useCaseList}>
                <article><h3>Build a research trail</h3><p>Keep reports and useful links with the page that led you to them.</p></article>
                <article><h3>Explore a visual direction</h3><p>Collect image, icon, and font references as you browse. Inspect the original before you use it.</p></article>
                <article><h3>Keep technical references close</h3><p>Find that documentation link or resource file again, without retracing every tab.</p></article>
              </div>
            </div>
          </div>
        </section>

        <section className={`${styles.section} ${styles.workspaces}`} id="workspaces" aria-labelledby="workspaces-title">
          <div className={styles.container}>
            <div className={styles.sectionHeading}><h2 id="workspaces-title">Beside your page.<br /><span>Or with room to spread out.</span></h2><p>Two ways to work with Allhere, each with its own local collection.</p></div>
            <div className={styles.workspaceGrid}>
              <article className={styles.workspace}><div className={styles.workspaceCopy}><h3>Small panel. Useful companion.</h3><p>Scan and explore in the Chrome side panel, while the page you’re working on stays in view.</p><a className={styles.textLink} href="#extension-demo">Try the side panel<Icon name="arrow" /></a></div><WorkspacePreview /></article>
              <article className={styles.workspace}><div className={styles.workspaceCopy}><h3>A wider view of your collection.</h3><p>Search, filter, inspect, and manage your resource archive in the full web library.</p><a className={styles.textLink} href="#archive-transfer">How to move a collection<Icon name="arrow" /></a></div><WorkspacePreview wide /></article>
            </div>
            <div className={styles.transfer} id="archive-transfer"><span className={styles.transferSymbol}><Icon name="download" /><Icon name="arrow" /><Icon name="upload" /></span><div><h3>Your collection travels when you say so.</h3><p>Export a JSON archive from one library and import it into the other. The two libraries don’t sync automatically.</p></div></div>
          </div>
        </section>

        <section className={`${styles.section} ${styles.signals}`} id="link-signals" aria-labelledby="signals-title">
          <div className={`${styles.container} ${styles.signalGrid}`}>
            <div className={styles.signalCopy}><span className={styles.signalMark}><Icon name="shield" /></span><h2 id="signals-title">A little more context.<br /><span>A more informed click.</span></h2><p>Understand what a link is telling you before you open it. Allhere checks URL patterns locally and explains the clues it finds.</p><p className={styles.signalNote}>Signals help you decide. They aren’t a guarantee that a destination is safe.</p><a className={styles.textLink} href="/privacy">How your data is handled<Icon name="arrow" /></a></div>
            <div className={styles.signalExample}>
              <div className={styles.signalHeader}><Icon name="link" /><strong>Link details</strong><span>Illustrative examples</span></div>
              <div className={styles.signalRow}><span className={styles.secureIcon}><Icon name="shield" /></span><div><h3>HTTPS connection</h3><p>Transport is encrypted</p></div><Icon name="check" /></div>
              <div className={styles.signalRow}><span className={styles.warningIcon}><Icon name="warning" /></span><div><h3>Shortened destination</h3><p>Take a closer look before opening</p></div></div>
              <div className={styles.signalFoot}><Icon name="shield" />Local checks. No external reputation service.</div>
            </div>
          </div>
        </section>

        <section className={`${styles.section} ${styles.faq}`} id="questions" aria-labelledby="questions-title">
          <div className={`${styles.container} ${styles.faqGrid}`}>
            <div className={styles.faqIntro}><h2 id="questions-title">Good questions.<br /><span>Clear answers.</span></h2><p>A few things to know before your first scan.</p><a className={styles.textLink} href="/install">Read the setup guide<Icon name="arrow" /></a></div>
            <div className={styles.questions}>{questions.map(({question, answer, setup}) => <details key={question} name="allhere-faq"><summary>{question}<Icon name="chevron" /></summary><div className={styles.answer}><p>{answer}</p>{setup && <a className={styles.textLink} href="/install">See the setup steps<Icon name="arrow" /></a>}</div></details>)}</div>
          </div>
        </section>

        <section className={styles.close} aria-labelledby="close-title"><div className={styles.container}><img src="/icons/allhere.svg" width="56" height="56" alt="" /><h2 id="close-title">Your next good find<br />belongs here.</h2><p>Make a little room for everything worth keeping.</p><DownloadButton /><span className={styles.closeNote}>Desktop Chrome · Developer preview · <a href="/install">Manual setup</a></span></div></section>
      </main>
      <footer className={styles.footer}><div className={styles.container}><div className={styles.footerMain}><Brand /><p>Keep the useful parts of the web close.</p><a className={styles.backToTop} href="#main">Back to top<Icon name="arrow" /></a></div><div className={styles.footerBottom}><span>Allhere. A working library for the web.</span><nav aria-label="Footer navigation"><a href="/install">Setup guide</a><a href="#questions">Questions</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a></nav></div></div></footer>
    </div>
  );
}
