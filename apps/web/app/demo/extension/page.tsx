"use client";

import { useEffect } from "react";
import { LibraryApp } from "@stashwell/library-ui";
import { createDemoAdapter } from "../demoAdapter";

const adapter = createDemoAdapter();

export default function ExtensionDemoPage() {
  useEffect(() => {
    document.documentElement.classList.add("landing-extension-demo-document");
    return () => {
      document.documentElement.classList.remove("landing-extension-demo-document");
    };
  }, []);

  return (
    <div className="landing-extension-demo">
      <LibraryApp adapter={adapter} mode="extension" />
    </div>
  );
}
