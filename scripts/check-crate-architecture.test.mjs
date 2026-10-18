import { describe, expect, it } from 'vitest';

import { declaresInlineTestModule, parseLayerTable } from './check-crate-architecture.mjs';

/**
 * Self-test for the inline-`#[cfg(test)]` matcher.
 *
 * The rule (`docs/architecture/crates.md`, "Test layout") is that no production
 * file may keep `#[cfg(test)] mod x { ... }`. The matcher used to require a line
 * whose trimmed text was exactly `#[cfg(test)]`, so the one-line and
 * trailing-comment forms passed the gate while violating it — a latent bypass
 * with no live instance. These fixtures pin both shapes.
 */
describe('inline #[cfg(test)] module detection', () => {
  it.each([
    ['bare attribute line', ['#[cfg(test)]', 'mod tests {', '}'], 0],
    ['one line', ['#[cfg(test)] mod tests {', '}'], 0],
    ['one line, public module', ['#[cfg(test)] pub mod tests {', '}'], 0],
    ['trailing line comment', ['#[cfg(test)] // unit tests', 'mod tests {', '}'], 0],
    ['trailing block comment', ['#[cfg(test)] /* unit tests */ mod tests {', '}'], 0],
    ['another attribute between', ['#[cfg(test)]', '#[allow(dead_code)]', 'mod tests {', '}'], 0],
    ['comment line between', ['#[cfg(test)]', '// unit tests', 'mod tests {', '}'], 0],
    ['two attributes on one line', ['#[cfg(test)] #[allow(clippy::all)] mod tests {', '}'], 0],
  ])('flags the %s form', (_, lines, index) => {
    expect(declaresInlineTestModule(lines, index)).toBe(true);
  });

  it.each([
    ['an external module file', ['#[cfg(test)]', 'mod tests;'], 0],
    ['a test-only function', ['#[cfg(test)]', 'fn helper() {}'], 0],
    ['a test-only import', ['#[cfg(test)]', 'use super::*;'], 0],
    ['a nested attribute inside a module body', ['mod tests {', '#[cfg(test)]', 'fn helper() {}', '}'], 1],
    ['the end of the file', ['#[cfg(test)]'], 0],
  ])('accepts %s', (_, lines, index) => {
    expect(declaresInlineTestModule(lines, index)).toBe(false);
  });
});

describe('layer-table parsing', () => {
  it('reads crate names and layers from the documented matrix', () => {
    const text = [
      '| Domain | Layers present |',
      '|---|---|',
      '| shared | L0: `error`, `flow` |',
      '| desktop | L2: `pipeline`; L5: `backend-server`, `backend-cli` |',
      '',
      '| Domain | Crates |',
      '|---|---|',
      '| shared | `error` |',
    ].join('\n');

    const table = parseLayerTable(text);
    expect(table.crates.get('error')).toEqual({ domain: 'shared', layer: 0 });
    expect(table.crates.get('flow')).toEqual({ domain: 'shared', layer: 0 });
    expect(table.crates.get('pipeline')).toEqual({ domain: 'desktop', layer: 2 });
    expect(table.crates.get('backend-cli')).toEqual({ domain: 'desktop', layer: 5 });
    expect(table.crates.has('shared')).toBe(false);
    expect(table.domains.get('desktop')).toEqual(new Set([2, 5]));
  });

  it('returns null when the matrix is missing', () => {
    expect(parseLayerTable('# Architecture\n\nNo table here.')).toBeNull();
  });
});
