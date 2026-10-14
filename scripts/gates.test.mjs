import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const scriptUrl = pathToFileURL(resolve('scripts/gates.mjs')).href;
const blockStart = '<!-- lissio-gates:start -->';
const blockEnd = '<!-- lissio-gates:end -->';
const documentPaths = ['AGENTS.md', 'CONTRIBUTING.md', 'PULL_REQUEST_TEMPLATE.md'];
const lineEndings = [
  ['LF', (text) => text],
  ['CRLF', (text) => text.replace(/\n/g, '\r\n')],
  ['mixed', (text) => text.replace(/\n/g, (_, offset) => offset % 2 ? '\r\n' : '\n')],
];

// Import the executable module in native Node, including its shebang and CLI guard.
function runGates(operation, ...args) {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import * as gates from ${JSON.stringify(scriptUrl)};
    console.log(JSON.stringify(gates[${JSON.stringify(operation)}](...${JSON.stringify(args)})));
  `], { encoding: 'utf8', timeout: 10_000 });
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout);
}

function documentWith(body) {
  return `Introduction\n\n${blockStart}\n\n${body}\n\n${blockEnd}\n\nConclusion\n`;
}

describe('generated gate documentation', () => {
  describe.each(documentPaths)('%s', (docPath) => {
    it.each(lineEndings)('accepts the generated block with %s line endings', (_, convert) => {
      const expected = runGates('renderDocBlock', docPath);
      const text = convert(documentWith(expected));

      expect(runGates('extractDocBlock', text)).toBe(expected);
    });
  });

  it.each(lineEndings)('round-trips a repaired %s document and preserves surrounding prose', (_, convert) => {
    const original = convert(documentWith('outdated gate content'));
    const expected = runGates('renderDocBlock', 'AGENTS.md');
    const repaired = runGates('spliceDocBlock', original, 'AGENTS.md');

    expect(runGates('extractDocBlock', repaired)).toBe(expected);
    expect(repaired.slice(0, repaired.indexOf(blockStart) + blockStart.length))
      .toBe(original.slice(0, original.indexOf(blockStart) + blockStart.length));
    expect(repaired.slice(repaired.indexOf(blockEnd)))
      .toBe(original.slice(original.indexOf(blockEnd)));
    expect(runGates('spliceDocBlock', repaired, 'AGENTS.md')).toBe(repaired);
  });

  it.each([
    ['changed command', (body) => body.replace('pnpm architecture', 'pnpm check:architecture')],
    ['missing gate', (body) => body.split('\n').filter((line) => !line.includes('pnpm typecheck')).join('\n')],
    ['changed spacing', (body) => body.replace('**Architecture and contracts**', '**Architecture and contracts** ')],
  ])('retains %s as detectable content drift', (_, change) => {
    const expected = runGates('renderDocBlock', 'AGENTS.md');
    const changed = change(expected);
    const extracted = runGates('extractDocBlock', documentWith(changed).replace(/\n/g, '\r\n'));

    expect(extracted).toBe(changed);
    expect(extracted).not.toBe(expected);
  });

  it('preserves non-newline whitespace and standalone carriage returns', () => {
    const body = ' \n\tfirst line\n\nsecond\rline \n ';

    expect(runGates('extractDocBlock', documentWith(body).replace(/\n/g, '\r\n'))).toBe(body);
  });

  it.each([
    ['both missing', 'No generated block'],
    ['start missing', `${blockEnd}\nBody`],
    ['end missing', `${blockStart}\nBody`],
    ['reversed', `${blockEnd}\nBody\n${blockStart}`],
  ])('rejects markers that are %s', (_, text) => {
    expect(runGates('extractDocBlock', text)).toBeNull();
    expect(runGates('spliceDocBlock', text, 'AGENTS.md')).toBeNull();
  });
});
