import type { Operation, PrModel } from '@/openspec';

export interface OutlineItem {
  id: string;
  label: string;
  depth: 0 | 1 | 2;
  /** Change type, for the coloured dot of a requirement. */
  op?: Operation;
  /** Present on items that can be marked as read. */
  hash?: string;
  meta?: string;
  icon?: 'proposal' | 'design' | 'spec' | 'tasks' | 'change' | 'files';
}

/** The outline of the tab, in reading order. */
export function buildOutline(model: PrModel): OutlineItem[] {
  const items: OutlineItem[] = [];
  for (const change of model.changes) {
    items.push({
      id: `${change.id}/overview`,
      label: change.label.label,
      depth: 0,
      icon: 'change',
    });
    if (change.proposal) {
      items.push({
        id: change.proposal.id,
        label: 'Proposal',
        depth: 1,
        hash: change.proposal.hash,
        icon: 'proposal',
      });
    }
    if (change.design) {
      items.push({
        id: change.design.id,
        label: 'Design',
        depth: 1,
        hash: change.design.hash,
        icon: 'design',
      });
    }
    for (const capability of change.capabilities) {
      items.push({
        id: capability.id,
        label: capability.label,
        depth: 1,
        icon: 'spec',
        meta: capability.changes.length > 0 ? String(capability.changes.length) : undefined,
      });
      for (const entry of capability.changes) {
        items.push({
          id: entry.id,
          label: entry.name,
          depth: 2,
          op: entry.op,
          ...(capability.historical ? {} : { hash: entry.hash }),
        });
      }
    }
    if (change.tasks) {
      items.push({
        id: change.tasks.id,
        label: 'Tasks',
        depth: 1,
        hash: change.tasks.hash,
        icon: 'tasks',
        meta: `${change.tasks.doc.done}/${change.tasks.doc.total}`,
      });
    }
  }
  if (model.directEdits.length > 0) {
    items.push({ id: 'specs', label: 'Specs edited directly', depth: 0, icon: 'change' });
    for (const capability of model.directEdits) {
      items.push({
        id: capability.id,
        label: capability.label,
        depth: 1,
        icon: 'spec',
        meta: capability.changes.length > 0 ? String(capability.changes.length) : undefined,
      });
      for (const entry of capability.changes) {
        items.push({ id: entry.id, label: entry.name, depth: 2, op: entry.op, hash: entry.hash });
      }
    }
  }
  if (model.otherFiles.length > 0) {
    items.push({
      id: 'files',
      label: 'Other files',
      depth: 0,
      icon: 'files',
      meta: String(model.otherFiles.length),
    });
  }
  return items;
}

/** Keep items that match the filter, together with the headings they sit under. */
export function filterOutline(items: readonly OutlineItem[], query: string): OutlineItem[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...items];
  const keep = new Set<number>();
  items.forEach((item, index) => {
    if (!item.label.toLowerCase().includes(needle) && !(item.op ?? '').includes(needle)) return;
    keep.add(index);
    let depth = item.depth;
    for (let i = index - 1; i >= 0 && depth > 0; i--) {
      const parent = items[i];
      if (parent && parent.depth < depth) {
        keep.add(i);
        depth = parent.depth;
      }
    }
  });
  return items.filter((_, index) => keep.has(index));
}
