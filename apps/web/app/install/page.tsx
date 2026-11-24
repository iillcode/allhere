import type { Metadata } from "next";
import { CHROME_WEB_STORE_URL } from "../landing/store";

export const metadata: Metadata = {
  title: "Install Stashwell for Chrome",
  description: "Add the Stashwell Chrome extension from the Chrome Web Store and start collecting web resources.",
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
            For desktop Chrome. Add Stashwell from the Chrome Web Store, then
            open it beside supported webpages using the browser toolbar.
          </p>
          <a
            className="landing-button landing-button--primary"
            href={CHROME_WEB_STORE_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            <span className="landing-chrome-icon" aria-hidden="true" />
            Add to Chrome
          </a>
          <ol className="landing-install__steps">
            <li>
              <span className="landing-install__number">01</span>
              <div>
                <h2>Open the Chrome Web Store</h2>
                <p>
                  Visit the{" "}
                  <a
                    href={CHROME_WEB_STORE_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Stashwell listing
                  </a>{" "}
                  on the Chrome Web Store in desktop Chrome.
                </p>
              </div>
            </li>
            <li>
              <span className="landing-install__number">02</span>
              <div>
                <h2>Add to Chrome</h2>
                <p>
                  Choose <strong>Add to Chrome</strong> on the listing and
                  confirm the installation when Chrome asks.
                </p>
              </div>
            </li>
            <li>
              <span className="landing-install__number">03</span>
              <div>
                <h2>Pin Stashwell</h2>
                <p>
                  Open the extensions menu in the Chrome toolbar and pin
                  Stashwell so it stays one click away.
                </p>
              </div>
            </li>
          </ol>
          <p className="landing-install__footnote">
            Chrome keeps Stashwell up to date automatically. You can manage or
            remove it anytime at <code>chrome://extensions</code>.
          </p>
          <section
            className="landing-install__next"
            aria-labelledby="install-next-title"
          >
            <h2 id="install-next-title">Start with the page you are on.</h2>
            <p>
              Open Stashwell from the toolbar and choose <strong>Scan page</strong> on the tab
              you want to collect from. Chrome asks for access if the site has yet to be approved.
              After the first scan, Stashwell updates the collection while that tab is active
              on the same site, even with the panel closed. Use <strong>Scan page</strong> to start
              collection in a different tab or on a different site.
              The extension and web library keep separate local collections. Use a JSON archive
              to transfer items between them. See our{" "}
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