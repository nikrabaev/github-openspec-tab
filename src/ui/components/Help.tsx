import { useEffect, useRef } from 'react';
import { CloseIcon } from '../icons';
import { OpLabel } from './common';

const SHORTCUTS: Array<[string[], string]> = [
  [['j'], 'Next section or requirement'],
  [['k'], 'Previous section or requirement'],
  [['m'], 'Mark the current one as read'],
  [['1'], 'Inline changes'],
  [['2'], 'Side by side'],
  [['3'], 'New version only'],
  [['/'], 'Filter the outline'],
  [['?'], 'Show this help'],
  [['Esc'], 'Close, or leave the filter'],
];

export function HelpDialog({ onClose }: { onClose(): void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the click closes on the backdrop; Escape is the dialog's own key
    <dialog
      ref={ref}
      className="help"
      aria-labelledby="openspec-help-title"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === ref.current) ref.current?.close();
      }}
    >
      <header>
        <h2 id="openspec-help-title">Reading the OpenSpec tab</h2>
        <button
          type="button"
          className="icon-button"
          onClick={() => ref.current?.close()}
          aria-label="Close"
        >
          <CloseIcon />
        </button>
      </header>
      <div className="help-body">
        <section>
          <h3>Keyboard</h3>
          <dl className="keys">
            {SHORTCUTS.map(([keys, text]) => (
              <div key={text}>
                <dt>
                  {keys.map((key) => (
                    <kbd key={key}>{key}</kbd>
                  ))}
                </dt>
                <dd>{text}</dd>
              </div>
            ))}
          </dl>
        </section>
        <section>
          <h3>Labels</h3>
          <ul className="legend">
            <li>
              <OpLabel op="added" /> A new requirement.
            </li>
            <li>
              <OpLabel op="modified" /> New text for an existing requirement. Struck words were
              removed, highlighted words were added.
            </li>
            <li>
              <OpLabel op="removed" /> The requirement goes away. Its old text is shown dimmed.
            </li>
            <li>
              <OpLabel op="renamed" /> Only the name changes.
            </li>
          </ul>
          <p className="muted">
            "Mark as read" is saved in this browser for this pull request. If the author pushes a
            change to something you have read, it is flagged as changed.
          </p>
        </section>
      </div>
    </dialog>
  );
}
