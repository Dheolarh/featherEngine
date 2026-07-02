export type FeatherDiagnosticSeverity = 'error' | 'warning';

export interface FeatherSourceLocation {
  line: number;
  column: number;
  length: number;
}

export interface FeatherDiagnostic extends FeatherSourceLocation {
  severity: FeatherDiagnosticSeverity;
  message: string;
}

export interface FeatherProgram {
  kind: 'Program';
  blueprint?: FeatherBlueprintDeclaration;
  variables: FeatherVariableDeclaration[];
  handlers: FeatherEventHandler[];
  functions: FeatherFunctionDeclaration[];
  detached?: FeatherDetachedBlock;
}

export interface FeatherBlueprintDeclaration extends FeatherSourceLocation {
  kind: 'BlueprintDeclaration';
  name: string;
}

export interface FeatherVariableDeclaration extends FeatherSourceLocation {
  kind: 'VariableDeclaration';
  name: string;
  typeName?: string;
  initializer?: FeatherExpression;
}

export interface FeatherEventHandler extends FeatherSourceLocation {
  kind: 'EventHandler';
  eventName: string;
  detail?: string;
  args: string[];
  body: FeatherStatement[];
}

export interface FeatherFunctionDeclaration extends FeatherSourceLocation {
  kind: 'FunctionDeclaration';
  name: string;
  args: string[];
  body: FeatherStatement[];
}

export interface FeatherDetachedBlock extends FeatherSourceLocation {
  kind: 'DetachedBlock';
  body: FeatherStatement[];
}

export type FeatherStatement =
  | FeatherPassStatement
  | FeatherReturnStatement
  | FeatherAssignmentStatement
  | FeatherExpressionStatement
  | FeatherIfStatement
  | FeatherForStatement
  | FeatherWhileStatement
  | FeatherMatchStatement
  | FeatherLabelBlock
  | FeatherErrorStatement;

export interface FeatherExpression {
  kind: 'Expression';
  raw: string;
  loc: FeatherSourceLocation;
}

export interface FeatherPassStatement extends FeatherSourceLocation {
  kind: 'PassStatement';
}

export interface FeatherReturnStatement extends FeatherSourceLocation {
  kind: 'ReturnStatement';
  value?: FeatherExpression;
}

export interface FeatherAssignmentStatement extends FeatherSourceLocation {
  kind: 'AssignmentStatement';
  target: string;
  operator: '=' | '+=' | '-=' | '*=' | '/=';
  value: FeatherExpression;
}

export interface FeatherExpressionStatement extends FeatherSourceLocation {
  kind: 'ExpressionStatement';
  expression: FeatherExpression;
}

export interface FeatherIfStatement extends FeatherSourceLocation {
  kind: 'IfStatement';
  test: FeatherExpression;
  consequent: FeatherStatement[];
  alternates: Array<{
    kind: 'ElifClause' | 'ElseClause';
    loc: FeatherSourceLocation;
    test?: FeatherExpression;
    body: FeatherStatement[];
  }>;
}

export interface FeatherForStatement extends FeatherSourceLocation {
  kind: 'ForStatement';
  binding: string;
  iterable: FeatherExpression;
  body: FeatherStatement[];
}

export interface FeatherWhileStatement extends FeatherSourceLocation {
  kind: 'WhileStatement';
  test: FeatherExpression;
  body: FeatherStatement[];
}

export interface FeatherMatchStatement extends FeatherSourceLocation {
  kind: 'MatchStatement';
  value: FeatherExpression;
  body: FeatherStatement[];
}

export interface FeatherLabelBlock extends FeatherSourceLocation {
  kind: 'LabelBlock';
  label: string;
  value?: FeatherExpression;
  body: FeatherStatement[];
}

export interface FeatherErrorStatement extends FeatherSourceLocation {
  kind: 'ErrorStatement';
  raw: string;
}

export interface FeatherParseResult {
  program: FeatherProgram;
  diagnostics: FeatherDiagnostic[];
}

interface LogicalLine {
  line: number;
  indent: number;
  text: string;
  column: number;
  raw: string;
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

const locOf = (line: LogicalLine, length = line.text.length): FeatherSourceLocation => ({
  line: line.line,
  column: line.column,
  length: Math.max(1, length),
});

const exprOf = (line: LogicalLine, raw: string, offset = 0): FeatherExpression => ({
  kind: 'Expression',
  raw: raw.trim(),
  loc: {
    line: line.line,
    column: line.column + offset,
    length: Math.max(1, raw.trim().length),
  },
});

const stripComment = (value: string): string => {
  let quote: '"' | "'" | null = null;
  let escaped = false;
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '#') return value.slice(0, i);
  }
  return value;
};

const splitArgs = (raw: string): string[] =>
  raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

/** Find the top-level assignment operator, ignoring "=" inside strings, brackets, and comparisons. */
const findAssignment = (
  text: string,
): { index: number; operator: FeatherAssignmentStatement['operator'] } | undefined => {
  let quote: '"' | "'" | null = null;
  let escaped = false;
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') {
      depth += 1;
      continue;
    }
    if (ch === ')' || ch === ']' || ch === '}') {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth > 0) continue;
    if (i > 0 && '+-*/'.includes(ch) && text[i + 1] === '=' && text[i + 2] !== '=') {
      return { index: i, operator: `${ch}=` as FeatherAssignmentStatement['operator'] };
    }
    if (i > 0 && ch === '=' && text[i + 1] !== '=' && !'!<>=+-*/'.includes(text[i - 1])) {
      return { index: i, operator: '=' };
    }
  }
  return undefined;
};

export const parseFeatherScript = (source: string): FeatherParseResult => {
  const diagnostics: FeatherDiagnostic[] = [];
  const rawLines = source.replace(/\r\n/g, '\n').split('\n');
  const lines: LogicalLine[] = [];

  rawLines.forEach((rawLine, index) => {
    const lineNo = index + 1;
    const tabIndex = rawLine.indexOf('\t');
    if (tabIndex >= 0) {
      diagnostics.push({
        severity: 'error',
        message: 'Use spaces for indentation; tabs are not allowed in FeatherScript.',
        line: lineNo,
        column: tabIndex + 1,
        length: 1,
      });
    }
    const spaces = rawLine.match(/^ */)?.[0].length ?? 0;
    const text = stripComment(rawLine.slice(spaces)).trimEnd();
    if (!text.trim()) return;
    lines.push({
      line: lineNo,
      indent: spaces,
      text: text.trim(),
      column: spaces + 1,
      raw: rawLine,
    });
  });

  let index = 0;
  const program: FeatherProgram = {
    kind: 'Program',
    variables: [],
    handlers: [],
    functions: [],
  };

  const diagnostic = (line: LogicalLine, message: string, severity: FeatherDiagnosticSeverity = 'error') => {
    diagnostics.push({ ...locOf(line), severity, message });
  };

  const parseBlock = (parentIndent: number): FeatherStatement[] => {
    const body: FeatherStatement[] = [];
    let bodyIndent: number | undefined;

    while (index < lines.length) {
      const line = lines[index];
      if (line.indent <= parentIndent) break;
      if (bodyIndent === undefined) bodyIndent = line.indent;
      if (line.indent < bodyIndent) break;
      if (line.indent > bodyIndent) {
        diagnostic(line, 'Unexpected indentation. Start a nested block with a line ending in ":".');
        index += 1;
        continue;
      }
      const statement = parseStatement(line);
      body.push(statement);
    }

    return body;
  };

  const parseRequiredBlock = (line: LogicalLine): FeatherStatement[] => {
    index += 1;
    const body = parseBlock(line.indent);
    if (!body.length) {
      diagnostic(line, 'Expected an indented block after this line.');
    }
    return body;
  };

  const parseColonBlock = <T extends FeatherStatement>(
    line: LogicalLine,
    make: (body: FeatherStatement[]) => T,
  ): T => make(parseRequiredBlock(line));

  const parseIf = (line: LogicalLine): FeatherIfStatement => {
    const match = line.text.match(/^if\s+(.+):$/);
    if (!match) {
      diagnostic(line, 'Expected if statement in the form: if condition:');
      index += 1;
      return { kind: 'IfStatement', ...locOf(line), test: exprOf(line, ''), consequent: [], alternates: [] };
    }
    const node: FeatherIfStatement = {
      kind: 'IfStatement',
      ...locOf(line),
      test: exprOf(line, match[1], line.text.indexOf(match[1]) + 1),
      consequent: parseRequiredBlock(line),
      alternates: [],
    };

    while (index < lines.length && lines[index].indent === line.indent) {
      const next = lines[index];
      const elif = next.text.match(/^elif\s+(.+):$/);
      if (elif) {
        node.alternates.push({
          kind: 'ElifClause',
          loc: locOf(next),
          test: exprOf(next, elif[1], next.text.indexOf(elif[1]) + 1),
          body: parseRequiredBlock(next),
        });
        continue;
      }
      if (next.text === 'else:') {
        node.alternates.push({
          kind: 'ElseClause',
          loc: locOf(next),
          body: parseRequiredBlock(next),
        });
        continue;
      }
      break;
    }
    return node;
  };

  const parseFor = (line: LogicalLine): FeatherForStatement => {
    const match = line.text.match(/^for\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\s+(.+):$/);
    if (!match) {
      diagnostic(line, 'Expected for loop in the form: for item in collection:');
      index += 1;
      return { kind: 'ForStatement', ...locOf(line), binding: 'item', iterable: exprOf(line, ''), body: [] };
    }
    return parseColonBlock(line, (body) => ({
      kind: 'ForStatement',
      ...locOf(line),
      binding: match[1],
      iterable: exprOf(line, match[2], line.text.indexOf(match[2]) + 1),
      body,
    }));
  };

  const parseWhile = (line: LogicalLine): FeatherWhileStatement => {
    const match = line.text.match(/^while\s+(.+):$/);
    if (!match) {
      diagnostic(line, 'Expected while loop in the form: while condition:');
      index += 1;
      return { kind: 'WhileStatement', ...locOf(line), test: exprOf(line, ''), body: [] };
    }
    return parseColonBlock(line, (body) => ({
      kind: 'WhileStatement',
      ...locOf(line),
      test: exprOf(line, match[1], line.text.indexOf(match[1]) + 1),
      body,
    }));
  };

  const parseMatch = (line: LogicalLine): FeatherMatchStatement => {
    const match = line.text.match(/^match\s+(.+):$/);
    if (!match) {
      diagnostic(line, 'Expected match statement in the form: match value:');
      index += 1;
      return { kind: 'MatchStatement', ...locOf(line), value: exprOf(line, ''), body: [] };
    }
    return parseColonBlock(line, (body) => ({
      kind: 'MatchStatement',
      ...locOf(line),
      value: exprOf(line, match[1], line.text.indexOf(match[1]) + 1),
      body,
    }));
  };

  const parseLabelBlock = (line: LogicalLine): FeatherLabelBlock => {
    const [labelRaw, valueRaw] = line.text.slice(0, -1).split(/\s+/, 2);
    return parseColonBlock(line, (body) => ({
      kind: 'LabelBlock',
      ...locOf(line),
      label: labelRaw,
      value: valueRaw ? exprOf(line, line.text.slice(labelRaw.length).slice(0, -1).trim(), labelRaw.length + 2) : undefined,
      body,
    }));
  };

  const parseStatement = (line: LogicalLine): FeatherStatement => {
    if (line.text === 'pass') {
      index += 1;
      return { kind: 'PassStatement', ...locOf(line) };
    }
    if (/^if\b/.test(line.text)) return parseIf(line);
    if (/^for\b/.test(line.text)) return parseFor(line);
    if (/^while\b/.test(line.text)) return parseWhile(line);
    if (/^match\b/.test(line.text)) return parseMatch(line);

    if (/^(elif\b|else:)/.test(line.text)) {
      diagnostic(line, 'This clause must immediately follow an if block at the same indentation.');
      index += 1;
      return { kind: 'ErrorStatement', ...locOf(line), raw: line.text };
    }

    if (/^(case\b|default:|then\b|a:|b:|done:|sequence:|sync:|race:|flip_flop\b)/.test(line.text)) {
      if (!line.text.endsWith(':')) diagnostic(line, 'Expected ":" at the end of this block header.');
      return parseLabelBlock(line);
    }

    if (line.text.startsWith('return')) {
      const raw = line.text.slice('return'.length).trim();
      index += 1;
      return {
        kind: 'ReturnStatement',
        ...locOf(line),
        value: raw ? exprOf(line, raw, line.text.indexOf(raw) + 1) : undefined,
      };
    }

    const assignment = findAssignment(line.text);
    if (assignment && line.text.slice(0, assignment.index).trim()) {
      const valueStart = assignment.index + assignment.operator.length;
      index += 1;
      return {
        kind: 'AssignmentStatement',
        ...locOf(line),
        target: line.text.slice(0, assignment.index).trim(),
        operator: assignment.operator,
        value: exprOf(line, line.text.slice(valueStart), valueStart + 1),
      };
    }

    if (line.text.endsWith(':')) {
      diagnostic(line, 'Unknown block header. Supported blocks include if, for, while, match, case, sequence, race, and sync.');
      return parseLabelBlock(line);
    }

    index += 1;
    return {
      kind: 'ExpressionStatement',
      ...locOf(line),
      expression: exprOf(line, line.text),
    };
  };

  const parseVariable = (line: LogicalLine): FeatherVariableDeclaration | undefined => {
    const match = line.text.match(/^var\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s*:\s*([A-Za-z_][A-Za-z0-9_]*))?(?:\s*=\s*(.+))?$/);
    if (!match) {
      diagnostic(line, 'Expected variable declaration in the form: var name: type = value');
      return undefined;
    }
    return {
      kind: 'VariableDeclaration',
      ...locOf(line),
      name: match[1],
      typeName: match[2],
      initializer: match[3] ? exprOf(line, match[3], line.text.indexOf(match[3]) + 1) : undefined,
    };
  };

  const parseHeaderArgs = (raw: string): { name: string; args: string[]; detail?: string } => {
    const match = raw.match(/^([A-Za-z_][A-Za-z0-9_]*)(?:\((.*)\))?$/);
    if (!match) return { name: raw.trim(), args: [] };
    return { name: match[1], args: splitArgs(match[2] ?? '') };
  };

  while (index < lines.length) {
    const line = lines[index];
    if (line.indent !== 0) {
      diagnostic(line, 'Top-level declarations must start at column 1.');
      index += 1;
      continue;
    }

    if (line.text.startsWith('blueprint ')) {
      const name = line.text.slice('blueprint '.length).trim();
      if (!name || !IDENTIFIER.test(name)) diagnostic(line, 'Blueprint name must be a valid identifier.');
      program.blueprint = { kind: 'BlueprintDeclaration', ...locOf(line), name };
      index += 1;
      continue;
    }

    if (line.text.startsWith('var ')) {
      const variable = parseVariable(line);
      if (variable) program.variables.push(variable);
      index += 1;
      continue;
    }

    if (line.text.startsWith('on ')) {
      if (!line.text.endsWith(':')) {
        diagnostic(line, 'Event handlers must end with ":".');
        index += 1;
        continue;
      }
      const header = line.text.slice('on '.length, -1).trim();
      const every = header.match(/^update\s+every\s+(.+)$/);
      const event = header.startsWith('event ') ? header.slice('event '.length).trim() : header;
      const parsed = every ? { name: 'update', args: [], detail: `every ${every[1]}` } : parseHeaderArgs(event);
      const handler: FeatherEventHandler = {
        kind: 'EventHandler',
        ...locOf(line),
        eventName: parsed.name,
        detail: parsed.detail,
        args: parsed.args,
        body: parseRequiredBlock(line),
      };
      program.handlers.push(handler);
      continue;
    }

    if (line.text.startsWith('function ')) {
      if (!line.text.endsWith(':')) {
        diagnostic(line, 'Function declarations must end with ":".');
        index += 1;
        continue;
      }
      const parsed = parseHeaderArgs(line.text.slice('function '.length, -1).trim());
      if (!IDENTIFIER.test(parsed.name)) diagnostic(line, 'Function name must be a valid identifier.');
      program.functions.push({
        kind: 'FunctionDeclaration',
        ...locOf(line),
        name: parsed.name,
        args: parsed.args,
        body: parseRequiredBlock(line),
      });
      continue;
    }

    if (line.text === 'detached:') {
      program.detached = { kind: 'DetachedBlock', ...locOf(line), body: parseRequiredBlock(line) };
      continue;
    }

    if (line.text.endsWith(':')) {
      diagnostic(line, 'Only blueprint, var, on, function, and detached declarations are allowed at top level.');
      index += 1;
      continue;
    }

    diagnostic(line, 'Unexpected top-level statement. Put executable code inside an event or function block.');
    index += 1;
  }

  if (!program.blueprint) {
    diagnostics.unshift({
      severity: 'warning',
      message: 'Add a blueprint declaration at the top, for example: blueprint Player',
      line: 1,
      column: 1,
      length: 1,
    });
  }

  return { program, diagnostics };
};
