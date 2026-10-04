import { useEffect, useRef, useState } from 'react';
import type { BranchFacts, PullFacts } from '@/github/load';
import { type PullRef, treeUrl, userUrl } from '@/github/route';
import { plural } from '@/openspec/text';
import { CopyIcon, PullClosedIcon, PullDraftIcon, PullMergedIcon, PullOpenIcon } from '../icons';
import { CopyButton } from './common';
import { Toolbar, type ToolbarProps } from './Toolbar';

const STATES = {
  open: { label: 'Open', Icon: PullOpenIcon },
  draft: { label: 'Draft', Icon: PullDraftIcon },
  merged: { label: 'Merged', Icon: PullMergedIcon },
  closed: { label: 'Closed', Icon: PullClosedIcon },
};

function Branch({ branch, head }: { branch: BranchFacts; head?: boolean }) {
  const className = head ? 'pull-branch pull-branch-head' : 'pull-branch';
  return branch.repo ? (
    <a className={className} href={treeUrl(branch.repo, branch.ref)}>
      {branch.label}
    </a>
  ) : (
    <span className={className}>{branch.label}</span>
  );
}

/**
 * The toolbar at the top of the tab, and the compact pull request header GitHub
 * fixes to the top of the window once the tab bar has scrolled out of sight:
 * state, title, who merges what into where. As on GitHub's "Files changed", the
 * toolbar becomes part of that header. The tab draws its own header: GitHub's
 * is part of the page the tab replaces, and not every page has one.
 */
export function PullHeader(props: { pull: PullRef; facts: PullFacts; toolbar: ToolbarProps }) {
  const { pull, facts, toolbar } = props;
  const marker = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const element = marker.current;
    if (!element || typeof IntersectionObserver === 'undefined') return;
    // The marker is where the tab starts. Out of view above the window means the tab bar is too.
    const observer = new IntersectionObserver(([entry]) => {
      if (entry) setStuck(!entry.isIntersecting && entry.boundingClientRect.top < 0);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const state = facts.state === 'open' && facts.draft ? 'draft' : facts.state;
  const { label, Icon } = STATES[state];
  const merged = facts.state === 'merged';
  const who = (merged && facts.mergedBy) || facts.author;
  return (
    <>
      <div className="pull-head-marker" ref={marker} />
      <Toolbar {...toolbar} placement="row" shown={!stuck} />
      <header className="pull-head" hidden={!stuck}>
        <div className="pull-head-content">
          <span className={`pull-state pull-state-${state}`}>
            <Icon />
            {label}
          </span>
          <div className="pull-head-text">
            <div className="pull-head-title">
              <button
                type="button"
                title="Back to the top of the page"
                onClick={() => window.scrollTo({ top: 0 })}
              >
                {facts.title}
              </button>
              <span>#{pull.number}</span>
            </div>
            <div className="pull-head-summary">
              <a className="pull-author" href={userUrl(who)}>
                {who}
              </a>
              <span>
                {merged ? 'merged' : 'wants to merge'} {plural(facts.commits, 'commit')} into
              </span>
              <Branch branch={facts.base} />
              <span>from</span>
              <Branch branch={facts.head} head />
              <CopyButton
                text={facts.head.ref}
                label="Copy head branch name"
                done="Branch name copied"
                icon={<CopyIcon />}
              />
            </div>
          </div>
          <Toolbar {...toolbar} placement="head" shown={stuck} />
        </div>
      </header>
    </>
  );
}
