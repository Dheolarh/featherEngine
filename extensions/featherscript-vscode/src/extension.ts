import * as vscode from 'vscode';

import {
  parseFeatherScript,
  type FeatherDiagnostic,
  type FeatherProgram,
  type FeatherSourceLocation,
} from '../../../src/scripting/featherParser';
import {
  FEATHER_API_ENTRIES,
  getFeatherCompletions,
  type FeatherApiEntry,
  type FeatherApiKind,
  type FeatherDynamicSymbol,
} from '../../../src/scripting/featherApi';

const LANGUAGE_ID = 'featherscript';
const DIAGNOSTIC_SOURCE = 'FeatherScript';
const IDENTIFIER_PATTERN = /[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*/;
const VALUE_TYPES = new Set<FeatherDynamicSymbol['type']>(['number', 'string', 'boolean', 'vector3']);

const isFeatherDocument = (document: vscode.TextDocument): boolean => document.languageId === LANGUAGE_ID;

const sourceRange = (document: vscode.TextDocument, location: FeatherSourceLocation): vscode.Range => {
  if (document.lineCount === 0) return new vscode.Range(0, 0, 0, 0);

  const lineIndex = Math.min(Math.max(location.line - 1, 0), document.lineCount - 1);
  const line = document.lineAt(lineIndex);
  const startCharacter = Math.min(Math.max(location.column - 1, 0), line.text.length);
  const endCharacter = Math.min(startCharacter + Math.max(location.length, 1), line.text.length);
  return new vscode.Range(lineIndex, startCharacter, lineIndex, endCharacter);
};

const publishDiagnostics = (
  document: vscode.TextDocument,
  collection: vscode.DiagnosticCollection,
): void => {
  if (!isFeatherDocument(document)) return;

  try {
    const parsed = parseFeatherScript(document.getText());
    const diagnostics = parsed.diagnostics.map((item: FeatherDiagnostic) => {
      const severity = item.severity === 'error'
        ? vscode.DiagnosticSeverity.Error
        : vscode.DiagnosticSeverity.Warning;
      const diagnostic = new vscode.Diagnostic(sourceRange(document, item), item.message, severity);
      diagnostic.source = DIAGNOSTIC_SOURCE;
      return diagnostic;
    });
    collection.set(document.uri, diagnostics);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const diagnostic = new vscode.Diagnostic(
      new vscode.Range(0, 0, 0, Math.min(document.lineAt(0).text.length, 1)),
      `FeatherScript validation failed: ${message}`,
      vscode.DiagnosticSeverity.Error,
    );
    diagnostic.source = DIAGNOSTIC_SOURCE;
    collection.set(document.uri, [diagnostic]);
  }
};

const inferredValueType = (typeName: string | undefined, initializer: string | undefined): FeatherDynamicSymbol['type'] => {
  const normalizedType = typeName?.toLowerCase() as FeatherDynamicSymbol['type'] | undefined;
  if (normalizedType && VALUE_TYPES.has(normalizedType)) return normalizedType;

  const raw = initializer?.trim() ?? '';
  if (/^["']/.test(raw)) return 'string';
  if (/^(?:true|false)\b/.test(raw)) return 'boolean';
  if (/^(?:vec3\s*\(|\[)/.test(raw)) return 'vector3';
  return 'number';
};

const blueprintVariables = (program: FeatherProgram): FeatherDynamicSymbol[] => program.variables.map((variable) => ({
  name: variable.name,
  type: inferredValueType(variable.typeName, variable.initializer?.raw),
}));

const completionKind = (kind: FeatherApiKind): vscode.CompletionItemKind => {
  switch (kind) {
    case 'event':
      return vscode.CompletionItemKind.Event;
    case 'call':
      return vscode.CompletionItemKind.Function;
    case 'value':
      return vscode.CompletionItemKind.Value;
    case 'variable':
      return vscode.CompletionItemKind.Variable;
    case 'statement':
      return vscode.CompletionItemKind.Snippet;
  }
};

const completionProvider: vscode.CompletionItemProvider = {
  provideCompletionItems(document, position) {
    const source = document.getText();
    const parsed = parseFeatherScript(source);
    const configuration = vscode.workspace.getConfiguration('featherscript', document.uri);
    const limit = configuration.get<number>('completions.maxItems', 20);
    const completions = getFeatherCompletions(source, document.offsetAt(position), {
      blueprintVariables: blueprintVariables(parsed.program),
      limit,
    });

    return completions.map((completion, index) => {
      const item = new vscode.CompletionItem(completion.signature, completionKind(completion.kind));
      item.detail = completion.detail
        ? `FeatherScript · ${completion.detail}`
        : `FeatherScript · ${completion.kind}`;
      item.documentation = new vscode.MarkdownString(completion.description);
      item.filterText = [completion.label, completion.signature, completion.insertText].join(' ');
      item.sortText = String(index).padStart(3, '0');
      item.preselect = index === 0;
      item.textEdit = vscode.TextEdit.replace(
        new vscode.Range(
          document.positionAt(completion.replacementStart),
          document.positionAt(completion.replacementEnd),
        ),
        completion.insertText,
      );
      return item;
    });
  },
};

const entryToken = (entry: FeatherApiEntry): string => {
  if (entry.kind === 'event') {
    return entry.signature.match(/^on\s+(?:event\s+)?([A-Za-z_][A-Za-z0-9_]*)/)?.[1] ?? entry.label;
  }
  return entry.insertText.match(/^([A-Za-z_][A-Za-z0-9_.]*)/)?.[1] ?? entry.label;
};

const hoverForEntries = (entries: FeatherApiEntry[]): vscode.MarkdownString => {
  const markdown = new vscode.MarkdownString();
  markdown.supportHtml = false;
  entries.slice(0, 5).forEach((entry, index) => {
    if (index > 0) markdown.appendMarkdown('\n\n---\n\n');
    markdown.appendCodeblock(entry.signature, LANGUAGE_ID);
    markdown.appendMarkdown(`\n${entry.description}`);
    if (entry.valueType) markdown.appendMarkdown(`\n\nReturns **${entry.valueType}**.`);
  });
  return markdown;
};

const hoverProvider: vscode.HoverProvider = {
  provideHover(document, position) {
    const tokenRange = document.getWordRangeAtPosition(position, IDENTIFIER_PATTERN);
    if (!tokenRange) return undefined;

    const token = document.getText(tokenRange);
    const lineText = document.lineAt(position.line).text.trim();
    let matches = FEATHER_API_ENTRIES.filter((entry) => entryToken(entry) === token);

    if (matches.length > 1 && lineText.includes(' every ')) {
      const timedMatches = matches.filter((entry) => entry.signature.includes(' every '));
      if (timedMatches.length > 0) matches = timedMatches;
    }

    if (matches.length > 0) return new vscode.Hover(hoverForEntries(matches), tokenRange);

    const parsed = parseFeatherScript(document.getText());
    const variableName = token.startsWith('self.') ? token.slice('self.'.length) : token;
    const declaration = parsed.program.variables.find((variable) => variable.name === variableName);
    if (!declaration) return undefined;

    const type = inferredValueType(declaration.typeName, declaration.initializer?.raw);
    const markdown = new vscode.MarkdownString();
    markdown.appendCodeblock(`self.${declaration.name}: ${type}`, LANGUAGE_ID);
    markdown.appendMarkdown('\nBlueprint variable stored per object instance.');
    return new vscode.Hover(markdown, tokenRange);
  },
};

const symbolProvider: vscode.DocumentSymbolProvider = {
  provideDocumentSymbols(document) {
    const program = parseFeatherScript(document.getText()).program;
    const symbols: vscode.DocumentSymbol[] = [];

    if (program.blueprint) {
      const range = sourceRange(document, program.blueprint);
      symbols.push(new vscode.DocumentSymbol(
        program.blueprint.name || 'Blueprint',
        'Blueprint',
        vscode.SymbolKind.Class,
        range,
        range,
      ));
    }

    for (const variable of program.variables) {
      const range = sourceRange(document, variable);
      symbols.push(new vscode.DocumentSymbol(
        variable.name,
        variable.typeName ?? inferredValueType(undefined, variable.initializer?.raw),
        vscode.SymbolKind.Variable,
        range,
        range,
      ));
    }

    for (const handler of program.handlers) {
      const range = sourceRange(document, handler);
      const argumentsLabel = handler.args.length > 0 ? `(${handler.args.join(', ')})` : '';
      const detail = handler.detail ? ` ${handler.detail}` : '';
      symbols.push(new vscode.DocumentSymbol(
        `on ${handler.eventName}${argumentsLabel}${detail}`,
        'Event handler',
        vscode.SymbolKind.Event,
        range,
        range,
      ));
    }

    for (const declaration of program.functions) {
      const range = sourceRange(document, declaration);
      symbols.push(new vscode.DocumentSymbol(
        `${declaration.name}(${declaration.args.join(', ')})`,
        'Function',
        vscode.SymbolKind.Function,
        range,
        range,
      ));
    }

    if (program.detached) {
      const range = sourceRange(document, program.detached);
      symbols.push(new vscode.DocumentSymbol(
        'detached',
        'Detached graph nodes',
        vscode.SymbolKind.Namespace,
        range,
        range,
      ));
    }

    return symbols.sort((left, right) => left.range.start.compareTo(right.range.start));
  },
};

export const activate = (context: vscode.ExtensionContext): void => {
  const diagnostics = vscode.languages.createDiagnosticCollection(LANGUAGE_ID);
  const pendingDiagnostics = new Map<string, ReturnType<typeof setTimeout>>();

  const scheduleDiagnostics = (document: vscode.TextDocument, immediate = false): void => {
    if (!isFeatherDocument(document)) return;
    const key = document.uri.toString();
    const existing = pendingDiagnostics.get(key);
    if (existing) clearTimeout(existing);

    const configuredDelay = vscode.workspace
      .getConfiguration('featherscript', document.uri)
      .get<number>('diagnostics.debounceMilliseconds', 150);
    const delay = immediate ? 0 : Math.max(0, configuredDelay);
    const timer = setTimeout(() => {
      pendingDiagnostics.delete(key);
      publishDiagnostics(document, diagnostics);
    }, delay);
    pendingDiagnostics.set(key, timer);
  };

  for (const document of vscode.workspace.textDocuments) scheduleDiagnostics(document, true);

  context.subscriptions.push(
    diagnostics,
    vscode.workspace.onDidOpenTextDocument((document) => scheduleDiagnostics(document, true)),
    vscode.workspace.onDidChangeTextDocument((event) => scheduleDiagnostics(event.document)),
    vscode.workspace.onDidSaveTextDocument((document) => scheduleDiagnostics(document, true)),
    vscode.workspace.onDidCloseTextDocument((document) => {
      const key = document.uri.toString();
      const pending = pendingDiagnostics.get(key);
      if (pending) clearTimeout(pending);
      pendingDiagnostics.delete(key);
      diagnostics.delete(document.uri);
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration('featherscript.diagnostics')) return;
      for (const document of vscode.workspace.textDocuments) scheduleDiagnostics(document, true);
    }),
    vscode.languages.registerCompletionItemProvider(LANGUAGE_ID, completionProvider, '.'),
    vscode.languages.registerHoverProvider(LANGUAGE_ID, hoverProvider),
    vscode.languages.registerDocumentSymbolProvider(LANGUAGE_ID, symbolProvider),
    new vscode.Disposable(() => {
      for (const timer of pendingDiagnostics.values()) clearTimeout(timer);
      pendingDiagnostics.clear();
    }),
  );
};

export const deactivate = (): void => {};
