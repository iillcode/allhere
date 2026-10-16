import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createExtensionAdapter, LibraryApp } from "@stashwell/library-ui";
import "@stashwell/library-ui/styles.css";
import "./typography.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Stashwell could not find its extension page root.");
}

createRoot(rootElement).render(
  <StrictMode>
    <LibraryApp adapter={createExtensionAdapter()} mode="extension" />
  </StrictMode>,
);
