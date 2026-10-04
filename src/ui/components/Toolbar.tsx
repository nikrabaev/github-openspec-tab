import { useEffect, useId, useRef } from 'react';
import { DEFAULT_PREFERENCES, type Preferences } from '@/github/messages';
import { useComments } from '../comments';
import { FONTS } from '../fonts';
import { MinusIcon, PlusIcon } from '../icons';
import { plural } from './common';

const VIEWS: Array<{ value: Preferences['diffView']; label: string; hint: string }> = [
  { value: 'inline', label: 'Inline', hint: 'Changes marked in the text (1)' },
  { value: 'split', label: 'Side by side', hint: 'Old against new (2)' },
  { value: 'new', label: 'New only', hint: 'The new version, without marks (3)' },
];

const WIDTHS: Array<{ value: Preferences['contentWidth']; label: string }> = [
  { value: 'narrow', label: 'Narrow' },
  { value: 'medium', label: 'Medium' },
  { value: 'wide', label: 'Wide' },
  { value: 'full', label: 'Full' },
];

/** The smallest and the largest text the reader can choose, and the step between sizes, in percent. */
export const TEXT_SCALE = { min: 80, max: 160, step: 10 };

/** The size the text is shown at for a stored one, which may come from an older build. */
export function fitTextScale(wanted: unknown): number {
  if (typeof wanted !== 'number' || !Number.isFinite(wanted)) return DEFAULT_PREFERENCES.textScale;
  const stepped = Math.round(wanted / TEXT_SCALE.step) * TEXT_SCALE.step;
  return Math.max(TEXT_SCALE.min, Math.min(TEXT_SCALE.max, stepped));
}

/** The weights the body text can have. Bold text is drawn as much heavier as it is at regular. */
export const TEXT_WEIGHTS = [
  { value: 300, label: 'Light' },
  { value: 400, label: 'Regular' },
  { value: 500, label: 'Medium' },
  { value: 600, label: 'Semibold' },
];

/** The weight the text is shown at for a stored one. */
export function fitTextWeight(wanted: unknown): number {
  const known = TEXT_WEIGHTS.some((weight) => weight.value === wanted);
  return known ? (wanted as number) : DEFAULT_PREFERENCES.textWeight;
}

export interface Progress {
  read: number;
  total: number;
  stale: number;
}

export interface ToolbarProps {
  prefs: Preferences;
  onPrefs(change: Partial<Preferences>): void;
  progress: Progress;
  /** Whether the reading settings are open. They show in whichever bar is on screen. */
  settingsOpen: boolean;
  onSettings(open: boolean): void;
  onFinishReview(): void;
  /** The chosen font could not be read from the extension's files. */
  fontFailed: boolean;
}

/** A ring that fills as items are marked as read, as GitHub draws its "viewed" count. */
function ProgressRing({ done, total }: { done: number; total: number }) {
  const radius = 6;
  const length = 2 * Math.PI * radius;
  const share = total > 0 ? Math.min(1, done / total) : 0;
  return (
    <svg
      className={`ring${total > 0 && done >= total ? ' is-complete' : ''}`}
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <circle className="ring-track" cx="8" cy="8" r={radius} strokeWidth="2" />
      {share > 0 && (
        <circle
          className="ring-done"
          cx="8"
          cy="8"
          r={radius}
          strokeWidth="2"
          strokeDasharray={`${share * length} ${length}`}
          transform="rotate(-90 8 8)"
        />
      )}
    </svg>
  );
}

function ReadCount({ progress }: { progress: Progress }) {
  return (
    <div
      className="read-count"
      role="progressbar"
      aria-label="Review progress"
      aria-valuemin={0}
      aria-valuemax={progress.total}
      aria-valuenow={progress.read}
      aria-valuetext={`${progress.read} of ${progress.total} read`}
      title={
        progress.stale > 0
          ? `${plural(progress.stale, 'item')} changed since you read ${progress.stale === 1 ? 'it' : 'them'}`
          : 'Sections and requirements you marked as read'
      }
    >
      <ProgressRing done={progress.read} total={progress.total} />
      <span>
        <strong>{progress.read}</strong> / <strong>{progress.total}</strong>
        <span className="read-count-word"> read</span>
      </span>
      {progress.stale > 0 && <span className="stale-note">{progress.stale} changed</span>}
    </div>
  );
}

function ViewSwitch(props: {
  name: string;
  view: Preferences['diffView'];
  onView(view: Preferences['diffView']): void;
}) {
  return (
    <fieldset className="segmented view-switch">
      <legend className="sr-only">How modified requirements are shown</legend>
      {VIEWS.map((view) => (
        <label
          key={view.value}
          title={view.hint}
          className={props.view === view.value ? 'is-selected' : undefined}
        >
          <input
            type="radio"
            name={props.name}
            value={view.value}
            checked={props.view === view.value}
            onChange={() => props.onView(view.value)}
          />
          {view.label}
        </label>
      ))}
    </fieldset>
  );
}

/** The font, the size and weight of the text, and how wide the column of text may get. */
function ReadingSettings(props: Pick<ToolbarProps, 'prefs' | 'onPrefs' | 'fontFailed'>) {
  const { prefs, onPrefs } = props;
  const id = useId();
  const scale = fitTextScale(prefs.textScale);
  const weight = TEXT_WEIGHTS.findIndex((entry) => entry.value === fitTextWeight(prefs.textWeight));
  const changed =
    prefs.font !== DEFAULT_PREFERENCES.font ||
    scale !== DEFAULT_PREFERENCES.textScale ||
    TEXT_WEIGHTS[weight]?.value !== DEFAULT_PREFERENCES.textWeight ||
    prefs.contentWidth !== DEFAULT_PREFERENCES.contentWidth;
  return (
    <div className="settings" role="dialog" aria-label="Reading settings">
      <div className="settings-row">
        <label htmlFor={`${id}-font`}>Font</label>
        <select
          id={`${id}-font`}
          value={prefs.font}
          onChange={(event) => onPrefs({ font: event.target.value as Preferences['font'] })}
        >
          {FONTS.map((font) => (
            <option key={font.id} value={font.id}>
              {font.label}
            </option>
          ))}
          <option value="custom">Another font…</option>
        </select>
        {prefs.font === 'custom' && (
          <input
            type="text"
            value={prefs.customFont}
            placeholder="Name of a font on this computer"
            aria-label="Font name"
            spellCheck={false}
            onChange={(event) => onPrefs({ customFont: event.target.value })}
          />
        )}
        {props.fontFailed && (
          <p className="settings-note" role="alert">
            The font could not be loaded. Reload the extension, then this page.
          </p>
        )}
      </div>

      <div className="settings-row">
        <span id={`${id}-size`}>Text size</span>
        {/* biome-ignore lint/a11y/useSemanticElements: a fieldset would need a legend, and the label is the line above */}
        <div className="stepper" role="group" aria-labelledby={`${id}-size`}>
          <button
            type="button"
            aria-label="Smaller text"
            disabled={scale <= TEXT_SCALE.min}
            onClick={() => onPrefs({ textScale: scale - TEXT_SCALE.step })}
          >
            <MinusIcon />
          </button>
          <output aria-live="polite">{scale}%</output>
          <button
            type="button"
            aria-label="Larger text"
            disabled={scale >= TEXT_SCALE.max}
            onClick={() => onPrefs({ textScale: scale + TEXT_SCALE.step })}
          >
            <PlusIcon />
          </button>
        </div>
      </div>

      <div className="settings-row">
        <span id={`${id}-weight`}>Font weight</span>
        {/* biome-ignore lint/a11y/useSemanticElements: as for the text size */}
        <div className="stepper" role="group" aria-labelledby={`${id}-weight`}>
          <button
            type="button"
            aria-label="Lighter text"
            disabled={weight <= 0}
            onClick={() => onPrefs({ textWeight: TEXT_WEIGHTS[weight - 1]?.value })}
          >
            <MinusIcon />
          </button>
          <output aria-live="polite">{TEXT_WEIGHTS[weight]?.label}</output>
          <button
            type="button"
            aria-label="Heavier text"
            disabled={weight >= TEXT_WEIGHTS.length - 1}
            onClick={() => onPrefs({ textWeight: TEXT_WEIGHTS[weight + 1]?.value })}
          >
            <PlusIcon />
          </button>
        </div>
      </div>

      <div className="settings-row">
        <span id={`${id}-width`}>Content width</span>
        <div className="segmented" role="radiogroup" aria-labelledby={`${id}-width`}>
          {WIDTHS.map((width) => (
            <label
              key={width.value}
              className={prefs.contentWidth === width.value ? 'is-selected' : undefined}
            >
              <input
                type="radio"
                name={`${id}-width`}
                value={width.value}
                checked={prefs.contentWidth === width.value}
                onChange={() => onPrefs({ contentWidth: width.value })}
              />
              {width.label}
            </label>
          ))}
        </div>
      </div>

      <button
        type="button"
        className="settings-reset"
        disabled={!changed}
        onClick={() =>
          onPrefs({
            font: DEFAULT_PREFERENCES.font,
            textScale: DEFAULT_PREFERENCES.textScale,
            textWeight: DEFAULT_PREFERENCES.textWeight,
            contentWidth: DEFAULT_PREFERENCES.contentWidth,
          })
        }
      >
        Reset to defaults
      </button>
    </div>
  );
}

function SettingsButton(props: ToolbarProps & { shown: boolean }) {
  const wrapper = useRef<HTMLDivElement>(null);
  const open = props.settingsOpen && props.shown;
  const { onSettings } = props;

  // A press anywhere else closes the settings, and so does Escape, wherever the focus is: a
  // control that was just used may have lost it (the reset button, once there is nothing to reset).
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (wrapper.current && !event.composedPath().includes(wrapper.current)) onSettings(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      onSettings(false);
      const root = wrapper.current?.getRootNode() as Document | ShadowRoot | undefined;
      const focused = root?.activeElement;
      if (!focused || wrapper.current?.contains(focused))
        wrapper.current?.querySelector('button')?.focus();
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open, onSettings]);

  return (
    <div className="settings-anchor" ref={wrapper}>
      <button
        type="button"
        className="tool-button"
        title="Reading settings: font, text size and weight, width"
        aria-label="Reading settings"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => onSettings(!open)}
      >
        <span aria-hidden="true">Aa</span>
      </button>
      {open && (
        <ReadingSettings
          prefs={props.prefs}
          onPrefs={props.onPrefs}
          fontFailed={props.fontFailed}
        />
      )}
    </div>
  );
}

/**
 * The row of controls above the reading view: how changes are shown on the left; the read
 * count, the review in progress and the reading settings on the right. It is drawn twice, at
 * the top of the tab and in the pull request header that replaces it once the page is
 * scrolled, and `shown` says which of the two the reader sees.
 */
export function Toolbar(props: ToolbarProps & { placement: 'row' | 'head'; shown: boolean }) {
  const comments = useComments();
  return (
    <div className={`tools tools-${props.placement}`}>
      <ViewSwitch
        name={`openspec-diff-view-${props.placement}`}
        view={props.prefs.diffView}
        onView={(diffView) => props.onPrefs({ diffView })}
      />
      <span className="grow" />
      <ReadCount progress={props.progress} />
      {comments.reviewing && (
        <button
          type="button"
          className="button button-primary review-button"
          title={`Review in progress: ${plural(comments.pending, 'pending comment')}`}
          onClick={props.onFinishReview}
        >
          Finish review
          {comments.pending > 0 && <span className="review-count">{comments.pending}</span>}
        </button>
      )}
      <SettingsButton {...props} />
    </div>
  );
}
