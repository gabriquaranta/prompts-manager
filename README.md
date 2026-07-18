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

## Features

- Search commit subjects, paths, authors, repositories, dates, and change statuses from the view toolbar.
- Use `Prompt History: Show Prompt History for Active File` to focus the tree on the open prompt.
- Open or copy a committed prompt revision without modifying repository files.
- Compare two committed revisions or a committed revision with the working file.
- Load additional history pages when the initial commit batch is exhausted.
- Pin commits or files; pins are stored in the current workspace state.

Search supports plain terms and these exact filters: `author:value`, `repo:value`, `status:A|D|M|R`, `after:YYYY-MM-DD`, and `before:YYYY-MM-DD`. Terms are combined with AND semantics. Use `Clear Search` to remove both text and active-file filters.

## Publish

Set up a publisher and token for `vsce`, then:

```bash
npx vsce publish patch
```

## Notes
- If `npm run compile` fails, fix TypeScript errors under `src/` as reported by the terminal.
- File issues or build errors? Ask me to run the build and I can fix them interactively.
