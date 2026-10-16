"use client";

import { LibraryApp, createWebAdapter } from "@stashwell/library-ui";

const adapter = createWebAdapter();

export default function LibraryPage() {
  return <LibraryApp adapter={adapter} mode="web" />;
}
