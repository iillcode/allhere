---
name: Stashwell Library
description: A calm, familiar resource library for web and browser side-panel use.
colors:
  primary: "#0b57d0"
  primary-deep: "#0842a0"
  primary-pale: "#d3e3fd"
  text: "#1f1f1f"
  text-soft: "#444746"
  text-muted: "#5f6368"
  text-faint: "#747775"
  surface: "#ffffff"
  surface-soft: "#f8fafd"
  surface-nav: "#f6f8fc"
  surface-hover: "#f1f3f4"
  surface-selected: "#e8f0fe"
  divider: "#e0e3e7"
  divider-strong: "#c4c7c5"
  status-success: "#188038"
  status-success-bg: "#e6f4ea"
  status-caution: "#9a5d00"
  status-caution-bg: "#fef7e0"
  status-risk: "#b3261e"
  status-risk-bg: "#fce8e6"
  resource-violet: "#6941c6"
  resource-violet-bg: "#f0eafd"
typography:
  display:
    fontFamily: "Roboto, Arial, sans-serif"
    fontSize: "27px"
    fontWeight: 400
    lineHeight: 1.25
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "Roboto, Arial, sans-serif"
    fontSize: "22px"
    fontWeight: 400
    lineHeight: 1.25
  title:
    fontFamily: "Roboto, Arial, sans-serif"
    fontSize: "14px"
    fontWeight: 500
  body:
    fontFamily: "Roboto, Arial, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "Roboto, Arial, sans-serif"
    fontSize: "11px"
    fontWeight: 500
  meta:
    fontFamily: "Roboto, Arial, sans-serif"
    fontSize: "10px"
    fontWeight: 400
  extension-body:
    fontFamily: "Geist Variable, Segoe UI, Arial, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
  extension-item:
    fontFamily: "Geist Variable, Segoe UI, Arial, sans-serif"
    fontSize: "14px"
    fontWeight: 500
    lineHeight: 1.5
  extension-meta:
    fontFamily: "Geist Variable, Segoe UI, Arial, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  sm: "8px"
  md: "12px"
  lg: "16px"
  pill: "22px"
  search: "26px"
  full: "50%"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    typography: "{typography.body}"
    rounded: "{rounded.pill}"
    padding: "0 17px"
    height: "40px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.primary-deep}"
    typography: "{typography.body}"
    rounded: "{rounded.pill}"
    padding: "0 17px"
    height: "40px"
  search-field:
    backgroundColor: "#f0f4f9"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.search}"
    padding: "0 15px"
    height: "48px"
  nav-item-selected:
    backgroundColor: "{colors.primary-pale}"
    textColor: "{colors.primary-deep}"
    typography: "{typography.body}"
    rounded: "{rounded.pill}"
    padding: "0 12px"
    height: "42px"
  filter-chip-selected:
    backgroundColor: "{colors.surface-selected}"
    textColor: "{colors.primary-deep}"
    typography: "{typography.label}"
    rounded: "18px"
    padding: "0 12px"
    height: "36px"
  resource-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0"
  resource-album:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "0"
---

# Design System: Stashwell Library

## Overview

**Creative North Star: "The Familiar Library Shelf"**

Stashwell uses the visual language of a familiar file library: a white working canvas, a cool-gray navigation rail, fine dividers, and a clear blue accent for the main action and selected item. Resource types and states receive quiet color cues, while compact outlined icons and short labels keep the collection easy to scan.

The same visual system works in a full browser window and a narrow side panel. The compact shell keeps the brand, search, collection, and details treatments recognizable while reducing the navigation chrome and spacing. Hierarchy comes from type size and weight, not a separate display face or decorative ornament.

**Key Characteristics:**
- White and cool-gray surfaces with restrained blue emphasis.
- Compact, information-rich lists and resource cards.
- Rounded controls, quiet borders, and subtle state elevation.
- One sans-serif family and consistent outlined interface icons.

## Colors

The palette is neutral-first: blue carries primary actions, focus, and selection; semantic colors distinguish status; resource category colors stay muted and localized.

### Primary
- **Drive Blue** (`colors.primary`): Primary actions, active controls, and the brand mark.
- **Deep Blue** (`colors.primary-deep`): Strong blue text and primary-action hover states.
- **Pale Blue** (`colors.primary-pale`): Active navigation and softly selected controls.

### Secondary
- **Resource Violet** (`colors.resource-violet`): Video and audio category accents.

### Tertiary
- **Success Green** (`colors.status-success`): Positive status and locally stored indicators.
- **Caution Amber** (`colors.status-caution`): Review-needed signals.
- **Risk Red** (`colors.status-risk`): High-risk signals and destructive-action hover.

### Neutral
- **Ink** (`colors.text`): Main titles and high-priority copy.
- **Soft Ink** (`colors.text-soft`): Supporting interface text and controls.
- **Muted Ink** (`colors.text-muted`): Descriptions, labels, and secondary content.
- **Faint Ink** (`colors.text-faint`): Metadata and low-emphasis details.
- **White** (`colors.surface`): Main canvas, cards, and detail surfaces.
- **Soft Paper** (`colors.surface-soft`): Quiet supporting surface.
- **Cool Rail** (`colors.surface-nav`): Navigation background.
- **Hover Gray** (`colors.surface-hover`): Hover feedback for neutral controls.
- **Selected Blue Tint** (`colors.surface-selected`): Selected filters and resource rows.
- **Divider** (`colors.divider`): Borders between collections, fields, and detail groups.
- **Strong Divider** (`colors.divider-strong`): Secondary control outlines.
- **Status tints** (`colors.status-success-bg`, `colors.status-caution-bg`, `colors.status-risk-bg`): Low-contrast backing for matching status icons and signals.
- **Violet tint** (`colors.resource-violet-bg`): Soft backing for violet resource-type accents.

### Named Rules
**The Action-Blue Rule.** Reserve blue for primary actions, active navigation and filters, focus, and selection. Status colors belong to status signals and their matching soft surfaces.

**The Quiet-Neutral Rule.** Keep large surfaces white or cool gray; use dividers and small surface shifts to structure the library instead of introducing more accent colors.

## Typography

**Character:** A single practical sans-serif voice carries the interface. Size and medium weight establish hierarchy; small metadata remains quiet and compact.

### Hierarchy
- **Display** (regular, `typography.display`): The main collection heading; keep it modest and left aligned.
- **Headline** (regular, `typography.headline`): Compact-shell and empty-state headings.
- **Title** (medium, `typography.title`): Resource names, detail titles, and emphasized control text.
- **Body** (regular, `typography.body`): Default interface copy and readable descriptions.
- **Label** (medium, `typography.label`): Section labels, filters, and detail headings.
- **Meta** (regular, `typography.meta`): Source, security, and footer metadata.

### Named Rules
**The Single-Family Rule.** Keep display, body, labels, and metadata in the same sans-serif family; use weight and size to separate roles.

### Extension typography

The installed extension uses bundled **Geist Variable** (Latin subset, with Segoe UI and Arial fallbacks) for the cleaner, ChatGPT-like typography requested for the side panel. Its separate stylesheet, `apps/extension/src/typography.css`, keeps the web library's Roboto system intact. The side-panel scale is 24px collection headings, 22px empty-state headings, a 20px wordmark, 16px section titles and base text, 15px controls and prose, 14px item titles and descriptions, 13px supporting controls and details, and 12px metadata. Body leading is 1.5; descriptions use 1.55 and empty-state prose uses 1.6. Medium and 550 weights establish hierarchy without adding a second family. Rem units respect the browser's default font size, while the bundled face displays with a system fallback during loading.

Keep the 64px header and horizontal resource tabs. Source selectors have a 52px minimum height, dropdown rows accommodate two lines, and image descriptions have a 68px minimum text area. Supporting source labels can wrap in narrow panels. Preview-font samples retain their captured typeface.

## Layout

The wide library uses a fixed top bar, a left navigation rail, a flexible main area, and an optional right detail pane. The resource grid begins at four columns, drops to three at 1280px, and two at 980px. At 760px the top bar stacks search beneath the brand row and the rail becomes a slide-in drawer; at 440px the interface trims secondary table columns and metadata labels to protect the two-column card grid. The extension shell keeps the rail hidden and uses a compact two-column grid.

Spacing follows a close 4px rhythm, with repeated 8px, 12px, 16px, and 20px gaps and padding. Main content grows with the available width, while cards and detail content keep clear internal padding. Search and category controls can scroll horizontally on narrow screens instead of forcing the whole layout wider.

At 360px and below, the installed extension keeps the 64px header and full Stashwell name at 20px. The mark is fixed at 26px without shrinking, and the brand gap and header column gap reduce to 6px so the name, scan action, and outer-right menu fit together.

### Public landing and installation

The landing page keeps the library's Roboto type, white canvas, fine dividers, and Drive-blue actions at a more spacious scale. Its sticky primary navigation uses a lightly translucent white surface. The hero centers a balanced headline, a short explanation, and two actions. **Download for Chrome** is the primary blue button with a multicolor Chrome mark; **Explore the extension** is a text link. Landing-page links to the web library are currently omitted. A small note states the Chrome minimum version and manual setup requirement. Below the hero, a wide browser scene pairs a documentation-style sample webpage (site navigation, section rail, article, code, and related resources) with the live extension interface. Demo panes hide their visible scrollbars while retaining scroll interaction. On narrow screens the download button expands to full width, and the browser scene puts a compact source preview above the panel.

The content after the demo explains the scan-to-library workflow, presents three illustrative use-case panels, and shows resource types with custom line icons. A workspace comparison distinguishes the Chrome side panel from the full web library and makes the JSON archive transfer path explicit; the surfaces do not sync automatically. Separate sections explain local link signals with shield and caution icons, and a native disclosure FAQ animates answer reveals with reduced-motion support. A centered footer links to the Terms and Privacy preview pages. The `/install` page uses the same visual language for the ZIP download and ordered setup steps, then explains the first scan and local-library transfer.

## Elevation & Depth

Depth is mostly structural: white cards sit on the white canvas with a fine border, and selected states use a tinted surface and blue outline. Soft shadows appear on the raised import control, on hover, and around overlays such as the mobile navigation drawer. The details overlay dims the surrounding page; it does not use a hard offset shadow as a decorative motif.

### Shadow Vocabulary
- **Raised action** (`0 2px 5px rgb(60 64 67 / 13%)`): The create/import control at rest; its hover state grows slightly softer and wider.
- **Card hover** (`0 1px 3px rgb(60 64 67 / 13%)`): Resource card hover only; cards remain border-led at rest.
- **Mobile rail** (`7px 0 24px rgb(60 64 67 / 18%)`): Separates the open drawer from the collection.
- **Details scrim** (`0 0 0 100vmax rgb(32 33 36 / 28%)`): Dims the canvas while details are open in compact layouts.

### Named Rules
**The Flat-at-Rest Rule.** Keep ordinary resource cards border-led and flat; reserve shadows for raised controls, hover feedback, and overlays.

## Shapes

The Stashwell mark is a continuous folded S ribbon in primary blue (see `colors.primary`). Two diagonal page ends suggest finds tucked into a collection; broad curves keep the silhouette clear at 16px. Keep its background transparent with no surrounding square. The canonical 64-unit SVG at `apps/extension/public/icons/stashwell.svg` generates the application mark, transparent 16/32/48/128px extension icons, and 512px mark PNGs; the 128px store icon retains a transparent safety margin. The standalone Stashwell wordmark uses outlined Geist 600 lettering in Ink (see `colors.text`) so its SVG needs no installed font. White mark and wordmark variants are available for dark backgrounds. The logo PNGs retain transparency; `stashwell-logo-preview.png` alone supplies a white presentation background. In the interface, use the full capitalized name beside the mark and preserve the existing UI font and readable size.

Controls use generous pill silhouettes: the search field is the soft capsule, buttons and navigation items are rounded pills, and filter chips are slightly tighter. Resource cards use a consistent rounded rectangle; fields and metadata boxes use smaller corners. Thin borders define card and field edges, and card artwork clips cleanly to its rounded frame. Focus stays visible as a clear blue outline with a small offset.

## Components

### Buttons

The extension header stays at its original 64px action row before and after scanning, without an automatic-update status row or Pause/Resume controls. The existing Source page line briefly says Scan enables auto-updates and supplies the scan action's accessible description. Its tooltip and the Scan page tooltip explain that automatic updates run for the active, manually scanned tab while Stashwell is visible; closing the panel stops them. The resource tabs stick below the measured header height. Automatic refreshes preserve the collection's selected type, view, bookmarks, and scroll. The header's left inset remains 8px and its menu stays at the outer right edge.

The extension scan button uses the current tab's favicon on a small white circular plate, with a globe when Chrome withholds it or the icon fails to load. Amber fill and outline pair with **Scan page** when the active tab or document needs a manual scan. A successful scan changes it to blue **Scan again**. Reloads and navigation restore the amber state without triggering capture; switching back to an unchanged scanned tab preserves blue within the open panel session.

- **Shape:** Rounded pill (`rounded.pill`).
- **Primary:** Blue fill, white text, 40px minimum height, and 17px horizontal padding. Hover deepens the blue and adds a small shadow; press shifts down one pixel.
- **Secondary:** White fill, strong neutral outline, and deep-blue text. Hover keeps the treatment neutral and lightly changes the surface.
- **Focus / Disabled:** Preserve the global visible focus outline. Disabled controls lower opacity and use muted neutral colors.

### Chips
- **Style:** Category filters are transparent at rest, compact and rounded, with muted text and tabular counts.
- **State:** Hover gains a light neutral surface; selected chips use a pale-blue surface and deep-blue text.

### Cards / Containers
- **Corner Style:** Rounded rectangle (`rounded.md`).
- **Background:** White with a fine neutral border.
- **Shadow Strategy:** Flat at rest; a subtle shadow appears on hover. Selection uses a pale-blue wash and blue outline.
- **Internal Padding:** Resource artwork is full bleed; text and metadata use the compact 12px rhythm.

### Inputs / Fields
- **Style:** Search uses a wide, soft-gray capsule with a transparent border at rest; address fields use a white fill and fine outline with smaller corners.
- **Focus:** White search surface, soft blue border, and a subtle focus shadow; keyboard focus uses a visible blue outline.

### Navigation
- **Style:** A cool-gray left rail with compact icon-and-label rows, quiet counts, and a full-width rounded selected row. At narrow widths the rail becomes a drawer; the extension shell omits it.

### Resource Card
The signature collection tile pairs clipped artwork or a type-colored placeholder with a single-line title, source host, and compact status metadata. Selection is communicated with both a blue border and a light blue surface. Grid/list switching preserves the same source, type, and status hierarchy.

### Resource Albums
All resources shows an overview of the selected page, grouped into Images, Icons, Video & audio, Links, Fonts, and Files. Each populated section has an outlined type icon, title, total count, and View all action above up to ten previews. The preview grid always has five columns, so ten images form two rows of five even in a 320px sidebar. Quiet dividers separate sections; thumbnails omit individual badges and action menus. Links use site marks with short captions, while nonvisual resources use their existing type placeholders. Files includes documents, stylesheets, scripts, and other resources.

The entire section opens its matching resource tab and retains the source page. Keyboard activation focuses that tab. Links opens the existing list view. Choosing All resources returns to the section overview. When All pages is explicitly selected, each webpage has its own group of sections; opening one scopes the destination tab to that page. Empty sections are omitted, empty pages retain the existing empty state, and new captures update preview counts without exceeding ten thumbnails.

### Dragging Resources
Cards, list names, and album thumbnails use the grab cursor and retain the existing layout. Hover or focus prepares file bytes; the dots button shows a spinner during preparation. Its custom menu includes Prepare for dragging, and the existing status notice reports readiness or fetch failures. A dragged item dims while leaving its source visible. Links and pages carry URLs; downloadable resources carry a named file. File inputs respect accepted formats and disabled state. Failed drops use a compact blue status notice on the destination page. The 64 MB limit and supported upload behavior are documented in README.md.

### Manage Page Marks

Manage page rows show the saved site favicon inside their existing 42px neutral outlined mark, fitted to 24px with its aspect ratio preserved. Older captures without a saved favicon URL try the source origin’s standard favicon. The existing globe remains the loading or unavailable-icon fallback. The same bounded favicon loader serves the scan button and Manage rows, without new permissions or a third-party lookup service. Row spacing, titles, checkboxes, and delete actions are unchanged.

### Details Pane
Image previews use their source pixels, fitted within the existing preview area. Single and bulk actions offer format choices while preserving source dimensions. No image-size or enhancement controls are shown.

The details pane uses thin dividers to group a resource preview, source and address, local signal explanations, and metadata. The compact layout presents it as a full-height overlay with a dimmed canvas; its sections retain the same white surface and small type hierarchy.

## Do's and Don'ts

### Do:
- **Do** keep primary actions, active controls, and selection within the blue family.
- **Do** use status colors with their matching low-contrast tints and reserve them for status cues.
- **Do** keep cards flat at rest and use borders to define their edges.
- **Do** retain a visible focus outline and short, quiet transitions; honor reduced-motion preferences.
- **Do** keep icons consistent, outlined, and paired with readable labels where the action is not self-evident.

### Don't:
- **Don't** add a second display face, oversized editorial typography, or decorative all-caps labels.
- **Don't** use success, caution, or risk colors as general decoration.
- **Don't** add heavy shadows to ordinary cards or use shadow as the primary selection cue.
- **Don't** let narrow layouts force horizontal overflow; preserve the compact grid and horizontally scrollable filters.
