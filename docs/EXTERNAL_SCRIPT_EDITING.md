# External FeatherScript editing

The desktop editor can link any Blueprint to a normal `.feather` file, so the same script can be
edited in VS Code, Cursor, Zed, Vim, Sublime Text, or another text editor.

## Link a Blueprint

1. Save the Feather project to a desktop folder.
2. Open the Blueprint's **Code** tab.
3. Select **Link FeatherScript to an external editor** in the code toolbar.
4. Use the adjacent folder button to reveal the generated file.

Linked files live under `scripts/` and include a stable id suffix, for example:

```text
scripts/player-controller--4f127f825a90.feather
```

Feather watches that directory while the project is open. Valid external changes update the visual
graph automatically. A draft with errors is kept in the code editor while the last valid graph
continues to run.

If the file and Feather both change from their shared checkpoint, neither side is overwritten. The
Code tab presents **Use external file**, **Keep Feather version**, **Use Visual graph**, and an
expandable three-way comparison. Writes use an exact disk checkpoint, so even a save made by the
external editor during Feather's write is turned into a conflict instead of being replaced. Visual
mode also shows a conflict banner that links back to the comparison.
Unlinking never deletes the external file.

The browser build retains the existing download workflow; persistent linked files require the
desktop app's project folder access.

## VS Code extension

The extension source is in `extensions/featherscript-vscode`. It provides syntax highlighting,
snippets, parser-backed diagnostics, completion, hover help, and document symbols.

```sh
cd extensions/featherscript-vscode
npm install
npm run check
npm run build
npx @vscode/vsce package --out featherscript-vscode.vsix
code --install-extension featherscript-vscode.vsix
```

The root commands `npm run vscode:check` and `npm run vscode:build` are convenient for CI and local
validation after changing the FeatherScript parser or API catalogue.

This first release intentionally has no debugger, breakpoints, refactoring, or cross-file language
server. Those require expression-level source maps and a workspace symbol index.
