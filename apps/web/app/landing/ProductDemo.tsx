export function ProductDemo() {
  return (
            <div
              className="landing-browser"
              aria-label="Illustrative source page beside the live Stashwell extension demo"
            >
              <div className="landing-browser__bar">
                <span className="landing-browser__dots" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
                <span className="landing-browser__address">
                  developer.chrome.com / extensions / activeTab
                </span>
              </div>
              <div className="landing-browser__body">
                <article className="landing-source" aria-label="Sample documentation webpage">
                  <header className="landing-source__sitebar">
                    <div className="landing-source__masthead">
                      <span className="landing-source__symbol" aria-hidden="true">
                        &lt;/&gt;
                      </span>
                      <span>Chrome for Developers</span>
                    </div>
                    <nav aria-label="Sample website navigation">
                      <span>Chrome</span>
                      <span className="is-active">Extensions</span>
                      <span>Web platform</span>
                      <span className="landing-source__search">Search docs</span>
                    </nav>
                  </header>
                  <div className="landing-source__layout">
                    <aside className="landing-source__sidebar" aria-label="Sample documentation menu">
                      <span className="landing-source__sidebar-title">Extensions</span>
                      <span>Overview</span>
                      <span>Get started</span>
                      <span>Guides</span>
                      <span>API reference</span>
                      <span className="is-active">Permissions</span>
                    </aside>
                    <div className="landing-source__article">
                      <div className="landing-source__label">Illustrative source page</div>
                      <div className="landing-source__crumb">
                        Extensions <span>/</span> Concepts <span>/</span> Permissions
                      </div>
                      <h2>The activeTab permission</h2>
                      <p className="landing-source__lead">
                        Give your extension temporary access to the page a person
                        chooses, right when they need it.
                      </p>
                      <div className="landing-source__notice">
                        <span aria-hidden="true">i</span>
                        <p>Access begins after a user gesture and is limited to the active tab.</p>
                      </div>
                      <h3>Request access when it matters</h3>
                      <p>
                        Use the active tab to work with page resources in context.
                        Permission is temporary, so your extension can stay focused
                        on the current task.
                      </p>
                      <pre className="landing-source__code">
                        <code>chrome.tabs.query(&#123; active: true &#125;)</code>
                      </pre>
                      <div className="landing-source__related">
                        <figure className="landing-source__image">
                          <img
                            src="/images/studio-workspace-generated.jpg"
                            alt="A quiet studio workspace shown as an illustrative page image"
                            width="1200"
                            height="800"
                          />
                        </figure>
                        <div className="landing-source__related-copy">
                          <span>RELATED RESOURCE</span>
                          <strong>Accessibility review.pdf</strong>
                          <small>PDF · 2.4 MB</small>
                        </div>
                      </div>
                    </div>
                  </div>
                </article>
                <div className="landing-panel">
                  <iframe
                    title="Interactive Stashwell Chrome side panel with sample resources"
                    src="/demo/extension"
                    loading="eager"
                  />
                </div>
              </div>
            </div>
  );
}
