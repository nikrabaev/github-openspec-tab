import { stripClosingHashes } from './text';

/**
 * The name a requirement is matched by. Matching is exact and case-sensitive,
 * as in the reference implementation: only a closing `#` run and surrounding
 * whitespace are dropped.
 */
export function normalizeRequirementName(name: string): string {
  return stripClosingHashes(name).trim();
}

/**
 * Case- and whitespace-insensitive fold of a requirement name. The reference
 * uses this only to detect near-misses (two spellings that differ in case or
 * interior spacing are a typo, never two requirements); so do we.
 */
export function foldRequirementName(name: string): string {
  return normalizeRequirementName(name).toLowerCase().replace(/\s+/g, ' ');
}

/** The label of a `####` header: closing hashes and a `Scenario:` prefix removed. */
export function scenarioNameFromHeaderText(headerText: string): string {
  return stripClosingHashes(headerText)
    .replace(/^Scenario:\s*/i, '')
    .trim();
}

export function slugify(text: string): string {
  const slug = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'item';
}

const ARCHIVE_DATE_PREFIX = /^(\d{4}-\d{2}-\d{2})-(.+)$/;

/** Split an archive directory name into its date and the change name. */
export function splitArchiveName(dirName: string): { date: string | null; name: string } {
  const match = ARCHIVE_DATE_PREFIX.exec(dirName);
  if (match?.[1] && match[2]) return { date: match[1], name: match[2] };
  return { date: null, name: dirName };
}

export interface ReadableName {
  /** Ticket key when the name starts with one, e.g. `SPN-353`. */
  ticket: string | null;
  /** The rest of the name in sentence case, e.g. `Transport journeys`. */
  title: string;
  /** `SPN-353 · Transport journeys`. */
  label: string;
}

const TICKET_PREFIX = /^([a-z][a-z0-9]{1,9})-(\d{1,7})(?:-(.+))?$/i;

function sentenceCase(words: string): string {
  const text = words.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

/** `spn-353-transport-journeys` → `SPN-353 · Transport journeys`. */
export function humanizeChangeName(dirName: string): ReadableName {
  const { name } = splitArchiveName(dirName);
  const match = TICKET_PREFIX.exec(name);
  if (match?.[1] && match[2]) {
    const ticket = `${match[1].toUpperCase()}-${match[2]}`;
    const title = sentenceCase(match[3] ?? '');
    return { ticket, title, label: title ? `${ticket} · ${title}` : ticket };
  }
  const title = sentenceCase(name);
  return { ticket: null, title, label: title };
}

/** `ride-unlock` → `Ride unlock`; nested ids keep their path: `billing/refunds` → `Billing / Refunds`. */
export function humanizeCapability(id: string): string {
  return id
    .split('/')
    .map((segment) => sentenceCase(segment))
    .join(' / ');
}
