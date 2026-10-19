import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Install Stashwell for Chrome",
  description: "Download the Stashwell Chrome extension developer preview and install it in Chrome.",
};

export default function InstallPage() {
  return (
    <div className="landing">
      <a className="landing-skip" href="#main">
        Skip to content
      </a>
      <header className="landing-header">
        <div className="landing-container landing-header__inner">
          <a className="landing-brand" href="/" aria-label="Stashwell home">
            <img src="/icons/stashwell.svg" width="34" height="34" alt="" />
            <span>Stashwell</span>
          </a>
          <a className="landing-header__action landing-install__home" href="/">
            Back to home
          </a>
        </div>
      </header>
      <main className="landing-install" id="main">
        <div className="landing-container landing-install__inner">
          <h1>Install Stashwell in Chrome.</h1>
          <p className="landing-install__lead">
            For Chrome 114 or later. Download the developer preview, unzip it,
            and add it to Chrome. You can then open Stashwell beside supported
            webpages using the browser toolbar.
          </p>
          <a
            className="landing-button landing-button--primary"
            href="/downloads/stashwell-extension.zip"
            download="stashwell-extension.zip"
          >
            <span className="landing-chrome-icon" aria-hidden="true" />
            Download for Chrome
          </a>
          <ol className="landing-install__steps">
            <li>
              <span className="landing-install__number">01</span>
              <div>
                <h2>Unzip the download</h2>
                <p>Extract all files into one folder and keep that folder in place.</p>
              </div>
            </li>
            <li>
              <span className="landing-install__number">02</span>
              <div>
                <h2>Open Chrome extensions</h2>
                <p>
                  Enter <code>chrome://extensions</code> in the address bar and
                  turn on <strong>Developer mode</strong>.
                </p>
              </div>
            </li>
            <li>
              <span className="landing-install__number">03</span>
              <div>
                <h2>Load Stashwell</h2>
                <p>
                  Choose <strong>Load unpacked</strong> and select the extracted
                  folder containing <code>manifest.json</code>.
                </p>
              </div>
            </li>
          </ol>
          <p className="landing-install__footnote">
            This is a manually installed preview. After an update, download the
            new ZIP, replace the extracted files, and reload Stashwell in Chrome.
          </p>
          <section
            className="landing-install__next"
            aria-labelledby="install-next-title"
          >
            <h2 id="install-next-title">Start with the page you are on.</h2>
            <p>
              Click Stashwell’s icon in the Chrome toolbar to open the panel,
              then choose <strong>Scan page</strong> to collect the active webpage.
              Click the icon again to close the panel.
              On a new tab, the panel follows the page automatically; choose Scan page
              to collect it. Chrome may ask for access to that website. File actions
              may ask for access to the selected resources’ hosts. The first scan also
              enables automatic resource updates for that tab while the panel is
              visible. Close Stashwell to stop updates. An unscanned tab waits
              for its own manual scan; navigation within an authorized origin
              can update automatically. Hiding or closing the panel ends this authorization. The extension
              library and the web library keep separate local collections; use
              a JSON archive to transfer items between them. See our{" "}
              <a href="/privacy">privacy policy</a> for details.
            </p>
            <a href="/#extension-demo">
              See the side panel in action <ArrowIcon />
            </a>
          </section>
        </div>
      </main>
    </div>
  );
}

function ArrowIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 10h11M10 5l5 5-5 5" />
    </svg>
  );
}
