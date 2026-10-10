"use client";

import { LibraryApp } from "@allhere/library-ui";
import { createWebAdapter } from "@allhere/library-ui";

const adapter = createWebAdapter();

export default function HomePage() {
  return <LibraryApp adapter={adapter} mode="web" />;
}
