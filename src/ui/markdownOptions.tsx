import { type ReactNode, useMemo } from 'react';
import { blobUrl, searchPathUrl } from '@/github/route';
import { usePull } from './context';
import { FileIcon, SpecIcon } from './icons';
import type { MarkdownOptions } from './markdown/Markdown';

/** Resolve a relative Markdown link against the directory of the file it is written in. */
export function resolveRepoPath(fromFile: string, target: string): string | null {
  const [path = ''] = target.split(/[?#]/);
  if (!path) return null;
  const segments = path.startsWith('/') ? [] : fromFile.split('/').slice(0, -1);
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (segments.length === 0) return null;
      segments.pop();
    } else {
      segments.push(segment);
    }
  }
  return segments.join('/');
}

/** `services/unlock/src/handler.ts` looks like a path; `POST /v2/unlocks` and `group_ride_id` do not. */
export function looksLikePath(value: string): boolean {
  if (/\s|[<>{}*|"']|^https?:|^\/|^@/.test(value)) return false;
  return /^(?:\.{1,2}\/)?[\w.\-[\]()+]+(?:\/[\w.\-[\]()+@]+)+\/?$/.test(value);
}

/**
 * Markdown options for a document of the pull request: relative links go to
 * the file at the head commit, glossary terms are underlined, and code spans
 * that name a file or a capability become chips.
 */
export function useMarkdownOptions(
  filePath: string,
  extra: {
    keywords?: boolean;
    capabilities?: ReadonlyMap<string, string>;
    pathChips?: boolean;
  } = {},
): MarkdownOptions {
  const { data, glossary, goTo } = usePull();
  const { keywords, capabilities, pathChips } = extra;
  return useMemo(
    () => ({
      keywords: Boolean(keywords),
      glossary,
      resolveLink(url: string) {
        if (url.startsWith('#')) return null;
        const path = resolveRepoPath(filePath, url);
        return path ? blobUrl(data.pull, data.facts.headSha, path) : null;
      },
      renderCode(value: string): ReactNode | null {
        const target = capabilities?.get(value);
        if (target) {
          return (
            <button type="button" className="chip chip-capability" onClick={() => goTo(target)}>
              <SpecIcon size={12} />
              {value}
            </button>
          );
        }
        if (pathChips && looksLikePath(value)) {
          return (
            <a
              className="chip chip-path"
              href={searchPathUrl(data.pull, data.facts.headSha, value)}
            >
              <FileIcon size={12} />
              {value}
            </a>
          );
        }
        return null;
      },
    }),
    [filePath, keywords, capabilities, pathChips, data, glossary, goTo],
  );
}
