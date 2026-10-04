import { buildCodeFenceMask, splitLines, stripClosingHashes } from './text';

/**
 * A Markdown task line, as the reference reads it (`utils/task-progress.ts`):
 * any list marker, a checkbox holding at most one marker character, and only
 * `x` / `X` meaning done. Link bullets such as `- [A](url)` are not tasks.
 */
const TASK_LINE = /^(\s*)(?:[-*+]|\d{1,9}[.)])\s*\[(?:\s*([^\]\s]?)\s*\](?![([])|\s+\])\s*(.*)/;

export interface Task {
  done: boolean;
  /** Task number as written, e.g. `1.2`. */
  number: string | null;
  /** Inline Markdown of the task, without checkbox and number. */
  text: string;
  /** Nesting depth; 0 for a top-level task. */
  depth: number;
  /** 1-based line in tasks.md. */
  line: number;
}

export interface TaskGroup {
  /** Group number as written, e.g. `1`. */
  number: string | null;
  title: string;
  tasks: Task[];
  done: number;
  total: number;
  /** 1-based line of the group heading, or 0 for tasks above the first heading. */
  line: number;
}

export interface TasksDoc {
  groups: TaskGroup[];
  done: number;
  total: number;
  /** The first task that is not done: where work continues. */
  next: Task | null;
}

/** Read `tasks.md` into numbered groups of checkbox tasks. */
export function parseTasks(content: string): TasksDoc {
  const lines = splitLines(content);
  const mask = buildCodeFenceMask(lines);
  const groups: TaskGroup[] = [];
  let current: TaskGroup | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const heading = mask[i] ? null : /^##\s+(.+)$/.exec(line);
    if (heading?.[1]) {
      const title = stripClosingHashes(heading[1]).trim();
      const numbered = /^(\d+(?:\.\d+)*)[.)]?\s+(.*)$/.exec(title);
      current = {
        number: numbered?.[1] ?? null,
        title: numbered?.[2] ?? title,
        tasks: [],
        done: 0,
        total: 0,
        line: i + 1,
      };
      groups.push(current);
      continue;
    }
    // Every matching line counts, wherever it sits: the reference does not skip fences.
    const match = TASK_LINE.exec(line);
    if (!match) continue;
    if (!current) {
      current = { number: null, title: '', tasks: [], done: 0, total: 0, line: 0 };
      groups.push(current);
    }
    const body = (match[3] ?? '').trim();
    const numbered = /^(\d+(?:\.\d+)+|\d+)[.)]?\s+(.*)$/.exec(body);
    const task: Task = {
      done: (match[2] ?? '').toLowerCase() === 'x',
      number: numbered?.[1] ?? null,
      text: numbered?.[2] ?? body,
      depth: Math.floor((match[1] ?? '').replace(/\t/g, '  ').length / 2),
      line: i + 1,
    };
    current.tasks.push(task);
    current.total++;
    if (task.done) current.done++;
  }

  const all = groups.flatMap((group) => group.tasks);
  return {
    groups: groups.filter((group) => group.total > 0 || group.title),
    done: all.filter((task) => task.done).length,
    total: all.length,
    next: all.find((task) => !task.done) ?? null,
  };
}
