"use client";

import { LibraryApp } from "@stashwell/library-ui";
import { createDemoAdapter } from "../demoAdapter";

const adapter = createDemoAdapter();

export default function LibraryDemoPage() {
  return <LibraryApp adapter={adapter} mode="web" />;
}
