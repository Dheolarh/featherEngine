# FeatherScript for VS Code

This extension adds editor support for NodeForge `.feather` scripts:

- FeatherScript file association and syntax highlighting
- parser-backed errors and warnings while you type
- API completions, including variables declared in the current Blueprint
- API and Blueprint-variable hover information
- Blueprint, variable, event, function, and detached-block document symbols
- indentation, folding, bracket, comment, and snippet support

The diagnostics and API catalogue are bundled from NodeForge's existing
`src/scripting/featherParser.ts` and `src/scripting/featherApi.ts` modules, so the
editor and application use the same syntax rules at the time the extension is
built.

## Develop

From this directory:

```sh
npm install
npm run check
npm run build
```

Then open this directory in VS Code and launch an Extension Development Host
that uses `dist/extension.js`, or package the directory with your preferred VS
Code extension packaging tool.

Rebuild the extension whenever the application's FeatherScript parser or API
catalogue changes.

## Scope

This is lightweight in-process language tooling. It does not provide a language
server, cross-file project indexing, refactoring, execution, breakpoints, or a
debugger. Project-wide variables are not available unless a future editor bridge
provides project metadata; variables declared in the current `.feather` document
are included in completion and hover results.
