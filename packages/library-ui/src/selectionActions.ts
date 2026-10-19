import type { ResourceKind } from "@stashwell/core";
import type { HTMLAttributes, ReactNode } from "react";

export type LibrarySelectionItem = {
  key: string;
  identity: string;
  kind: ResourceKind | "page";
  url: string;
  label: string;
  pageUrl: string;
};

// Optional surface capability. Only the installed extension supplies this action;
// the web library and its extension demo keep their existing selection controls.
export type SelectionActionProps = {
  items: LibrarySelectionItem[];
  disabled: boolean;
  saveFile: (file: File) => Promise<void>;
  fileDragProps: (file: File) => HTMLAttributes<HTMLElement>;
};

export type RenderSelectionAction = (props: SelectionActionProps) => ReactNode;
