"use client";

import { LibraryApp, createWebAdapter } from "@allhere/library-ui";

const adapter = createWebAdapter();

export default function LibraryPage() {
  return <LibraryApp adapter={adapter} mode="web" />;
}
