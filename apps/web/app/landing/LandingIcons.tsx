import type { SVGProps } from "react";

type IconName = "arrow" | "scan" | "grid" | "bookmark" | "shield" | "check" | "link" | "file" | "search" | "panel" | "download" | "upload" | "chevron" | "info" | "warning";

const paths: Record<IconName, React.ReactNode> = {
  arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
  scan: <><path d="M8 3H5a2 2 0 0 0-2 2v3m13-5h3a2 2 0 0 1 2 2v3M3 16v3a2 2 0 0 0 2 2h3m13-5v3a2 2 0 0 1-2 2h-3M3 12h18" /></>,
  grid: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
  bookmark: <path d="M6 4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v17l-6-4-6 4Z" />,
  shield: <><path d="m12 3 8 3v6c0 4-4 7-8 9-4-2-8-5-8-9V6Z" /><path d="m8 12 3 3 5-6" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  link: <><path d="m10 13 4-4m-6 7H6a4 4 0 0 1 0-8h5m2 0h5a4 4 0 0 1 0 8h-5" /></>,
  file: <><path d="M6 3h8l4 4v14H6ZM14 3v5h4M9 12h6m-6 4h6" /></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" /></>,
  panel: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M14 4v16M7 8h3m-3 4h3" /></>,
  download: <><path d="M12 3v12m-4-4 4 4 4-4M4 16v4h16v-4" /></>,
  upload: <><path d="M12 16V4m-4 4 4-4 4 4M4 16v4h16v-4" /></>,
  chevron: <path d="m6 9 6 6 6-6" />,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6m0-10v.01" /></>,
  warning: <><path d="m12 3 10 18H2ZM12 9v5m0 3v.01" /></>,
};

export function Icon({ name, ...props }: SVGProps<SVGSVGElement> & { name: IconName }) {
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name]}</svg>;
}

export function ChromeIcon() {
  return <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="#fff" /><path d="M12 2a10 10 0 0 1 8.66 5H12a5 5 0 0 0-4.33 7.5L3.34 7A10 10 0 0 1 12 2Z" fill="#ea4335" /><path d="M20.66 7a10 10 0 0 1-8.66 15l4.33-7.5A5 5 0 0 0 12 7Z" fill="#fbbc04" /><path d="M12 22A10 10 0 0 1 3.34 7l4.33 7.5a5 5 0 0 0 8.66 0Z" fill="#34a853" /><circle cx="12" cy="12" r="4.6" fill="#4285f4" stroke="#fff" strokeWidth="1.2" /></svg>;
}
