type LegalSection = {
  title: string;
  paragraphs: string[];
};

export default function LegalPage({
  title,
  description,
  sections,
}: {
  title: string;
  description: string;
  sections: LegalSection[];
}) {
  return (
    <div className="landing">
      <header className="landing-header">
        <div className="landing-container landing-header__inner">
          <a className="landing-brand" href="/" aria-label="Allhere home">
            <img src="/icons/allhere.svg" width="34" height="34" alt="" />
            <span>allhere</span>
          </a>
          <a className="landing-legal__back" href="/">
            Back to Allhere
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
          </a>
        </div>
      </header>
      <main className="landing-container landing-legal">
        <span className="landing-legal__eyebrow">ALLHERE · DEVELOPER PREVIEW</span>
        <h1>{title}</h1>
        <p className="landing-legal__lead">{description}</p>
        {sections.map(({ title: sectionTitle, paragraphs }) => (
          <section key={sectionTitle}>
            <h2>{sectionTitle}</h2>
            {paragraphs.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </section>
        ))}
      </main>
    </div>
  );
}
