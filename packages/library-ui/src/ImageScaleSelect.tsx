import { useId } from "react";
import type { ImageScale } from "./imageDownloads";

export function ImageScaleSelect({ value, onChange, disabled = false, originalFormat = false }: {
  value: ImageScale; onChange: (scale: ImageScale) => void; disabled?: boolean; originalFormat?: boolean;
}) {
  const id = useId();
  return <fieldset className="image-scale" aria-describedby={`${id}-help`}>
    <legend>Image size</legend>
    <div className="image-scale__options">
      {([1, 2, 4] as const).map(scale => <button key={scale} type="button" className="image-scale__option"
        data-image-scale={scale} aria-pressed={value === scale} disabled={disabled}
        onClick={() => onChange(scale)}>{scale === 1 ? "Original" : `${scale}×`}</button>)}
    </div>
    <small id={`${id}-help`}>{value === 1 ? "Keep the source dimensions." : `${value}× width and height. Resizing adds pixels, not new detail.`}
      {value > 1 && originalFormat ? " Original format exports as PNG; animation saves one frame." : value > 1 ? " Animation saves one frame." : ""}</small>
  </fieldset>;
}
