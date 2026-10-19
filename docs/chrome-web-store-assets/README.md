# Stashwell Chrome Web Store images

Category: Developer Tools
Language: English (United States)
Store title: Stashwell — Web Media Downloader

Upload stashwell-store-icon-128.png as the store icon and stashwell-small-promo-440x280.png as the small promo tile.

Upload the three 1280x800 screenshots, in this order:
1. stashwell-screenshot-images-1280x800.png
2. stashwell-screenshot-images-scrolled-1280x800.png
3. stashwell-screenshot-download-formats-scrolled-1280x800.png

The matching 640x400 files are smaller alternatives; upload one size per screenshot.
The SVG is the editable source for the small promo tile.

These are real captures of the current installed extension with its approved twin-fold S logo and Stashwell name. The gallery is an explicitly named local sample collection; its source hostname is intentionally localhost, not a fabricated public website. The sample images and icons are genuinely scanned from that page. No UI or resource counts are painted onto the screenshots. The existing live website still uses the older Allhere brand.

Regenerate after building: pnpm --filter @stashwell/extension build, then node scripts/generate-store-assets.mjs. This only updates store assets; it does not change website branding or extension permissions.
