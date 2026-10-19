import { useEffect, useRef, useState } from "react";
import { ArrowDownToLine, ArrowUpRight, Check, Copy, FileImage, GripVertical, LoaderCircle, Send, SlidersHorizontal, X } from "lucide-react";
import type { LibrarySelectionItem, SelectionActionProps } from "@stashwell/library-ui";
import { iconNeedsDarkBackground, requestWebsiteAccess, websiteOrigins } from "@stashwell/library-ui/asset-tools";
import { ApplicationSelect } from "./ApplicationSelect";
import {
  applicationInstructions, createAssetPack, createPngBoard, createSvgBoard, designApplications, designSelection,
  MAX_DESIGN_ASSETS, prepareDesignAssets, type PreparedAsset, type PreparedSet, type SourceCache, type TransferOptions,
} from "./prepareAssets";

export function DesignTransfer(props: SelectionActionProps) {
  const [selection, setSelection] = useState<LibrarySelectionItem[] | null>(null);
  if (!selection && !designSelection(props.items).groups.length) return null;
  return <div className="design-transfer-slot">
    <button type="button" className="button button--primary design-transfer-launch" aria-haspopup="dialog" disabled={props.disabled}
      onClick={() => setSelection(props.items.map(item => ({ ...item })))}><Send size={16} aria-hidden="true" />Send to app</button>
    {selection && <DesignTransferDialog {...props} selection={selection} onClose={() => setSelection(null)} />}
  </div>;
}

function AssetTile({ asset, saveFile, fileDragProps }: Pick<SelectionActionProps, "saveFile" | "fileDragProps"> & { asset: PreparedAsset }) {
  const [url, setUrl] = useState("");
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const objectUrl = URL.createObjectURL(asset.file);
    setUrl(objectUrl); setDark(false);
    return () => URL.revokeObjectURL(objectUrl);
  }, [asset.file]);
  return <button {...fileDragProps(asset.file)} type="button" className="design-asset" onClick={() => void saveFile(asset.file)}
    aria-label={`Download ${asset.file.name}`} aria-description="Drag the prepared file into a web application's upload area, or click to download."
    title={`${asset.file.name} · ${asset.width} × ${asset.height} · drag or download`}>
    <span className={`design-asset__preview${dark ? " design-asset__preview--dark" : ""}`}>
      {url ? <img src={url} alt="" draggable={false} onLoad={event => {
        const image = event.currentTarget;
        void iconNeedsDarkBackground(url, image).then(value => { if (image.isConnected) setDark(value); }).catch(() => undefined);
      }} /> : <FileImage size={22} aria-hidden="true" />}
      <GripVertical size={15} aria-hidden="true" className="design-asset__grip" />
    </span>
    <span className="design-asset__name">{asset.file.name}</span>
    <span className="design-asset__meta">{asset.vector ? "SVG" : "PNG"} · {asset.width} × {asset.height}</span>
  </button>;
}

function SelectionPreview({ item }: { item: LibrarySelectionItem }) {
  const [dark, setDark] = useState(false);
  return <span title={item.label} className={dark ? "design-transfer__selection--dark" : undefined}>
    {/^(?:https?:|data:image\/)/i.test(item.url) ? <img src={item.url} alt={item.label} draggable={false}
      onError={event => { event.currentTarget.style.visibility = "hidden"; }} onLoad={event => {
        const image = event.currentTarget;
        void iconNeedsDarkBackground(item.url, image).then(value => { if (image.isConnected) setDark(value); }).catch(() => undefined);
      }} /> : <FileImage size={22} />}
  </span>;
}

function DesignTransferDialog({ selection, onClose, saveFile, fileDragProps }: SelectionActionProps & { selection: LibrarySelectionItem[]; onClose: () => void }) {
  const [applicationId, setApplicationId] = useState("figma");
  const application = designApplications.find(app => app.id === applicationId)!;
  const [options, setOptions] = useState<TransferOptions>({ format: "auto", edge: 0, padding: 0, background: "transparent" });
  const [result, setResult] = useState<PreparedSet | null>(null);
  const [partialApproved, setPartialApproved] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [outputBusy, setOutputBusy] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const preparedRef = useRef<HTMLHeadingElement>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const cacheRef = useRef<SourceCache>(new Map());
  const outputRef = useRef(false);
  const mountedRef = useRef(true);
  const summary = designSelection(selection);
  const ready = Boolean(!preparing && result?.assets.length && (!result.failures.length || partialApproved));
  const busy = preparing || outputBusy;

  useEffect(() => {
    mountedRef.current = true;
    const dialog = dialogRef.current!;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();
    return () => {
      mountedRef.current = false;
      controllerRef.current?.abort(); controllerRef.current = null;
      cacheRef.current.clear();
      dialog.close(); document.body.style.overflow = previousOverflow;
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    if (!result) return;
    preparedRef.current?.focus({ preventScroll: true });
    preparedRef.current?.scrollIntoView({ block: "start" });
  }, [result]);

  function changeOptions(next: Partial<TransferOptions>) {
    setOptions(current => ({ ...current, ...next }));
    setResult(null); setPartialApproved(false); setError(""); setMessage("");
  }

  async function prepare() {
    if (controllerRef.current || outputRef.current) return;
    if (summary.groups.length > MAX_DESIGN_ASSETS) { setError(`Choose up to ${MAX_DESIGN_ASSETS} unique assets at a time.`); return; }
    const controller = new AbortController(); controllerRef.current = controller;
    setPreparing(true); setError(""); setMessage(""); setPartialApproved(false);
    setProgress({ done: 0, total: summary.groups.length });
    try {
      // Ask only for the selected source hosts, synchronously from this click.
      // Cached or inline images do not need another permission request.
      const urls = summary.groups.map(group => group[0]!.url).filter(url => !cacheRef.current.has(url));
      const access = requestWebsiteAccess(websiteOrigins(urls));
      if (!await access) throw new Error("Website access was not granted. Choose Prepare set to try again.");
      if (controller.signal.aborted) return;
      const prepared = await prepareDesignAssets(selection, options, cacheRef.current,
        (done, total) => { if (controllerRef.current === controller) setProgress({ done, total }); }, controller.signal);
      if (controllerRef.current === controller) {
        setResult(prepared);
        if (!prepared.failures.length) setMessage(`${prepared.assets.length} ${prepared.assets.length === 1 ? "asset is" : "assets are"} ready.`);
      }
    } catch (failure) {
      if (controllerRef.current === controller) {
        if (controller.signal.aborted) setMessage("Preparation cancelled. Your selection is still here.");
        else setError(failure instanceof Error ? failure.message : "The set could not be prepared. Try again.");
      }
    } finally {
      if (controllerRef.current === controller) { controllerRef.current = null; setPreparing(false); }
    }
  }

  function cancelPreparation() {
    controllerRef.current?.abort(); controllerRef.current = null;
    setPreparing(false); setResult(null); setPartialApproved(false);
    setMessage("Preparation cancelled. Your selection is still here.");
  }

  async function output(action: "svg" | "png" | "zip" | File) {
    if (!ready || !result || outputRef.current || controllerRef.current) return;
    outputRef.current = true; setOutputBusy(true); setError(""); setMessage("");
    try {
      if (action instanceof File) {
        await saveFile(action);
        if (mountedRef.current) setMessage(`Downloading ${action.name}.`);
      } else if (action === "zip") {
        await saveFile(await createAssetPack(result, application, options));
        if (mountedRef.current) setMessage("Download started. Unzip the set, then import the files in the assets folder.");
      } else {
        if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") throw new Error("Clipboard access is unavailable. Download the set and import the files instead.");
        const blob = action === "svg" ? createSvgBoard(result.assets).then(board => new Blob([board.blob], { type: "text/plain" })) : createPngBoard(result.assets);
        void blob.catch(() => undefined);
        // Supply the promise before losing the click's clipboard activation.
        await navigator.clipboard.write([new ClipboardItem({ [action === "svg" ? "text/plain" : "image/png"]: blob })]);
        if (mountedRef.current) setMessage(action === "svg" ? `SVG set copied. Open ${application.name} and paste into your design.` : "Image copied. Paste into your application to add the set as one image.");
      }
    } catch (failure) {
      if (mountedRef.current) setError(failure instanceof DOMException && failure.name === "NotAllowedError"
        ? "Clipboard access was blocked. Try copying again, or download the set and import its files."
        : failure instanceof Error ? failure.message : "The handoff could not finish. Try downloading the set.");
    } finally {
      outputRef.current = false;
      if (mountedRef.current) setOutputBusy(false);
    }
  }

  const copySvg = application.copySvg && options.format === "auto";
  return <dialog ref={dialogRef} className="design-transfer" aria-labelledby="design-transfer-title" aria-describedby="design-transfer-description"
    onKeyDown={event => {
      if (event.key !== "Tab") return;
      const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]'))
        .filter(control => control.getClientRects().length && !control.closest("[inert]"));
      const first = controls[0]; const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => {
      if (event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
    }}>
    <header className="design-transfer__header">
      <div><h2 id="design-transfer-title">Send to an app</h2><p id="design-transfer-description">{summary.groups.length} {summary.groups.length === 1 ? "asset" : "assets"} selected · prepare, then transfer</p></div>
      <button type="button" className="icon-button" aria-label="Close asset transfer" onClick={onClose}><X size={19} /></button>
    </header>
    <div className="design-transfer__body">
      <div className="design-transfer__fields">
        <ApplicationSelect value={applicationId} disabled={busy} onChange={id => {
            const next = designApplications.find(app => app.id === id)!;
            setApplicationId(next.id); setMessage(""); setError("");
            if (options.format !== next.format) changeOptions({ format: next.format });
          }} />
        {!result && <><label>Format<select value={options.format} disabled={busy} onChange={event => changeOptions({ format: event.target.value as TransferOptions["format"] })}>
          <option value="auto">SVG + PNG</option><option value="png">PNG only</option>
        </select></label>
        <label>Longest edge<select value={options.edge} disabled={busy} onChange={event => changeOptions({ edge: Number(event.target.value) })}>
          {[0, 24, 32, 48, 64, 128, 256, 512, 1024, 2048, 4096].map(size => <option key={size} value={size}>{size ? `${size} px` : "Original size"}</option>)}
        </select></label>
        <label>Padding<select value={options.padding} disabled={busy} onChange={event => changeOptions({ padding: Number(event.target.value) })}>
          {[0, 8, 16, 24].map(size => <option key={size} value={size}>{size} px</option>)}
        </select></label>
        <label>Background<select value={options.background} disabled={busy} onChange={event => changeOptions({ background: event.target.value as TransferOptions["background"] })}>
          <option value="transparent">Transparent</option><option value="white">White</option><option value="black">Black</option>
        </select></label></>}
      </div>
      {result ? <div className="design-transfer__settings-summary"><span>{options.format === "auto" ? "SVG + PNG" : "PNG"} · {options.edge ? `${options.edge} px` : "Original size"} · {options.padding ? `${options.padding} px padding` : "No padding"} · {options.background}</span>
        <button type="button" className="text-button" disabled={busy} onClick={() => { setResult(null); setPartialApproved(false); setMessage(""); setError(""); }}><SlidersHorizontal size={15} />Edit preparation</button>
      </div> : <p className="design-transfer__hint">{options.format === "auto" ? "SVG artwork keeps its vectors. Other images become PNGs." : "Every asset becomes a PNG image. SVG paths will be flattened."} Proportions stay intact; padding adds space around each asset. Animated images use their first frame.</p>}
      {summary.ignored > 0 && <p className={result ? "design-transfer__hint" : "design-transfer__note"}>{summary.ignored} selected {summary.ignored === 1 ? "resource isn’t an image or icon and won’t" : "resources aren’t images or icons and won’t"} be included.{!result && " Use Download as ZIP in the library for those files."}</p>}
      {(result?.duplicates ?? summary.duplicates) > 0 && <p className="design-transfer__hint">{result?.duplicates ?? summary.duplicates} {(result?.duplicates ?? summary.duplicates) === 1 ? "duplicate removed" : "duplicates removed"} from this set.</p>}

      {!result && !preparing && <div className="design-transfer__selection" aria-label="Selected asset previews">
        {summary.groups.slice(0, 6).map(([item]) => <SelectionPreview key={item!.key} item={item!} />)}
        {summary.groups.length > 6 && <span className="design-transfer__more">+{summary.groups.length - 6}</span>}
      </div>}

      {preparing && <div className="design-transfer__progress" aria-live="polite" role="status">
        <span><LoaderCircle size={17} className="spin" aria-hidden="true" />Preparing {progress.done} of {progress.total}</span>
        <progress max={progress.total || 1} value={progress.done} aria-label="Asset preparation" />
      </div>}

      {result && <section className="design-transfer__prepared" aria-label="Prepared assets">
        <h3 ref={preparedRef} tabIndex={-1}>{result.assets.length} ready{result.failures.length ? ` · ${result.failures.length} need attention` : <Check size={17} aria-hidden="true" />}</h3>
        {result.assets.length > 0 && <>
          <p className="design-transfer__hint">{ready ? "Drag an asset into a web app’s upload area, or click it to download." : "Retry preparation, or choose the ready assets below to continue with this set."}</p>
          <div className="design-transfer__assets" inert={!ready || outputBusy ? true : undefined}>
            {result.assets.map(asset => <AssetTile key={asset.file.name} asset={asset} saveFile={file => output(file)} fileDragProps={fileDragProps} />)}
          </div>
        </>}
        {result.failures.length > 0 && <div className="design-transfer__failures">
          <p>These assets could not be prepared:</p>
          <ul>{result.failures.map(({ item, reason }) => <li key={item.key}><strong>{item.label}</strong><span>{reason}</span></li>)}</ul>
          {partialApproved && <div className="design-transfer__recovery">
            <button type="button" className="button button--secondary" disabled={busy} onClick={() => void prepare()}>Retry preparation</button>
          </div>}
        </div>}
      </section>}

      {ready && <div className="design-transfer__instructions">
        <h3>Bring it into {application.name}</h3>
        <p>{applicationInstructions(application, options)}</p>
        <p className="design-transfer__hint">Clipboard copies arrange the set in a compact grid. Copy image combines it into one PNG; the download keeps assets separate.</p>
        {applicationId === "figma" && result?.assets.some(asset => !asset.vector && Math.max(asset.width, asset.height) > 4096) && <p className="design-transfer__note">Figma reduces images larger than 4096 px. Choose a smaller longest edge to control the import size.</p>}
        {applicationId === "canva" && options.format === "auto" && <p className="design-transfer__note">PNG is recommended for Canva. SVG uploads have extra size and artwork requirements; check the import guide if an SVG is rejected.</p>}
        <div className="design-transfer__links">
          {application.url && <a href={application.url} target="_blank" rel="noreferrer">Open {application.name}<ArrowUpRight size={14} /></a>}
          {application.help && <a href={application.help} target="_blank" rel="noreferrer">Import guide<ArrowUpRight size={14} /></a>}
        </div>
      </div>}
    </div>
    <footer className="design-transfer__footer">
      <div className="design-transfer__feedback" aria-live="polite" aria-atomic="true">
        {error && <p className="design-transfer__error" role="alert">{error}</p>}
        {message && <p className="design-transfer__status">{message}</p>}
      </div>
      {preparing ? <button type="button" className="button button--secondary" onClick={cancelPreparation}>Cancel preparation</button>
        : result?.failures.length && !partialApproved ? <>
          <button type="button" className="button button--primary" disabled={busy} onClick={() => void prepare()}>Retry preparation</button>
          {result.assets.length > 0 && <button type="button" className="button button--secondary" disabled={busy} onClick={() => { setPartialApproved(true); setMessage(`Continuing with ${result.assets.length} ready assets. Exclusions will be listed in the download.`); }}>Use {result.assets.length} ready {result.assets.length === 1 ? "asset" : "assets"}</button>}
        </>
        : ready ? <>
          <button type="button" className="button button--primary" disabled={busy} onClick={() => void output(copySvg ? "svg" : "zip")}>
            {outputBusy ? <LoaderCircle className="spin" size={16} /> : copySvg ? <Copy size={16} /> : <ArrowDownToLine size={16} />}{copySvg ? "Copy SVG set" : "Download set"}
          </button>
          {copySvg && <button type="button" className="button button--secondary" disabled={busy} onClick={() => void output("zip")}><ArrowDownToLine size={16} />Download set</button>}
          <button type="button" className="text-button" disabled={busy} onClick={() => void output("png")}><Copy size={15} />Copy image</button>
        </> : <button type="button" className="button button--primary" disabled={busy || Boolean(result?.failures.length)} onClick={() => void prepare()}><Send size={16} />Prepare set</button>}
    </footer>
  </dialog>;
}
