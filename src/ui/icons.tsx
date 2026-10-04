import type { ReactNode } from 'react';

/** Small line icons drawn on a 16px grid, coloured by the surrounding text. */
function icon(children: ReactNode) {
  return function Icon({ size = 16, className }: { size?: number; className?: string }) {
    return (
      <svg
        className={className ? `icon ${className}` : 'icon'}
        width={size}
        height={size}
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        {children}
      </svg>
    );
  };
}

export const CheckIcon = icon(<path d="M3.5 8.5l3 3 6-7" />);
export const ChevronIcon = icon(<path d="M6 3.5l4.5 4.5L6 12.5" />);
export const CopyIcon = icon(
  <>
    <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
    <path d="M10.5 5.5v-2A1.5 1.5 0 0 0 9 2H4a1.5 1.5 0 0 0-1.5 1.5v5A1.5 1.5 0 0 0 4 10h1.5" />
  </>,
);
export const LinkIcon = icon(
  <>
    <path d="M6.6 9.4a3 3 0 0 0 4.2 0l2-2a3 3 0 0 0-4.2-4.2l-.8.8" />
    <path d="M9.4 6.6a3 3 0 0 0-4.2 0l-2 2a3 3 0 0 0 4.2 4.2l.8-.8" />
  </>,
);
export const CommentIcon = icon(<path d="M2.5 3h11v8h-6.2L4.5 13.5V11h-2z" />);
export const AlertIcon = icon(
  <>
    <path d="M8 2.2l6.2 10.8H1.8z" />
    <path d="M8 6.4v3.1M8 11.3v.1" />
  </>,
);
export const InfoIcon = icon(
  <>
    <circle cx="8" cy="8" r="6" />
    <path d="M8 7.4v3.4M8 5.1v.1" />
  </>,
);
export const StopIcon = icon(
  <>
    <circle cx="8" cy="8" r="6" />
    <path d="M5.8 5.8l4.4 4.4M10.2 5.8l-4.4 4.4" />
  </>,
);
export const CloseIcon = icon(<path d="M4 4l8 8M12 4l-8 8" />);
export const PlusIcon = icon(<path d="M8 3.5v9M3.5 8h9" />);
export const MinusIcon = icon(<path d="M3.5 8h9" />);
export const SearchIcon = icon(
  <>
    <circle cx="7" cy="7" r="4.5" />
    <path d="M10.5 10.5l3 3" />
  </>,
);
export const QuestionIcon = icon(
  <>
    <circle cx="8" cy="8" r="6" />
    <path d="M6.3 6.3a1.8 1.8 0 1 1 2.5 1.7c-.5.3-.8.7-.8 1.2v.2M8 11.5v.1" />
  </>,
);
export const FileIcon = icon(
  <>
    <path d="M4 1.8h5l3 3v9.4H4z" />
    <path d="M9 1.8v3h3" />
  </>,
);
export const ArrowIcon = icon(<path d="M3 8h10M9.5 4.5L13 8l-3.5 3.5" />);
export const ExternalIcon = icon(<path d="M9.5 3H13v3.5M13 3L7.5 8.5M11 9.5V13H3V5h3.5" />);
export const TasksIcon = icon(
  <path d="M2.5 4.2l1.3 1.3L6.3 3M8.5 4.5h5M2.5 10.2l1.3 1.3L6.3 9M8.5 10.5h5" />,
);
export const BookIcon = icon(
  <>
    <path d="M3 3.5A1.5 1.5 0 0 1 4.5 2H13v9.5H4.5A1.5 1.5 0 0 0 3 13z" />
    <path d="M3 13a1.5 1.5 0 0 0 1.5 1.5H13v-3" />
  </>,
);
export const PencilIcon = icon(
  <>
    <path d="M2.5 13.5l.9-3.4 7.6-7.6 2.5 2.5-7.6 7.6z" />
    <path d="M9.5 4l2.5 2.5" />
  </>,
);
export const SpecIcon = icon(
  <>
    <rect x="2.5" y="1.8" width="11" height="12.4" rx="1.5" />
    <path d="M5.2 5h5.6M5.2 8h5.6M5.2 11h3" />
  </>,
);
export const HomeIcon = icon(
  <>
    <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
    <path d="M5 6h6M5 9h4" />
  </>,
);
export const ZoomInIcon = icon(
  <>
    <circle cx="7" cy="7" r="4.5" />
    <path d="M10.5 10.5l3 3M5 7h4M7 5v4" />
  </>,
);
export const ZoomOutIcon = icon(
  <>
    <circle cx="7" cy="7" r="4.5" />
    <path d="M10.5 10.5l3 3M5 7h4" />
  </>,
);
export const KeyIcon = icon(
  <>
    <circle cx="5.5" cy="10.5" r="3" />
    <path d="M7.7 8.3L13.5 2.5M11 5l2 2M9.3 6.7l1.5 1.5" />
  </>,
);
export const ClockIcon = icon(
  <>
    <circle cx="8" cy="8" r="6" />
    <path d="M8 4.8V8l2.2 1.4" />
  </>,
);
export const InboxIcon = icon(
  <>
    <path d="M2 9l2-6h8l2 6v4H2z" />
    <path d="M2 9h3.5l1 2h3l1-2H14" />
  </>,
);
export const SyncIcon = icon(
  <path d="M2.5 8a5.5 5.5 0 0 1 9.6-3.6L13.5 6M13.5 2.5V6H10M13.5 8a5.5 5.5 0 0 1-9.6 3.6L2.5 10M2.5 13.5V10H6" />,
);

/** GitHub's own icons for the state of a pull request (Octicons, 16px, filled). */
function octicon(d: string) {
  return function Octicon() {
    return (
      <svg
        className="icon"
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="currentColor"
        aria-hidden="true"
        focusable="false"
      >
        <path d={d} />
      </svg>
    );
  };
}

export const PullOpenIcon = octicon(
  'M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z',
);
export const PullDraftIcon = octicon(
  'M3.25 1A2.25 2.25 0 0 1 4 5.372v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.251 2.251 0 0 1 3.25 1Zm9.5 14a2.25 2.25 0 1 1 0-4.5 2.25 2.25 0 0 1 0 4.5ZM2.5 3.25a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0ZM3.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm9.5 0a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5ZM14 7.5a1.25 1.25 0 1 1-2.5 0 1.25 1.25 0 0 1 2.5 0Zm0-4.25a1.25 1.25 0 1 1-2.5 0 1.25 1.25 0 0 1 2.5 0Z',
);
export const PullMergedIcon = octicon(
  'M5.45 5.154A4.25 4.25 0 0 0 9.25 7.5h1.378a2.251 2.251 0 1 1 0 1.5H9.25A5.734 5.734 0 0 1 5 7.123v3.505a2.25 2.25 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.95-.218ZM4.25 13.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm8.5-4.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5ZM5 3.25a.75.75 0 1 0 0 .005V3.25Z',
);
export const PullClosedIcon = octicon(
  'M3.25 1A2.25 2.25 0 0 1 4 5.372v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.251 2.251 0 0 1 3.25 1Zm9.5 5.5a.75.75 0 0 1 .75.75v3.378a2.251 2.251 0 1 1-1.5 0V7.25a.75.75 0 0 1 .75-.75Zm-2.03-5.273a.75.75 0 0 1 1.06 0l.97.97.97-.97a.748.748 0 0 1 1.265.332.75.75 0 0 1-.205.729l-.97.97.97.97a.751.751 0 0 1-.018 1.042.751.751 0 0 1-1.042.018l-.97-.97-.97.97a.749.749 0 0 1-1.275-.326.749.749 0 0 1 .215-.734l.97-.97-.97-.97a.75.75 0 0 1 0-1.06ZM2.5 3.25a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0ZM3.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm9.5 0a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z',
);
