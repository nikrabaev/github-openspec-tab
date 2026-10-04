import { type ReactNode, useId, useRef, useState } from 'react';
import type { GlossaryTerm } from '@/openspec';
import { InlineMarkdown, MarkdownProvider } from './Markdown';

/** A glossary term: underlined in the text, with its definition on hover or focus. */
export function Term(props: { term: GlossaryTerm; avoided: boolean; children: ReactNode }) {
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [alignRight, setAlignRight] = useState(false);

  const show = () => {
    const rect = ref.current?.getBoundingClientRect();
    if (rect) setAlignRight(rect.left + 300 > window.innerWidth);
    setOpen(true);
  };
  const hide = () => setOpen(false);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: hover and focus only reveal the definition
    <span
      ref={ref}
      className={props.avoided ? 'term term-avoided' : 'term'}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: the definition must be reachable from the keyboard
      tabIndex={0}
      aria-describedby={open ? id : undefined}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      onKeyDown={(event) => {
        if (event.key === 'Escape') hide();
      }}
    >
      {props.children}
      {open && (
        <span id={id} role="tooltip" className={alignRight ? 'term-tip is-right' : 'term-tip'}>
          {props.avoided && (
            <span className="term-tip-avoid">
              The glossary prefers <strong>{props.term.term}</strong>
            </span>
          )}
          <strong className="term-tip-name">{props.term.term}</strong>
          {/* The definition is plain: no terms inside terms. */}
          <MarkdownProvider options={{}}>
            <span className="term-tip-body">
              <InlineMarkdown source={props.term.definition} />
            </span>
          </MarkdownProvider>
        </span>
      )}
    </span>
  );
}
