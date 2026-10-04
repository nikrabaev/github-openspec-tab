import { useEffect, useRef, useState } from 'react';
import type { Diagram } from '@/openspec';
import { usePull } from '../context';
import { CloseIcon, ZoomInIcon, ZoomOutIcon } from '../icons';

/** Load an SVG of the pull request as an object URL. An `<img>` never runs scripts inside it. */
function useSvg(path: string): { url: string | null; failed: boolean } {
  const { data } = usePull();
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let created: string | null = null;
    data.readFile('head', path).then((text) => {
      if (cancelled) return;
      if (!text) {
        setFailed(true);
        return;
      }
      created = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
      setUrl(created);
    });
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [data, path]);
  return { url, failed };
}

function Lightbox({ url, name, onClose }: { url: string; name: string; onClose(): void }) {
  const [zoom, setZoom] = useState(1);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);
  const step = (factor: number) => setZoom((value) => Math.min(4, Math.max(0.5, value * factor)));
  return (
    <dialog
      ref={ref}
      className="lightbox"
      aria-label={`Diagram: ${name}`}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === ref.current) ref.current?.close();
      }}
      onKeyDown={(event) => {
        if (event.key === '+' || event.key === '=') step(1.25);
        if (event.key === '-') step(0.8);
        if (event.key === '0') setZoom(1);
        event.stopPropagation();
      }}
    >
      <div className="lightbox-bar">
        <strong>{name}</strong>
        <span className="grow" />
        <button
          type="button"
          className="icon-button"
          onClick={() => step(0.8)}
          aria-label="Zoom out"
        >
          <ZoomOutIcon />
        </button>
        <button
          type="button"
          className="zoom-level"
          onClick={() => setZoom(1)}
          aria-label="Reset zoom"
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          type="button"
          className="icon-button"
          onClick={() => step(1.25)}
          aria-label="Zoom in"
        >
          <ZoomInIcon />
        </button>
        <button
          type="button"
          className="icon-button"
          onClick={() => ref.current?.close()}
          aria-label="Close"
        >
          <CloseIcon />
        </button>
      </div>
      <div className="lightbox-stage">
        <img src={url} alt={name} style={{ width: `${zoom * 100}%` }} className="diagram-img" />
      </div>
    </dialog>
  );
}

/** An Excalidraw diagram stored next to the change, shown inline with zoom. */
export function DiagramFigure({ diagram }: { diagram: Diagram }) {
  const { url, failed } = useSvg(diagram.path);
  const [open, setOpen] = useState(false);
  const title = diagram.name.replace(/[-_]+/g, ' ');
  return (
    <figure className="diagram">
      {url ? (
        <button
          type="button"
          className="diagram-button"
          onClick={() => setOpen(true)}
          aria-label={`Zoom diagram: ${title}`}
        >
          <img src={url} alt={`Diagram: ${title}`} className="diagram-img" />
          <span className="diagram-zoom">
            <ZoomInIcon size={14} /> Zoom
          </span>
        </button>
      ) : (
        <div className={failed ? 'diagram-placeholder' : 'diagram-placeholder skeleton'}>
          {failed && 'This diagram could not be loaded.'}
        </div>
      )}
      <figcaption>{title}</figcaption>
      {open && url && <Lightbox url={url} name={title} onClose={() => setOpen(false)} />}
    </figure>
  );
}
