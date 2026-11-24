import { useEffect, useState } from "react";
import type { LibraryAdapter } from "./adapters";
import type { ActivePage } from "./activePage";

export function useActivePage(adapter: LibraryAdapter) {
  const [page, setPage] = useState<ActivePage>({ loading: false, revision: 0 });
  useEffect(() => adapter.subscribeActivePage?.(setPage), [adapter]);
  return page;
}
