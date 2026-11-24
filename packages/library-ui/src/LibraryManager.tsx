"use client";

import { ArrowLeft, Bookmark, ChevronRight, Files, Search, Trash2, Undo2, X } from "lucide-react";
import { labelForResource, resourceName, type CapturedResource, type PageCapture } from "@stashwell/core";
import { useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Pagination, usePagination } from "./Pagination";
import { TabFavicon } from "./TabFavicon";

type Props = {
  captures: PageCapture[];
  query: string;
  onQueryChange: (query: string) => void;
  busy: boolean;
  error: string;
  undoLabel?: string;
  onClose: () => void;
  onUndo: () => Promise<void>;
  onDeletePages: (ids: string[]) => Promise<void>;
  onDeleteResources: (captureId: string, ids: string[]) => Promise<void>;
  renderPreview: (capture: PageCapture, resource: CapturedResource, name: string) => ReactNode;
};

export function LibraryManager({ captures, query, onQueryChange: setQuery, busy, error, undoLabel, onClose, onUndo, onDeletePages, onDeleteResources, renderPreview }: Props) {
  const [pageId, setPageId] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(() => new Set());
  const headingRef = useRef<HTMLHeadingElement>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);
  const page = captures.find((capture) => capture.id === pageId);
  const deferredQuery = useDeferredValue(query);
  const needle = deferredQuery.trim().toLowerCase();
  const pages = useMemo(() => captures.filter((capture) => !needle || `${capture.pageTitle} ${capture.pageUrl}`.toLowerCase().includes(needle)), [captures, needle]);
  const namedResources = useMemo(() => (page?.resources ?? []).map((resource, index) => ({ resource, name: resourceName(resource, index) })), [page]);
  const resources = useMemo(() => !needle ? namedResources : namedResources.filter(({ resource, name }) =>
    [name, resource.description, resource.alt, /^data:/i.test(resource.url) ? "Inline resource" : resource.url, labelForResource(resource.kind)]
      .filter(Boolean).join(" ").toLowerCase().includes(needle)), [namedResources, needle]);
  const visibleIds = useMemo(() => page ? resources.map(({ resource }) => resource.id) : pages.map(capture => capture.id), [page, resources, pages]);
  const allSelected = visibleIds.length > 0 && checked.size >= visibleIds.length && visibleIds.every((id) => checked.has(id));
  const pageResults = usePagination(pages, 48, needle);
  const resourceResults = usePagination(resources, 48, JSON.stringify([pageId, needle]));
  const selectedCount = checked.size;

  useEffect(() => { headingRef.current?.focus(); }, []);
  useEffect(() => {
    if (pageId && !page) { setPageId(null); setQuery(""); setChecked(new Set()); }
    setChecked((current) => {
      if (!current.size) return current;
      const valid = new Set(page ? page.resources.map((resource) => resource.id) : captures.map((capture) => capture.id));
      return [...current].every((id) => valid.has(id)) ? current : new Set([...current].filter((id) => valid.has(id)));
    });
  }, [captures, page, pageId, setQuery]);
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = visibleIds.some((id) => checked.has(id)) && !allSelected;
  }, [checked, allSelected, visibleIds]);

  const toggle = (id: string) => setChecked((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const switchPage = (id: string | null) => {
    setPageId(id); setQuery(""); setChecked(new Set());
    window.requestAnimationFrame(() => headingRef.current?.focus({ preventScroll: true }));
  };
  const deleteSelected = () => page ? onDeleteResources(page.id, [...checked]) : onDeletePages([...checked]);

  return <section className="library-manager" aria-label="Manage captured library" aria-busy={busy || query !== deferredQuery}>
    <div className="library-manager__heading">
      <button className="icon-button" type="button" aria-label={page ? "Back to captured pages" : "Back to library"} onClick={() => page ? switchPage(null) : onClose()}><ArrowLeft size={20} /></button>
      <div>
        <h1 ref={headingRef} tabIndex={-1}>{page ? page.pageTitle || page.hostname : "Manage library"}</h1>
        <p>{page ? `${page.resources.length} items · ${page.hostname}` : `${captures.length} pages · ${captures.reduce((count, capture) => count + capture.resources.length, 0)} items`}</p>
      </div>
      {page && <button className="icon-button library-manager__delete" type="button" aria-label={`Delete page ${page.pageTitle || page.hostname}`} title="Delete this page and its captured items" disabled={busy} onClick={() => void onDeletePages([page.id])}><Trash2 size={18} /></button>}
    </div>
    {!page && <p className="library-manager__intro">Open a captured page to manage its items, or select pages to remove them from your library.</p>}
    {page && <p className="library-manager__url" title={page.pageUrl}>{page.pageUrl}</p>}
    <div className="library-manager__toolbar">
      <label className="library-manager__search"><Search size={17} aria-hidden="true" /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={page ? "Find captured items" : "Find captured pages"} aria-label={page ? "Find captured items" : "Find captured pages"} />{query && <button type="button" aria-label="Clear management search" onClick={() => setQuery("")}><X size={15} /></button>}</label>
      <div className="library-manager__selection">
        <label><input ref={selectAllRef} type="checkbox" checked={allSelected} disabled={busy || !visibleIds.length || query !== deferredQuery} onChange={() => setChecked((current) => {
          const next = new Set(current);
          visibleIds.forEach((id) => allSelected ? next.delete(id) : next.add(id));
          return next;
        })} /><span>{selectedCount ? `${selectedCount} selected` : "Select all"}</span></label>
        {selectedCount > 0 && <button className="text-button" type="button" disabled={busy} onClick={() => setChecked(new Set())}>Unselect all</button>}
        <button className="library-manager__delete-selected" type="button" disabled={busy || !selectedCount} onClick={() => void deleteSelected()}><Trash2 size={15} /><span>{busy ? "Saving…" : "Delete selected"}</span></button>
      </div>
    </div>
    {error && <div className="library-manager__error" role="alert">{error}</div>}
    {undoLabel && <div className="library-manager__undo" role="status"><span>{undoLabel}.</span><button type="button" disabled={busy} onClick={() => void onUndo()}><Undo2 size={15} />Undo</button></div>}
    <Pagination page={page ? resourceResults : pageResults} label="Management results pages" />
    <div className="library-manager__list">
      {page ? resourceResults.items.map(({ resource, name }) => <div className="library-manager__row" key={resource.id}>
        <input type="checkbox" checked={checked.has(resource.id)} disabled={busy} onChange={() => toggle(resource.id)} aria-label={`Select ${name}`} />
        <div className="library-manager__preview">{renderPreview(page, resource, name)}</div>
        <span className="library-manager__copy"><strong title={name}>{name}</strong><small title={/^data:/i.test(resource.url) ? undefined : resource.url}>{/^data:/i.test(resource.url) ? "Inline resource" : resource.url}</small><span>{labelForResource(resource.kind)}{resource.saved && <Bookmark size={12} aria-label="Saved item" />}</span></span>
        <button className="icon-button library-manager__delete" type="button" disabled={busy} aria-label={`Delete ${name}`} onClick={() => void onDeleteResources(page.id, [resource.id])}><Trash2 size={17} /></button>
      </div>) : pageResults.items.map((capture) => <div className="library-manager__row library-manager__row--page" key={capture.id}>
        <input type="checkbox" checked={checked.has(capture.id)} disabled={busy} onChange={() => toggle(capture.id)} aria-label={`Select page ${capture.pageTitle || capture.hostname}`} />
        <button className="library-manager__page" type="button" onClick={() => switchPage(capture.id)} aria-label={`Manage items from ${capture.pageTitle || capture.hostname}`}>
          <TabFavicon url={capture.faviconUrl} pageUrl={capture.pageUrl} className="library-manager__page-mark" fallbackSize={21} />
          <span className="library-manager__copy"><strong title={capture.pageTitle}>{capture.pageTitle || capture.hostname}</strong><small title={capture.pageUrl}>{capture.pageUrl}</small><span>{capture.resources.length} items · {new Date(capture.capturedAt).toLocaleDateString()}</span></span>
          <ChevronRight size={17} aria-hidden="true" />
        </button>
        <button className="icon-button library-manager__delete" type="button" disabled={busy} aria-label={`Delete page ${capture.pageTitle || capture.hostname}`} onClick={() => void onDeletePages([capture.id])}><Trash2 size={17} /></button>
      </div>)}
    </div>
    {!visibleIds.length && <div className="library-manager__empty"><Files size={28} /><h2>{query ? "No matches found" : page ? "No captured items" : "No captured pages"}</h2><p>{query ? "Try another name or URL." : page ? "This page has no items in your library." : "Scan a webpage to add it to your library."}</p></div>}
  </section>;
}
