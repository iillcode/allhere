# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Next.js with Turbopack in a Turborepo monorepo (requested).

## Users

Individual researchers and creators who collect useful web resources while they work.

## Product Purpose

Capture images, links, media, and file URLs from a webpage, browse them in a library, and inspect resource details and link security signals. Saving resources is the main workflow; auditing links is a supporting workflow.

## Positioning

The product combines a page-resource library with link checks that run locally using transparent heuristics. It does not send URLs to an external reputation service in the MVP.

## Operating Context

The product includes a Chrome side panel for working beside the current webpage and a full Next.js library. The proposed capture flow is user initiated from the extension. The side panel and library should use the same resource records.

## Capabilities and Constraints

- Gather images, links, media, and file/resource URLs present in a webpage. A tab’s first manual scan enables automatic updates while that tab is active and Stashwell is visible; closing the panel ends this authorization.
- Keep captured images in the webpage’s rendered reading order, including CSS backgrounds, shadow roots, and accessible frames. Refresh that order on rescans while preserving saved choices and older collected resources.
- Preserve source image dimensions in previews and downloads. Offer image format conversion for single downloads and bulk ZIPs.
- Show resource details and clear security signals, especially for links.
- Use local heuristics for security flags; do not imply that a heuristic proves a destination is safe.
- MVP storage is local to each surface. JSON archive import/export is the transfer path between the extension and web library; no cloud sync is specified.
- Remote security service and cross-device sync are undecided. No external reputation service or sync provider is specified.

## Brand Commitments

Use Google Drive's information architecture and interface system as the user's reference for the library. Match the craft and fit of Google Drive, Chrome's side panel, and Notion. The product is named Stashwell. Its blue folded S mark suggests useful finds tucked away for later: a continuous ribbon with two diagonal page ends, a transparent background, and no surrounding square. Use the same mark in the library, extension toolbar, website, and store artwork; capitalize the wordmark as Stashwell.

## Evidence on Hand

No customer content or reputation results were provided. Any example library content must be labeled as sample data; the landing page includes a local illustrative image asset for its sample resource.

## Product Principles

- Keep saving the primary task and link auditing close at hand.
- Make the security signals and the reasons for them understandable.
- Keep heuristic checks local and avoid presenting them as a guarantee.
- Make captured resources easy to find again.
