import type { ChangeView } from '@/openspec';
import { usePull } from '../context';
import { AlertIcon, QuestionIcon } from '../icons';
import { InlineMarkdown, MarkdownProvider } from '../markdown/Markdown';
import { useMarkdownOptions } from '../markdownOptions';
import { CopyLink, ProgressBar, plural } from './common';

const STATUS: Record<ChangeView['status'], { text: string; tone: string }> = {
  'in-progress': { text: 'In progress', tone: 'attention' },
  archived: { text: 'Archived in this PR', tone: 'done' },
  'archive-edited': { text: 'Archived earlier, edited here', tone: 'neutral' },
  deleted: { text: 'Deleted without archiving', tone: 'danger' },
};

function Stat({ value, label, tone }: { value: number | string; label: string; tone?: string }) {
  return (
    <div className={`stat${tone ? ` stat-${tone}` : ''}${value === 0 ? ' is-zero' : ''}`}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

/** The card at the top of a change: what it is, where it stands, how big it is. */
export function OverviewCard({ change }: { change: ChangeView }) {
  const { goTo } = usePull();
  const status = STATUS[change.status];
  const options = useMarkdownOptions(change.proposal?.path ?? `${change.dir}/proposal.md`);
  const tasks = change.tasks?.doc;
  const doneHere =
    tasks && change.tasks?.doneAtBase != null ? tasks.done - change.tasks.doneAtBase : 0;
  const breaking = change.proposal?.doc.breaking ?? 0;
  const questions = change.design?.doc.openQuestions ?? 0;
  const lead = change.proposal?.doc.lead;

  return (
    <header className="overview" data-item={`${change.id}/overview`} data-nav="">
      <div className="overview-top">
        <span className={`pill pill-${status.tone}`}>{status.text}</span>
        {change.status === 'in-progress' && (
          <span className="pill pill-neutral">
            {change.isNew ? 'New in this PR' : 'Updated in this PR'}
          </span>
        )}
        {change.date && <span className="muted">{change.date}</span>}
        <span className="grow" />
        <code className="change-dir" title={change.dir}>
          {change.dirName}
        </code>
        <CopyLink id={`${change.id}/overview`} label="Copy link to this change" />
      </div>

      <h2>
        {change.label.ticket && <span className="ticket">{change.label.ticket}</span>}
        {change.label.title || change.label.label}
      </h2>

      {lead && (
        <MarkdownProvider options={options}>
          <p className="lead">
            <InlineMarkdown source={lead} />
          </p>
        </MarkdownProvider>
      )}

      <dl className="stats">
        <Stat value={change.counts.added} label="added" tone="added" />
        <Stat value={change.counts.modified} label="modified" tone="modified" />
        <Stat value={change.counts.removed} label="removed" tone="removed" />
        <Stat value={change.counts.renamed} label="renamed" tone="renamed" />
        <Stat
          value={change.capabilities.length}
          label={change.capabilities.length === 1 ? 'capability' : 'capabilities'}
        />
      </dl>

      {tasks && tasks.total > 0 && (
        <button type="button" className="overview-tasks" onClick={() => goTo(`${change.id}/tasks`)}>
          <ProgressBar done={tasks.done} total={tasks.total} label="Task progress" />
          <span>
            <strong>
              {tasks.done} of {tasks.total}
            </strong>{' '}
            tasks done
            {doneHere > 0 && <span className="muted"> · {doneHere} in this PR</span>}
          </span>
        </button>
      )}

      {(breaking > 0 || questions > 0 || change.problemCount > 0) && (
        <div className="flags">
          {breaking > 0 && (
            <button
              type="button"
              className="flag flag-danger"
              onClick={() => goTo(`${change.id}/proposal`)}
            >
              <AlertIcon size={14} />
              {plural(breaking, 'breaking change')}
            </button>
          )}
          {questions > 0 && (
            <button
              type="button"
              className="flag flag-attention"
              onClick={() => goTo(`${change.id}/design`)}
            >
              <QuestionIcon size={14} />
              {plural(questions, 'open question')}
            </button>
          )}
          {change.problemCount > 0 && (
            <span className="flag flag-attention">
              <AlertIcon size={14} />
              {plural(change.problemCount, 'format problem')}
            </span>
          )}
        </div>
      )}
    </header>
  );
}
