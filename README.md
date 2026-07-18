# PROMPT-HISTORY VS Code Extension

Lightweight VS Code extension for prompt history features by Gabriele Quaranta.

## Prerequisites
- Node.js >= 20 recommended (provides Web globals used by dependencies).
- npm (comes with Node.js)

## Install

```bash
npm install
```

## Build

```bash
npm run compile
```

## Test

```bash
npm test
```

## Package

Create a .vsix package using `vsce`:

```bash
npx vsce package
# or
npx @vscode/vsce package
```

If you see an error about `File is not defined` (coming from `undici`):

- Preferred: upgrade Node.js to v20+ and re-run `npm install`.
- Workaround: polyfill `File` at runtime:

```bash
npm install --no-save fetch-blob
echo "global.File = require('fetch-blob').File;" > /tmp/polyfill-file.js
NODE_OPTIONS="--require /tmp/polyfill-file.js" npx @vscode/vsce package
```

## Run Locally


- Open this folder in VS Code and press `F5` to launch the Extension Development Host.

## Multi-root and nested-repository workspaces

The extension supports VS Code multi-root workspaces and parent folders containing multiple Git repositories. Each distinct Git repository is shown as a repository group in the Prompt History view, and opening a diff uses the repository that owns the selected file. The repository containing the active editor is listed first.

## Functionalities

### Repository and workspace support

- Detects repositories through the built-in VS Code Git extension.
- Supports single-root, multi-root, and mixed workspaces containing ordinary folders and nested Git repositories.
- Displays each discovered repository as a separate repository group when needed.
- Places the repository containing the active editor first.
- Uses the owning repository when reading files or opening diffs.

### Prompt discovery

- Reads committed prompt history directly from Git.
- Detects prompt files through configurable include globs.
- Excludes paths through configurable exclude globs.
- Displays commit hash, subject, author, date, and changed prompt files.
- Identifies added, modified, deleted, and renamed prompt files.
- Shows rename paths using the previous and current filenames.
- Loads history in pages and provides a `Load more history` action.

### Search and filtering

- Searches commit subjects, file paths, authors, dates, and repository paths.
- Supports plain search terms with AND semantics.
- Supports `author:value` filtering.
- Supports `repo:value` filtering.
- Supports `status:A|D|M|R` filtering.
- Supports `after:YYYY-MM-DD` filtering.
- Supports `before:YYYY-MM-DD` filtering.
- Provides `Search` and `Clear Search` commands from the Prompt History view.
- Provides `Prompt History: Show Prompt History for Active File` to filter history to the open file.

### Revision viewing and reuse

- Opens the standard VS Code side-by-side diff for each committed prompt change.
- Opens a historical prompt revision as a read-only document.
- Copies the content of a historical prompt revision to the clipboard.
- Handles added and deleted files using the correct parent or commit revision.
- Handles renamed files using the correct old and new paths.
- Compares two historical prompt revisions.
- Compares a historical revision with the current working file.

### Bookmarks and refresh

- Pins commits or individual prompt-file revisions.
- Displays pinned items with a pin indicator.
- Persists pins in the current VS Code workspace state.
- Refreshes manually through the `Refresh` command.
- Refreshes when Prompt History configuration changes.
- Refreshes when workspace folders change.
- Refreshes when the Git extension reports repository changes.
- Prevents overlapping refresh operations.

### Configuration

- `promptHistory.includeGlobs`: file patterns treated as prompts.
- `promptHistory.excludeGlobs`: file patterns excluded from history.
- `promptHistory.maxCommits`: number of commits loaded per history page.

The extension is read-only with respect to repositories: it never creates, edits, renames, deletes, stages, or commits files.

## Where to find and how to use the functionalities

### Open the Prompt History view

1. Open a folder or workspace containing one or more Git repositories in VS Code.
2. Open the Source Control view from the Activity Bar.
3. Expand the `Prompt History` section.
4. Expand a repository, commit, and prompt file to browse its history.
5. Select a prompt file to open its standard VS Code diff.

The Prompt History view is populated from committed files. If no prompt files are displayed, check the include and exclude glob settings.

### View toolbar actions

The following actions are available in the toolbar at the top of the Prompt History view:

- `Refresh`: reloads repositories and prompt history.
- `Search`: opens a search input for text and metadata filters.
- `Clear Search`: removes the current search and active-file filter.
- `Open Settings`: opens the Prompt History settings in VS Code.

### Prompt file actions

Right-click a prompt file inside the Prompt History view to access:

- `Open Diff`: compares the selected commit with its parent commit.
- `Copy Prompt at Revision`: copies the historical prompt content to the clipboard.
- `Open Prompt Revision`: opens the historical content as a read-only editor.
- `Compare Prompt Revisions`: choose another historical revision or the current working file for comparison.
- `Pin/Unpin Prompt History Item`: stores or removes a workspace bookmark.

### Active-file history

Open a prompt file in the editor and use one of these options:

- Click the Prompt History action in the editor title bar.
- Open the Command Palette with `Cmd+Shift+P` on macOS or `Ctrl+Shift+P` on Windows/Linux and run `Prompt History: Show Prompt History for Active File`.

The tree is then limited to commits that changed the active file. Use `Clear Search` to return to the full history.

### Search examples

Use `Search` in the Prompt History toolbar or run `Prompt History: Search` from the Command Palette. Multiple terms are combined with AND semantics.

```text
banking customer
author:ada
status:M
repo:fol-be after:2026-01-01
before:2026-06-01
```

Plain terms search commit subjects, paths, authors, dates, and repository paths. The supported structured filters are `author:value`, `repo:value`, `status:A|D|M|R`, `after:YYYY-MM-DD`, and `before:YYYY-MM-DD`.

### Load additional history

The first load uses the configured `promptHistory.maxCommits` value as its page size. When more Git history is available, expand or select `Load more history` to retrieve the next page.

### Configure the extension

Settings can be opened in either of these ways:

- Click `Open Settings` in the Prompt History view toolbar.
- Open VS Code Settings with `Cmd+,` on macOS or `Ctrl+,` on Windows/Linux, then search for `Prompt History`.
- Edit the workspace or user `settings.json` directly.

Example configuration:

```json
{
  "promptHistory.includeGlobs": [
    "prompts/**",
    "**/*.prompt.md",
    "**/*.prompt.txt"
  ],
  "promptHistory.excludeGlobs": [
    "**/node_modules/**",
    "**/.git/**"
  ],
  "promptHistory.maxCommits": 200
}
```

`includeGlobs` controls which committed files are treated as prompts. `excludeGlobs` takes precedence over included paths. `maxCommits` controls the number of raw Git commits loaded per page; use `Load more history` to continue browsing beyond the first page.

## Publish

Set up a publisher and token for `vsce`, then:

```bash
npx vsce publish patch
```

## Notes
- If `npm run compile` fails, fix TypeScript errors under `src/` as reported by the terminal.
- File issues or build errors? Ask me to run the build and I can fix them interactively.
