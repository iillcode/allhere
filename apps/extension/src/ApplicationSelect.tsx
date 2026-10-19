import { Check, ChevronDown, PanelsTopLeft } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { designApplications } from "./prepareAssets";
import figmaLogo from "./assets/app-logos/figma.svg";
import penpotLogo from "./assets/app-logos/penpot.png";
import sketchLogo from "./assets/app-logos/sketch.svg";
import canvaLogo from "./assets/app-logos/canva.ico";
import illustratorLogo from "./assets/app-logos/illustrator.svg";
import photoshopLogo from "./assets/app-logos/photoshop.svg";
import affinityLogo from "./assets/app-logos/affinity.png";
import photopeaLogo from "./assets/app-logos/photopea.png";
import inkscapeLogo from "./assets/app-logos/inkscape.svg";

const logos: Record<string, string> = {
  figma: figmaLogo, penpot: penpotLogo, sketch: sketchLogo, canva: canvaLogo,
  illustrator: illustratorLogo, photoshop: photoshopLogo, affinity: affinityLogo,
  photopea: photopeaLogo, inkscape: inkscapeLogo,
};

function ApplicationLogo({ id }: { id: string }) {
  return <span className="application-select__logo" aria-hidden="true">
    {logos[id] ? <img src={logos[id]} alt="" width={24} height={24} draggable={false} /> : <PanelsTopLeft size={22} />}
  </span>;
}

export function ApplicationSelect({ value, disabled, onChange }: {
  value: string;
  disabled: boolean;
  onChange: (id: string) => void;
}) {
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const typed = useRef({ text: "", at: 0 });
  const [open, setOpen] = useState(false);
  const selected = Math.max(0, designApplications.findIndex(app => app.id === value));
  const [active, setActive] = useState(selected);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    const trigger = triggerRef.current;
    if (!panel || !trigger || !open || disabled) return;
    const position = () => {
      const rect = trigger.getBoundingClientRect();
      const below = window.innerHeight - rect.bottom - 14;
      const above = rect.top - 14;
      const desiredHeight = Math.min(336, panel.scrollHeight + 2);
      const placeBelow = below >= desiredHeight || below >= above;
      const height = Math.max(40, Math.min(desiredHeight, placeBelow ? below : above));
      const width = Math.min(rect.width, window.innerWidth - 24);
      panel.style.width = `${width}px`;
      panel.style.maxHeight = `${height}px`;
      panel.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))}px`;
      panel.style.top = `${Math.max(12, placeBelow ? rect.bottom + 6 : rect.top - height - 6)}px`;
    };
    panel.showPopover();
    position();
    const observer = new ResizeObserver(position);
    observer.observe(trigger);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => {
      if (panel.matches(":popover-open")) panel.hidePopover();
      observer.disconnect();
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
    };
  }, [open, disabled]);

  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    const option = panel?.querySelector<HTMLElement>(`[data-application="${designApplications[active]?.id}"]`);
    if (!open || !panel || !option) return;
    if (option.offsetTop < panel.scrollTop) panel.scrollTop = option.offsetTop;
    else if (option.offsetTop + option.offsetHeight > panel.scrollTop + panel.clientHeight) {
      panel.scrollTop = option.offsetTop + option.offsetHeight - panel.clientHeight;
    }
  }, [active, open]);

  const show = () => { typed.current = { text: "", at: 0 }; setActive(selected); setOpen(true); };
  const choose = (index: number) => {
    onChange(designApplications[index]!.id);
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
      if (!open) {
        setActive(event.key === "Home" ? 0 : event.key === "End" ? designApplications.length - 1 : selected);
        setOpen(true);
      } else setActive(current => event.key === "Home" ? 0 : event.key === "End" ? designApplications.length - 1
        : (current + (event.key === "ArrowDown" ? 1 : -1) + designApplications.length) % designApplications.length);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault(); event.stopPropagation();
      if (open) choose(active); else show();
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      const now = Date.now();
      const prefix = now - typed.current.at < 600 ? typed.current.text + event.key.toLowerCase() : event.key.toLowerCase();
      typed.current = { text: prefix, at: now };
      const search = [...prefix].every(character => character === prefix[0]) ? prefix[0]! : prefix;
      const start = open ? active : selected;
      const match = designApplications.map((_, index) => (start + index + 1) % designApplications.length)
        .find(index => designApplications[index]!.name.toLowerCase().startsWith(search));
      if (match !== undefined) { setActive(match); setOpen(true); }
    }
  };

  return <div className="application-select design-transfer__destination" ref={rootRef}>
    <label id={`${id}-label`} htmlFor={`${id}-trigger`}>Application</label>
    <button ref={triggerRef} id={`${id}-trigger`} type="button" className="application-select__trigger" role="combobox"
      aria-labelledby={`${id}-label`} aria-expanded={open && !disabled} aria-haspopup="listbox" aria-controls={`${id}-options`}
      aria-activedescendant={open ? `${id}-option-${active}` : undefined} disabled={disabled}
      onClick={() => open ? setOpen(false) : show()} onKeyDown={handleKeyDown}
      onBlur={event => { if (!rootRef.current?.contains(event.relatedTarget as Node | null)) setOpen(false); }}>
      <ApplicationLogo id={value} /><span>{designApplications[selected]!.name}</span><ChevronDown size={17} aria-hidden="true" />
    </button>
    <div ref={panelRef} id={`${id}-options`} className="application-select__options" popover="manual" role="listbox" aria-labelledby={`${id}-label`}>
      {designApplications.map((app, index) => <div key={app.id} id={`${id}-option-${index}`} role="option" aria-selected={app.id === value}
        className={`application-select__option${active === index ? " application-select__option--active" : ""}`} data-application={app.id}
        onPointerDown={event => event.preventDefault()} onPointerMove={() => setActive(index)} onClick={() => choose(index)}>
        <ApplicationLogo id={app.id} /><span>{app.name}</span>{app.id === value && <Check size={17} aria-hidden="true" />}
      </div>)}
    </div>
  </div>;
}
