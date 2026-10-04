import type { DocView, TasksDoc } from '@/openspec';
import { CheckIcon, TasksIcon } from '../icons';
import { InlineMarkdown, MarkdownProvider } from '../markdown/Markdown';
import { useMarkdownOptions } from '../markdownOptions';
import { ProgressBar, Section } from './common';

/** tasks.md: progress overall and per group, and where work continues. */
export function TasksSection({
  doc,
  doneAtBase,
}: {
  doc: DocView<TasksDoc>;
  doneAtBase: number | null;
}) {
  const options = useMarkdownOptions(doc.path, { pathChips: true });
  const tasks = doc.doc;
  const doneHere = doneAtBase === null ? 0 : tasks.done - doneAtBase;
  return (
    <Section
      id={doc.id}
      title="Tasks"
      icon={<TasksIcon />}
      hash={doc.hash}
      meta={
        <span className="muted">
          {tasks.done} of {tasks.total} done
          {doneHere > 0 && ` · ${doneHere} in this PR`}
        </span>
      }
    >
      <MarkdownProvider options={options}>
        {tasks.total === 0 ? (
          <p className="muted">No tasks yet.</p>
        ) : (
          <div className="tasks">
            <ProgressBar done={tasks.done} total={tasks.total} label="Overall task progress" />
            <div className="task-groups">
              {tasks.groups.map((group) => (
                <div key={`${group.line}:${group.title}`} className="task-group">
                  {(group.title || tasks.groups.length > 1) && (
                    <div className="task-group-head">
                      <h4>
                        {group.number && <span className="task-number">{group.number}</span>}
                        <span>
                          {group.title ? <InlineMarkdown source={group.title} /> : 'Other tasks'}
                        </span>
                      </h4>
                      <span className="muted">
                        {group.done}/{group.total}
                      </span>
                      <ProgressBar
                        done={group.done}
                        total={group.total}
                        label={`Progress of ${group.title || 'group'}`}
                      />
                    </div>
                  )}
                  <ul>
                    {group.tasks.map((task) => {
                      const next = task === tasks.next;
                      return (
                        <li
                          key={task.line}
                          className={`task${task.done ? ' is-done' : ''}${next ? ' is-next' : ''}`}
                          style={{ paddingInlineStart: `${8 + task.depth * 20}px` }}
                        >
                          <span
                            className={task.done ? 'md-check is-checked' : 'md-check'}
                            role="img"
                            aria-label={task.done ? 'Done' : 'Not done'}
                          >
                            {task.done && <CheckIcon size={12} />}
                          </span>
                          {task.number && <span className="task-number">{task.number}</span>}
                          <span className="task-text">
                            <InlineMarkdown source={task.text} />
                          </span>
                          {next && <span className="tag tag-next">Next</span>}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        )}
      </MarkdownProvider>
    </Section>
  );
}
