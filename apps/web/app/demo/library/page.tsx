"use client";

import { LibraryApp } from "@allhere/library-ui";
import { createDemoAdapter } from "../demoAdapter";

const adapter = createDemoAdapter();

export default function LibraryDemoPage() {
  return <LibraryApp adapter={adapter} mode="web" />;
}
