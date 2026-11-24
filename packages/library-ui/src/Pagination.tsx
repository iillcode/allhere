"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";

export function usePagination<T>(items: T[], size: number, scope: string) {
  const [position, setPosition] = useState({ scope, index: 0 });
  const pageCount = Math.ceil(items.length / size);
  const index = Math.min(scope === position.scope ? position.index : 0, Math.max(0, pageCount - 1));
  const start = index * size;
  const end = Math.min(start + size, items.length);

  return {
    items: items.slice(start, end),
    total: items.length,
    first: start + 1,
    last: end,
    hasPrevious: index > 0,
    hasNext: index + 1 < pageCount,
    previous: () => setPosition({ scope, index: index - 1 }),
    next: () => setPosition({ scope, index: index + 1 }),
  };
}

type PageControls = Omit<ReturnType<typeof usePagination>, "items">;

export function Pagination({ page, label, menu = false }: { page: PageControls; label: string; menu?: boolean }) {
  if (!page.hasNext && !page.hasPrevious) return null;
  return <div className="library-pagination" role={menu ? "presentation" : "navigation"} aria-label={menu ? undefined : label}>
    <span className="library-pagination__range" aria-live="polite">{page.first}–{page.last} of {page.total}</span>
    <button type="button" className="icon-button" role={menu ? "menuitem" : undefined} aria-label="Previous page" disabled={!page.hasPrevious} onClick={page.previous}><ChevronLeft size={16} /></button>
    <button type="button" className="icon-button" role={menu ? "menuitem" : undefined} aria-label="Next page" disabled={!page.hasNext} onClick={page.next}><ChevronRight size={16} /></button>
  </div>;
}
