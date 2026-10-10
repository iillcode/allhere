import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createExtensionAdapter, LibraryApp } from "@allhere/library-ui";
import "@allhere/library-ui/styles.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Allhere could not find its extension page root.");
}

createRoot(rootElement).render(
  <StrictMode>
    <LibraryApp adapter={createExtensionAdapter()} mode="extension" />
  </StrictMode>,
);
