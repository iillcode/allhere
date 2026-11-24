import { ArrowDownToLine, Check, ChevronDown, ChevronUp, FolderOpen, LoaderCircle, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { downloading, type DownloadJob } from "./downloads";

const bytes = (value: number) => value >= 1024 * 1024 ? `${(value / 1024 / 1024).toFixed(1)} MB` : `${Math.max(0, value / 1024).toFixed(0)} KB`;
export function DownloadTray({ jobs, onCancel, onDismiss, onShow, embedded = false, onHeight }: {
  jobs: DownloadJob[]; onCancel: (id: string) => void; onDismiss: (id: string) => void; onShow: (id: number) => void; embedded?: boolean; onHeight?: (height: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const trayRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const element = trayRef.current;
    if (!element || !onHeight) return;
    const measure = () => onHeight(element.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => { observer.disconnect(); onHeight(0); };
  }, [onHeight]);
  if (!jobs.length) return null;
  const active = jobs.filter(downloading);
  const current = active[0] || jobs[0];
  const visible = expanded && !embedded ? jobs : [current];
  return <section ref={trayRef} className={`download-tray${embedded ? " download-tray--embedded" : ""}`} aria-label="Downloads">
    {!embedded && <div className="download-tray__header">
      <span><ArrowDownToLine size={16} /> Downloads{active.length > 0 && <small>{active.length} active</small>}</span>
      <button type="button" aria-label={expanded ? "Collapse downloads" : "Show all downloads"} aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
        {expanded ? <ChevronDown size={17} /> : <ChevronUp size={17} />}
      </button>
    </div>}
    <div className="download-tray__jobs">
      {visible.map(job => {
        const busy = downloading(job);
        const percent = job.total > 0 && ["downloading", "saving", "complete"].includes(job.state) ? Math.min(100, job.received / job.total * 100) : undefined;
        const status = job.state === "complete" ? "Downloaded" : job.state === "failed" ? "Download failed" : job.state === "cancelled" ? "Cancelled"
          : job.state === "processing" ? job.kind === "audio" ? "Preparing audio…" : "Preparing video…" : job.state === "queued" ? "Queued…" : job.state === "preparing" ? "Finding media…"
            : `${job.state === "saving" ? "Saving" : "Downloading"} · ${bytes(job.received)}${job.total ? ` / ${bytes(job.total)}` : ""}${percent !== undefined ? ` · ${Math.floor(percent)}%` : ""}`;
        return <div className={`download-tray__job download-tray__job--${job.state}`} key={job.id}>
          <div className="download-tray__row">
            {busy ? <LoaderCircle className="spin" size={17} /> : job.state === "complete" ? <Check size={17} /> : <ArrowDownToLine size={17} />}
            <div className="download-tray__copy"><strong title={job.title}>{job.title}</strong><small role="status">{status}</small></div>
            {job.state === "complete" && typeof job.browserId === "number" && <button type="button" aria-label={`Show ${job.title} in folder`} onClick={() => onShow(job.browserId!)}><FolderOpen size={17} /></button>}
            <button type="button" aria-label={`${busy ? "Cancel download of" : "Dismiss download of"} ${job.title}`} onClick={() => busy ? onCancel(job.id) : onDismiss(job.id)}><X size={17} /></button>
          </div>
          {busy && <progress max={100} value={percent} aria-label={`Download progress for ${job.title}`} />}
          {job.error && <p title={embedded ? job.error : undefined}>{job.error}</p>}
        </div>;
      })}
    </div>
  </section>;
}
