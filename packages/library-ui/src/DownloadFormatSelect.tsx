import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import type { IconDownloadFormat } from "./imageDownloads";

const formats: { value: IconDownloadFormat; label: string }[] = [
  { value: "original", label: "Original format" },
  { value: "svg", label: "SVG" },
  { value: "png", label: "PNG" },
  { value: "jpeg", label: "JPEG (.jpg)" },
  { value: "webp", label: "WebP" },
];
const imageFormats = formats.filter(format => format.value !== "svg");

export function DownloadFormatSelect({ label, value, onChange, allowSvg = false, disabled = false }: {
  label: string;
  value: IconDownloadFormat;
  onChange: (format: IconDownloadFormat) => void;
  allowSvg?: boolean;
  disabled?: boolean;
}) {
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const typed = useRef({ text: "", at: 0 });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const options = allowSvg ? formats : imageFormats;
  const selected = Math.max(0, options.findIndex(format => format.value === value));
  const help = value === "svg" ? "Vector icons stay vector. Raster icons are embedded in SVG."
    : value === "jpeg" ? "Transparency becomes white. Animated images save one frame."
      : value !== "original" ? "Animated images save one frame." : undefined;

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    if (!open || disabled) { panel.hidePopover(); return; }
    const position = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const desiredHeight = options.length * 36 + 12;
      const below = window.innerHeight - rect.bottom - 14;
      const above = rect.top - 14;
      const placeBelow = below >= desiredHeight || below >= above;
      const height = Math.max(36, Math.min(desiredHeight, placeBelow ? below : above));
      const width = Math.min(rect.width, window.innerWidth - 16);
      panel.style.width = `${width}px`;
      panel.style.maxHeight = `${height}px`;
      panel.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`;
      panel.style.top = `${Math.max(8, placeBelow ? rect.bottom + 6 : rect.top - height - 6)}px`;
    };
    position();
    panel.showPopover();
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => {
      panel.hidePopover();
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
    };
  }, [open, disabled, options.length]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);

  useEffect(() => {
    const panel = panelRef.current;
    const option = panel?.querySelector<HTMLElement>(`[data-format="${options[active]?.value}"]`);
    if (!open || !panel || !option) return;
    if (option.offsetTop < panel.scrollTop) panel.scrollTop = option.offsetTop;
    else if (option.offsetTop + option.offsetHeight > panel.scrollTop + panel.clientHeight) {
      panel.scrollTop = option.offsetTop + option.offsetHeight - panel.clientHeight;
    }
  }, [active, open, options]);

  const show = () => { setActive(selected); setOpen(true); };
  const choose = (format: IconDownloadFormat) => {
    onChange(format);
    setOpen(false);
    triggerRef.current?.focus({ preventScroll: true });
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Escape" && open) {
      event.preventDefault(); event.stopPropagation(); setOpen(false);
    } else if (event.key === "Tab") {
      setOpen(false);
    } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault(); event.stopPropagation();
      if (!open) show();
      else setActive(current => event.key === "Home" ? 0 : event.key === "End" ? options.length - 1
        : (current + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault(); event.stopPropagation();
      if (open) choose(options[active].value); else show();
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      const now = Date.now();
      const prefix = now - typed.current.at < 600 ? typed.current.text + event.key.toLowerCase() : event.key.toLowerCase();
      typed.current = { text: prefix, at: now };
      const search = [...prefix].every(character => character === prefix[0]) ? prefix[0] : prefix;
      const start = open ? active : selected;
      const match = options.map((_, index) => (start + index + 1) % options.length)
        .find(index => options[index].label.toLowerCase().startsWith(search));
      if (match !== undefined) { setActive(match); setOpen(true); }
    }
  };

  return <div className="download-format" ref={rootRef}>
    <label id={`${id}-label`} htmlFor={`${id}-trigger`}>{label}</label>
    <button ref={triggerRef} id={`${id}-trigger`} className="download-format__trigger" type="button" role="combobox"
      aria-labelledby={`${id}-label`} aria-expanded={open && !disabled} aria-haspopup="listbox" aria-controls={`${id}-options`}
      aria-activedescendant={open ? `${id}-option-${active}` : undefined} aria-describedby={help ? `${id}-help` : undefined}
      disabled={disabled} onClick={() => open ? setOpen(false) : show()} onKeyDown={handleKeyDown}
      onBlur={event => { if (!rootRef.current?.contains(event.relatedTarget as Node | null)) setOpen(false); }}>
      <span>{options[selected].label}</span><ChevronDown size={16} aria-hidden="true" />
    </button>
    <div ref={panelRef} id={`${id}-options`} className="download-format__options" popover="manual" role="listbox" aria-labelledby={`${id}-label`}>
      {options.map((format, index) => <div key={format.value} id={`${id}-option-${index}`}
        className={`download-format__option${active === index ? " download-format__option--active" : ""}`}
        role="option" aria-selected={format.value === value} data-format={format.value}
        onPointerDown={event => event.preventDefault()} onPointerMove={() => setActive(index)} onClick={() => choose(format.value)}>
        <span>{format.label}</span>{format.value === value && <Check size={16} aria-hidden="true" />}
      </div>)}
    </div>
    {help && <small id={`${id}-help`}>{help}</small>}
  </div>;
}
