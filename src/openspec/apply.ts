import type { DeltaPlan } from './delta';
import { foldRequirementName, normalizeRequirementName, scenarioNameFromHeaderText } from './names';
import { extractPurposeSection, extractRequirementsSection, parseSpec } from './spec';
import {
  buildCodeFenceMask,
  collapseBlankRunsOutsideFences,
  normalizeBlock,
  normalizeLineEndings,
} from './text';
import type { Operation, Problem, RequirementBlock } from './types';

/** What happened to one delta entry when it was applied to the base spec. */
export interface AppliedOperation {
  op: Operation;
  /** The requirement's name after the operation (the new name for a rename). */
  name: string;
  /** The old name, for a rename. */
  from: string | null;
  /** The delta block that carries the new text (added, modified, header-form removed). */
  block: RequirementBlock | null;
  /** The block of the base spec this entry acts on, when one was found. */
  before: RequirementBlock | null;
  /** 1-based line of the entry in the delta file. */
  line: number;
  /** False when the entry could not be applied, or was a no-op. */
  applied: boolean;
  /** True when the base spec already reflects this entry (early-sync pattern). */
  alreadySynced: boolean;
  problems: Problem[];
}

export interface ApplyResult {
  /** The spec as it would read after `openspec archive`. */
  rebuilt: string;
  isNewSpec: boolean;
  counts: { added: number; modified: number; removed: number; renamed: number };
  operations: AppliedOperation[];
  /** Problems that concern the delta file as a whole. */
  problems: Problem[];
}

const PURPOSE_PLACEHOLDER_PREFIX = 'TBD - created by archiving change ';
const PURPOSE_PLACEHOLDER_SUFFIX = '. Update Purpose after archive.';

export function buildSpecSkeleton(specName: string, changeName: string, purpose?: string | null) {
  const body =
    purpose?.trim() || `${PURPOSE_PLACEHOLDER_PREFIX}${changeName}${PURPOSE_PLACEHOLDER_SUFFIX}`;
  return `# ${specName} Specification\n\n## Purpose\n${body}\n\n## Requirements\n`;
}

export function isPlaceholderPurpose(purpose: string | null): boolean {
  return Boolean(purpose?.startsWith(PURPOSE_PLACEHOLDER_PREFIX));
}

function scenarioNames(raw: string): string[] {
  const lines = normalizeLineEndings(raw).split('\n');
  const mask = buildCodeFenceMask(lines);
  const names: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (!mask[i] && /^####\s+/.test(line)) {
      names.push(scenarioNameFromHeaderText(line.replace(/^####\s+/, '')));
    }
  }
  return names;
}

/** Names in `names` not covered by `against`, counting duplicates. */
function unmatched(names: readonly string[], against: readonly string[]): string[] {
  const remaining = new Map<string, number>();
  for (const name of against) remaining.set(name, (remaining.get(name) ?? 0) + 1);
  const out: string[] = [];
  for (const name of names) {
    const left = remaining.get(name) ?? 0;
    if (left > 0) remaining.set(name, left - 1);
    else out.push(name);
  }
  return out;
}

const quote = (names: string[]) => names.map((name) => `"${name}"`).join(', ');

/**
 * Apply a delta to a base spec, the way `openspec archive` does
 * (`buildUpdatedSpec`): RENAMED, then REMOVED, then MODIFIED, then ADDED,
 * keeping the original order and appending new requirements at the end.
 *
 * Unlike the reference this never throws. Where archive would refuse, the
 * entry is skipped and a problem is recorded against it, so the reader still
 * sees everything else.
 */
export function applyDelta(
  baseContent: string | null,
  plan: DeltaPlan,
  options: { specName: string; changeName: string; deltaContent?: string },
): ApplyResult {
  const problems: Problem[] = [];
  const operations: AppliedOperation[] = [];
  const error = (code: string, message: string, line?: number): Problem => ({
    severity: 'error',
    code,
    message,
    ...(line === undefined ? {} : { line }),
  });

  for (const unpaired of plan.unpairedRenames) {
    const missing = unpaired.side === 'FROM' ? 'TO' : 'FROM';
    problems.push(
      error(
        'rename-unpaired',
        `RENAMED entry "${unpaired.name}" has no matching ${missing}: line. Write each rename as a FROM: line followed by its TO: line.`,
        unpaired.line,
      ),
    );
  }
  for (const orphan of plan.orphanedRequirements) {
    const where = orphan.section ? `under "## ${orphan.section}"` : 'above the first "## " section';
    problems.push({
      severity: 'warning',
      code: 'requirement-orphaned',
      message: `Requirement "${orphan.name}" is ${where}, which is not a delta section, so it will not be applied.`,
      line: orphan.line,
    });
  }
  for (const skipped of plan.skippedHeaders) {
    problems.push({
      severity: 'info',
      code: 'header-skipped',
      message: `"### ${skipped.header}" under "## ${skipped.section}" is not a \`### Requirement:\` header and is ignored.`,
      line: skipped.line,
    });
  }

  // One operation record per delta entry, in the order archive applies them.
  const newOp = (
    op: Operation,
    name: string,
    line: number,
    block: RequirementBlock | null,
    from: string | null = null,
  ): AppliedOperation => {
    const record: AppliedOperation = {
      op,
      name: normalizeRequirementName(name),
      from: from === null ? null : normalizeRequirementName(from),
      block,
      before: null,
      line,
      applied: false,
      alreadySynced: false,
      problems: [],
    };
    operations.push(record);
    return record;
  };

  const removedBlocks = [...plan.removedBlocks];
  const renameOps = plan.renamed.map((pair) =>
    newOp('renamed', pair.to, pair.line, null, pair.from),
  );
  const removeOps = plan.removed.map((entry) => {
    const index = removedBlocks.findIndex((block) => block.name === entry.name);
    const block = index === -1 ? null : (removedBlocks.splice(index, 1)[0] ?? null);
    return newOp('removed', entry.name, entry.line, block);
  });
  const modifyOps = plan.modified.map((block) => newOp('modified', block.name, block.line, block));
  const addOps = plan.added.map((block) => newOp('added', block.name, block.line, block));

  // Duplicates within a section: archive refuses the whole delta; we skip the repeat.
  const skip = new Set<AppliedOperation>();
  const flagDuplicates = (
    ops: AppliedOperation[],
    section: string,
    key: (op: AppliedOperation) => string,
  ) => {
    const seen = new Set<string>();
    for (const op of ops) {
      const name = key(op);
      if (seen.has(name)) {
        op.problems.push(
          error('duplicate-in-section', `"${name}" appears more than once in ${section}.`, op.line),
        );
        skip.add(op);
      }
      seen.add(name);
    }
  };
  flagDuplicates(addOps, 'ADDED', (op) => op.name);
  flagDuplicates(modifyOps, 'MODIFIED', (op) => op.name);
  flagDuplicates(removeOps, 'REMOVED', (op) => op.name);
  flagDuplicates(renameOps, 'RENAMED (FROM)', (op) => op.from ?? '');
  flagDuplicates(renameOps, 'RENAMED (TO)', (op) => op.name);

  // Cross-section conflicts.
  const names = (ops: AppliedOperation[]) => new Set(ops.map((op) => op.name));
  const addedNames = names(addOps);
  const removedNames = names(removeOps);
  const conflict = (op: AppliedOperation, other: string) => {
    op.problems.push(
      error(
        'cross-section-conflict',
        `"${op.name}" is listed in both ${op.op.toUpperCase()} and ${other}.`,
        op.line,
      ),
    );
    skip.add(op);
  };
  for (const op of modifyOps) {
    if (removedNames.has(op.name)) conflict(op, 'REMOVED');
    if (addedNames.has(op.name)) conflict(op, 'ADDED');
  }
  for (const op of addOps) {
    if (removedNames.has(op.name)) conflict(op, 'REMOVED');
  }
  for (const rename of renameOps) {
    const from = rename.from ?? '';
    const removedFold = [...removedNames].find(
      (name) => foldRequirementName(name) === foldRequirementName(from),
    );
    if (removedFold !== undefined) {
      rename.problems.push(
        error(
          'cross-section-conflict',
          `"${from}" is both renamed and removed. A requirement can only be one of the two.`,
          rename.line,
        ),
      );
      skip.add(rename);
    }
    const stale = modifyOps.find((op) => op.name === from);
    if (stale) {
      stale.problems.push(
        error(
          'modified-uses-old-name',
          `This requirement is renamed in the same delta, so MODIFIED must use the new name "${rename.name}".`,
          stale.line,
        ),
      );
      skip.add(stale);
    }
    const collision = addOps.find((op) => op.name === rename.name);
    if (collision) {
      collision.problems.push(
        error(
          'added-collides-with-rename',
          `"${rename.name}" is also the target of a rename in this delta.`,
          collision.line,
        ),
      );
      skip.add(collision);
    }
  }

  if (operations.length === 0) {
    problems.push(
      error(
        'delta-no-operations',
        'No ADDED, MODIFIED, REMOVED or RENAMED entries were found in this delta.',
      ),
    );
  }

  // Load or create the base.
  const isNewSpec = baseContent === null;
  let target = baseContent ?? '';
  if (isNewSpec) {
    const purpose = options.deltaContent ? extractPurposeSection(options.deltaContent) : null;
    target = buildSpecSkeleton(options.specName, options.changeName, purpose);
    if (purpose && (target.includes('<!--') || parseSpec(target).problems.length > 0)) {
      target = buildSpecSkeleton(options.specName, options.changeName);
    }
    for (const op of [...modifyOps, ...renameOps]) {
      op.problems.push(
        error(
          'new-spec-not-added',
          `There is no spec for "${options.specName}" yet, so only ADDED requirements are allowed.`,
          op.line,
        ),
      );
      skip.add(op);
    }
    for (const op of removeOps) {
      op.problems.push({
        severity: 'warning',
        code: 'removed-from-new-spec',
        message: `There is no spec for "${options.specName}" yet, so there is nothing to remove.`,
        line: op.line,
      });
      skip.add(op);
    }
  } else {
    for (const issue of parseSpec(target).problems) {
      if (issue.severity === 'error') {
        problems.push({ ...issue, message: `Current spec: ${issue.message}` });
      }
    }
  }

  const parts = extractRequirementsSection(target);
  const nameToBlock = new Map<string, RequirementBlock>();
  for (const block of parts.bodyBlocks)
    nameToBlock.set(normalizeRequirementName(block.name), block);
  const orderedKeys = parts.bodyBlocks.map((block) => normalizeRequirementName(block.name));
  const nearMiss = (name: string, except?: string) =>
    [...nameToBlock.keys()].find(
      (key) => key !== except && foldRequirementName(key) === foldRequirementName(name),
    );
  const spelled = (key: string) => nameToBlock.get(key)?.name ?? key;

  const counts = { added: 0, modified: 0, removed: 0, renamed: 0 };

  // RENAMED
  for (const op of renameOps) {
    if (skip.has(op)) continue;
    const from = op.from ?? '';
    const to = op.name;
    const source = nameToBlock.get(from);
    if (!source) {
      if (nameToBlock.has(to)) {
        const miss = nearMiss(from, to);
        if (miss !== undefined) {
          op.before = nameToBlock.get(miss) ?? null;
          op.problems.push(
            error(
              'rename-near-miss',
              `"${from}" was not found, but "${spelled(miss)}" exists. Requirement names match exactly: fix the FROM header.`,
              op.line,
            ),
          );
          continue;
        }
        op.alreadySynced = true;
        op.problems.push({
          severity: 'info',
          code: 'already-synced',
          message: `The current spec already uses the name "${to}".`,
          line: op.line,
        });
        continue;
      }
      const miss = nearMiss(from);
      if (miss !== undefined) op.before = nameToBlock.get(miss) ?? null;
      op.problems.push(
        error(
          'rename-source-missing',
          miss === undefined
            ? `"${from}" is not in the current spec, so there is nothing to rename.`
            : `"${from}" was not found, but "${spelled(miss)}" exists. Requirement names match exactly: fix the FROM header.`,
          op.line,
        ),
      );
      continue;
    }
    op.before = source;
    if (nameToBlock.has(to)) {
      op.problems.push(
        error('rename-target-exists', `"${to}" already exists in the current spec.`, op.line),
      );
      continue;
    }
    const targetMiss = nearMiss(to, from);
    if (targetMiss !== undefined) {
      op.problems.push(
        error(
          'rename-target-near-miss',
          `"${spelled(targetMiss)}" already exists and differs only in case or spacing. Choose a distinct name.`,
          op.line,
        ),
      );
      continue;
    }
    const header = `### Requirement: ${to}`;
    const rawLines = source.raw.split('\n');
    rawLines[0] = header;
    nameToBlock.delete(from);
    nameToBlock.set(to, {
      headerLine: header,
      name: to,
      raw: rawLines.join('\n'),
      line: source.line,
    });
    const orderIndex = orderedKeys.indexOf(from);
    if (orderIndex >= 0) orderedKeys[orderIndex] = to;
    op.applied = true;
    counts.renamed++;
  }

  // REMOVED
  for (const op of removeOps) {
    if (skip.has(op)) continue;
    const current = nameToBlock.get(op.name);
    if (!current) {
      const miss = nearMiss(op.name);
      if (miss !== undefined) {
        op.before = nameToBlock.get(miss) ?? null;
        op.problems.push(
          error(
            'removed-near-miss',
            `"${op.name}" was not found, but "${spelled(miss)}" exists. Requirement names match exactly: fix the header.`,
            op.line,
          ),
        );
        continue;
      }
      op.alreadySynced = true;
      op.problems.push({
        severity: 'warning',
        code: 'removed-not-found',
        message: `"${op.name}" is not in the current spec; archive treats it as already removed.`,
        line: op.line,
      });
      continue;
    }
    op.before = current;
    nameToBlock.delete(op.name);
    op.applied = true;
    counts.removed++;
  }

  // MODIFIED
  for (const op of modifyOps) {
    if (skip.has(op) || !op.block) continue;
    const current = nameToBlock.get(op.name);
    if (!current) {
      const miss = nearMiss(op.name);
      if (miss !== undefined) {
        op.before = nameToBlock.get(miss) ?? null;
        op.problems.push(
          error(
            'modified-near-miss',
            `The header differs from the current spec's "${spelled(miss)}" only in case or spacing. Archive matches names exactly, so this will not merge.`,
            op.line,
          ),
        );
      } else {
        op.problems.push(
          error(
            'modified-no-match',
            `"${op.name}" is not in the current spec, so there is nothing to modify. Use ADDED for a new requirement.`,
            op.line,
          ),
        );
      }
      continue;
    }
    op.before = current;
    const missing = unmatched(scenarioNames(current.raw), scenarioNames(op.block.raw));
    if (missing.length > 0) {
      op.problems.push({
        severity: 'warning',
        code: 'modified-drops-scenarios',
        message: `The modified block leaves out ${missing.length === 1 ? 'a scenario' : 'scenarios'} the current spec has: ${quote(missing)}. \`openspec archive\` refuses to drop scenarios this way.`,
        line: op.line,
      });
    }
    if (normalizeBlock(current.raw) === normalizeBlock(op.block.raw)) {
      op.alreadySynced = true;
      op.problems.push({
        severity: 'info',
        code: 'already-synced',
        message: 'The current spec already has this text.',
        line: op.line,
      });
    } else {
      counts.modified++;
    }
    nameToBlock.set(op.name, op.block);
    op.applied = true;
  }

  // ADDED
  for (const op of addOps) {
    if (skip.has(op) || !op.block) continue;
    const existing = nameToBlock.get(op.name);
    if (existing) {
      op.before = existing;
      if (normalizeBlock(existing.raw) === normalizeBlock(op.block.raw)) {
        op.alreadySynced = true;
        op.problems.push({
          severity: 'info',
          code: 'already-synced',
          message: 'The current spec already has this requirement.',
          line: op.line,
        });
        continue;
      }
      op.problems.push(
        error(
          'added-exists',
          `"${op.name}" already exists in the current spec. Use MODIFIED to change it.`,
          op.line,
        ),
      );
      continue;
    }
    const miss = nearMiss(op.name);
    if (miss !== undefined) {
      op.before = nameToBlock.get(miss) ?? null;
      op.problems.push(
        error(
          'added-near-miss',
          `"${spelled(miss)}" already exists and differs only in case or spacing. Use MODIFIED with that exact header, or choose a distinct name.`,
          op.line,
        ),
      );
      continue;
    }
    nameToBlock.set(op.name, op.block);
    op.applied = true;
    counts.added++;
  }

  // Recompose, keeping the original order and appending what is new.
  const kept: RequirementBlock[] = [];
  const seen = new Set<string>();
  for (const key of orderedKeys) {
    const block = nameToBlock.get(key);
    if (block) {
      kept.push(block);
      seen.add(key);
    }
  }
  for (const [key, block] of nameToBlock) {
    if (!seen.has(key)) kept.push(block);
  }

  const body = [parts.preamble.trim() ? parts.preamble.trimEnd() : '']
    .filter(Boolean)
    .concat(kept.map((block) => block.raw))
    .join('\n\n')
    .trimEnd();
  const rebuilt = `${collapseBlankRunsOutsideFences(
    [parts.before.trimEnd(), parts.headerLine, body, parts.after.trim()]
      .filter((slice) => slice !== '')
      .join('\n\n'),
  ).trimEnd()}\n`;

  return { rebuilt, isNewSpec, counts, operations, problems };
}
