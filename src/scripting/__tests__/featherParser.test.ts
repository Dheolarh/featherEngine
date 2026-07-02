import { describe, expect, it } from 'vitest';
import { parseFeatherScript } from '../featherParser';

describe('parseFeatherScript', () => {
  it('parses a typed blueprint script into declarations and statements', () => {
    const result = parseFeatherScript(
      [
        'blueprint Player',
        '',
        'var speed: number = 6',
        '',
        'on update(dt):',
        '    if Input.move().x > 0:',
        '        self.translate(axis: "x", amount: speed)',
        '    else:',
        '        pass',
        '',
        'function Heal(amount):',
        '    self.health += amount',
        '    return self.health',
      ].join('\n'),
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.program.blueprint?.name).toBe('Player');
    expect(result.program.variables[0]).toMatchObject({ name: 'speed', typeName: 'number' });
    expect(result.program.handlers[0]).toMatchObject({ eventName: 'update', args: ['dt'] });
    expect(result.program.handlers[0].body[0].kind).toBe('IfStatement');
    expect(result.program.functions[0]).toMatchObject({ name: 'Heal', args: ['amount'] });
    expect(result.program.functions[0].body.map((statement) => statement.kind)).toEqual(['AssignmentStatement', 'ReturnStatement']);
  });

  it('parses graph-style labels and event details', () => {
    const result = parseFeatherScript(
      [
        'blueprint Patrol',
        '',
        'on update every 1s:',
        '    sequence:',
        '        a:',
        '            self.translate(axis: "x", amount: 1)',
        '        b:',
        '            wait(0.25)',
        '    match state:',
        '        case "idle":',
        '            pass',
        '        default:',
        '            return state',
      ].join('\n'),
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.program.handlers[0]).toMatchObject({ eventName: 'update', detail: 'every 1s' });
    expect(result.program.handlers[0].body.map((statement) => statement.kind)).toEqual(['LabelBlock', 'MatchStatement']);
  });

  it('reports syntax and indentation diagnostics while preserving a partial AST', () => {
    const result = parseFeatherScript(
      [
        'blueprint Broken',
        'function Move',
        '\tpass',
        'self.translate(axis: "x", amount: 1)',
        '    pass',
      ].join('\n'),
    );
    const messages = result.diagnostics.map((diagnostic) => diagnostic.message);

    expect(messages.some((message) => message.includes('tabs'))).toBe(true);
    expect(messages.some((message) => message.includes('must end with'))).toBe(true);
    expect(messages.some((message) => message.includes('Unexpected top-level'))).toBe(true);
    expect(messages.some((message) => message.includes('column 1'))).toBe(true);
    expect(result.program.blueprint?.name).toBe('Broken');
  });
});
