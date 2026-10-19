# Stashwell landing page

The homepage extends the existing Stashwell visual system: self-hosted Roboto, Drive-blue actions, white and cool-gray surfaces, outlined icons, and local product demonstrations. No additional runtime dependencies or remote design assets are required.

## References reviewed

- [Google Chrome](https://www.google.com/chrome/): centered value proposition, focused download action, large product demonstrations, interactive feature exploration, and FAQ-to-download page structure.
- [Google Drive](https://workspace.google.com/products/drive/): spacious product sections, familiar workspace imagery, clear benefit hierarchy, and accessible primary/secondary actions.
- [Material motion](https://m3.material.io/styles/motion/easing-and-duration/tokens-specs): reference for restrained state transitions and deceleration. The documentation endpoint requires client-side rendering; no numeric timing claims were extracted from it.

These are design references, not affiliations. Google artwork and site content are not bundled. The approved A2 (Twin fold) Stashwell mark, locally bundled Roboto, and existing illustrative studio image are reused.

## Components and motion

- `page.tsx` remains server-rendered with route metadata, native FAQ disclosures, and working download/setup links.
- `LandingHeader` owns the responsive menu with Escape, outside-click, and focus-out dismissal.
- `ResourceExplorer` has six keyboard-accessible tabs and a user-triggered sample scan. Sample scan motion is illustrative; the real demo runs independently in `/demo/extension`.
- `ProductDemo` preserves the existing live shared-library iframe and illustrative source page.
- CSS Modules scope the new design to the homepage. Existing global landing styles remain for install/legal pages and demo chrome.
- One brief side-panel entrance establishes the page/panel relationship. Tabs transition in 250 ms; the sample scan finishes in 2.2 seconds. There are no continuous animation loops. Reduced-motion preferences disable spatial animation while preserving the content and interactions.

Product constraints: desktop Chrome 114+, manual developer-preview installation, separate local extension/web collections, JSON archive transfer, and local heuristic link checks without safety guarantees. No cloud sync, store listing, customer metrics, or pricing claims are implied.
