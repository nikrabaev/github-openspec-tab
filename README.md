<div align="center">

<img src="public/icon/128.png" width="88" height="88" alt="">

# OpenSpec Tab for GitHub

**Review [OpenSpec](https://github.com/Fission-AI/OpenSpec) changes as requirements and scenarios, right inside the pull request.**

A browser extension that adds an **OpenSpec** tab to every GitHub pull request, next to "Files changed".

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Manifest V3](https://img.shields.io/badge/manifest-v3-4c8bf5.svg)
![OpenSpec 1.14](https://img.shields.io/badge/OpenSpec-1.14-2da44e.svg)

</div>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/readme/hero-dark.png">
  <img src="docs/readme/hero-light.png" alt="The OpenSpec tab on a pull request: an outline on the left, and the overview of a change with its status, counts and task progress">
</picture>

<table>
  <tr>
    <td width="50%"><img src="docs/readme/modified-inline-light.png" alt="A modified requirement with removed words struck and added words highlighted"></td>
    <td width="50%"><img src="docs/readme/modified-split-light.png" alt="The same requirement shown side by side, old against new"></td>
  </tr>
  <tr>
    <td align="center"><sub>What changed in a requirement, word by word</sub></td>
    <td align="center"><sub>Or side by side, aligned step by step</sub></td>
  </tr>
</table>

<sub>All pictures show made-up data from the fixtures in this repository.</sub>

## Why

Reviewing an OpenSpec change on GitHub means reading raw Markdown diffs:

- You click "Display the rich diff" on every file, one at a time.
- A `MODIFIED` requirement is a full replacement, so the diff shows it as all new. You cannot see what actually changed.
- There is no side-by-side view of rendered Markdown.

This tab reads the same files and shows them the way a reviewer thinks about them: what is the change, which requirements does it add, modify, remove or rename, and what exactly is different.

## What you get

- **An overview of each change:** a readable name, whether it is in progress or archived in this pull request, how many requirements it adds, modifies, removes and renames, task progress, and the first paragraph of "Why".
- **Modified requirements, three ways:** word-level changes on the rendered text, side by side, or the new version only. Scenarios that were added, removed or changed are marked.
- **Requirement cards:** a coloured label for the change type, SHALL / MUST / SHOULD / MAY styled so obligations stand out, a link you can copy, and "Comment", which opens the changed line in "Files changed".
- **Scenarios as compact rows:** WHEN, THEN and AND in a keyword column, each scenario folded under its name.
- **Removed and renamed requirements:** removed text is dimmed, with Reason and Migration as callouts. Renames show "old → new".
- **Context without noise:** requirements the change does not touch fold into "N unchanged requirements".
- **A structured proposal and design:** capability names jump to their spec, file paths link to the files, breaking changes are flagged, decisions are cards with their alternatives folded, risks sit beside their mitigations, and open questions are called out.
- **Diagrams:** `*.excalidraw.svg` files in the change folder are shown inline, with zoom.
- **Tasks:** progress overall and per group, with the next unchecked task highlighted.
- **Review progress:** "Mark as read" on each section and requirement, remembered per pull request. If the author pushes a change to something you marked, it is flagged as changed since you read it.
- **Glossary on hover:** if the repository has `docs/CONTEXT.md` (or `CONTEXT.md`), its terms are underlined and show their definition. Words the glossary says to avoid are underlined differently.
- **Format problems, inline:** a requirement with no scenario, a `MODIFIED` requirement that matches nothing in the base spec, a `FROM:` without a `TO:`. A file that cannot be read as OpenSpec is shown as plain rendered Markdown.
- **A sticky outline** with a filter and keyboard navigation.
- **GitHub's own look:** the tab uses GitHub's colours, so it follows the light, dark and dimmed themes.

<table>
  <tr>
    <td width="50%"><img src="docs/readme/design-light.png" alt="The design section: goals beside non-goals, and decisions as cards"></td>
    <td width="50%"><img src="docs/readme/tasks-light.png" alt="Tasks with a progress bar per group and the next task highlighted"></td>
  </tr>
  <tr>
    <td align="center"><sub>The design: goals beside non-goals, decisions as cards</sub></td>
    <td align="center"><sub>Tasks, with the next one highlighted</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/readme/overview-light.png" alt="The overview card of a change"></td>
    <td width="50%"><img src="docs/readme/modified-inline-dark.png" alt="A modified requirement in GitHub's dark theme"></td>
  </tr>
  <tr>
    <td align="center"><sub>The overview of a change</sub></td>
    <td align="center"><sub>In GitHub's dark theme</sub></td>
  </tr>
</table>

## Install

The extension is not in the browser stores yet. Build it and load it unpacked. You need [Node.js](https://nodejs.org) 22 or later and [pnpm](https://pnpm.io).

```bash
git clone https://github.com/nikrabaev/github-openspec-tab.git
cd github-openspec-tab
pnpm install
pnpm build
```

**Chrome, Edge, Brave, Arc**

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Choose **Load unpacked** and pick the `.output/chrome-mv3` folder.

**Firefox**

Run `pnpm build:firefox`, open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on** and pick `.output/firefox-mv2/manifest.json`. The Firefox build compiles but has not been tested yet.

Then open any pull request on github.com and choose the **OpenSpec** tab.

## Private repositories

Public repositories work with no setup. For a private repository the tab needs a read-only token, because it asks GitHub's API which OpenSpec files the pull request changes.

1. Open [GitHub → Settings → Developer settings → Fine-grained tokens → Generate new token](https://github.com/settings/personal-access-tokens/new).
2. **Resource owner:** the user or organisation that owns the repositories. **Repository access:** the repositories you review.
3. **Repository permissions:** set **Contents** and **Pull requests** to **Read-only**. Nothing else.
4. Generate the token. An organisation may have to approve it first.
5. Open the extension's settings (the **Add a token** button in the tab, or the extension's "Options") and paste it.

Without a token the tab still shows up on a private repository and tells you one is needed.

## Keyboard

| Key | Action |
| --- | --- |
| `j` / `k` | Next / previous section or requirement |
| `m` | Mark the current one as read |
| `1` `2` `3` | Inline, side by side, new only |
| `/` | Filter the outline |
| `?` | Help |

## What counts as a change

| In the pull request | Shown as | Before | After |
| --- | --- | --- | --- |
| A change folder under `openspec/changes/` | In progress | The spec on the base branch | The base spec with the deltas applied |
| A change moved to `openspec/changes/archive/` | Archived in this PR | The spec on the base branch | What the change's deltas produce |
| A spec edited with no change folder | Specs edited directly | The spec on the base branch | The spec on the PR branch |

Several changes in one pull request are shown one after another. Changes archived in the same pull request are applied in date order, so a later one is compared with the result of the earlier one. Anything in a spec that the changes do not account for appears under "Specs edited directly".

The number on the tab is the count of requirement changes. A pull request with no OpenSpec files shows 0 and an empty state.

## How it works

**Adding the tab.** GitHub serves two pull request tab bars, a React one and the classic one. Both are found by their accessible names, and the new tab is a clone of a native tab, so it looks right in either. The tab is re-added after GitHub's soft navigations and re-renders. While it is open, the native tab content is hidden, not removed.

**The URL.** The tab lives in the hash: `…/pull/123#openspec`, or `#openspec/<change>/<section>` for a link to one requirement. A hash is never sent to GitHub, so reload, back/forward and shared links work.

**Reading the pull request.** Four small API calls: the pull request, its merge base, and the `openspec/` tree at the merge base and at the head. Changed files are found by comparing the two trees, so a pull request with hundreds of other files costs the same as a small one. File contents are then read from github.com with your signed-in session, falling back to the API.

**OpenSpec rules.** The parsers follow the reference implementation in `@fission-ai/openspec` 1.14: delta section headers are case-insensitive and may repeat, lines inside code fences are ignored, and requirement names match exactly. A name that differs only in case or spacing is treated as a mistake and flagged, as the CLI does. A contract test runs the real CLI on the fixtures and compares results.

## Permissions and privacy

| Permission | Why |
| --- | --- |
| `https://github.com/*` | Add the tab and read files with your session |
| `https://api.github.com/*` | Ask which OpenSpec files a pull request changes |
| `storage` | Keep the token, your review progress and your view preference |

The token is kept in the browser's extension storage. Only the extension's background worker reads it, and it attaches it only to requests to api.github.com that are on the tab's short allowlist. It is never put in a URL, never logged and never given to a web page. Nothing is sent anywhere except GitHub.

Markdown from the repository is rendered without raw HTML: any HTML in a spec is shown as text, and only `http`, `https` and `mailto` links are followed.

## Limits

- Only github.com, not GitHub Enterprise Server.
- The OpenSpec folder must be `openspec/` at the repository root.
- Without a token GitHub allows 60 API requests an hour per network address. A pull request view uses four, and repositories with no `openspec/` folder use none.
- The tab relies on GitHub's page structure, which GitHub can change. `scripts/smoke.ts` checks it against the live site.

## Development

```bash
pnpm dev          # run the extension with live reload
pnpm build        # production build in .output/chrome-mv3
pnpm zip          # zip for the store
pnpm test         # unit tests and the contract test against the real OpenSpec CLI
pnpm lint         # Biome
pnpm typecheck    # TypeScript
pnpm harness      # the tab on a plain page with fixture data, at http://localhost:5199
pnpm screenshots  # every view in light and dark, into docs/screenshots
```

`pnpm screenshots` needs Playwright's browser once: `pnpm exec playwright install chromium`.

To check the built extension against the live site:

```bash
pnpm build && pnpm exec tsx scripts/smoke.ts https://github.com/Fission-AI/OpenSpec/pull/2012
```

| Path | What |
| --- | --- |
| `src/openspec/` | Parsers, delta application and the pull request model. No browser APIs. |
| `src/diff/` | Word-level diff and scenario and step alignment. |
| `src/github/` | URL scheme, API access, the loader, tab injection. |
| `src/ui/` | The React view and its stylesheet. |
| `src/entrypoints/` | Background worker, content script, settings page. |
| `harness/` | The dev harness page. |
| `fixtures/` | Synthetic OpenSpec repositories used by tests, harness and screenshots. |

Everything under `fixtures/` is invented (a bike-share service). Please keep it that way: do not add content from real private repositories.

## License

[MIT](LICENSE)
