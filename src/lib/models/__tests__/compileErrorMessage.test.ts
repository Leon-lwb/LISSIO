import { describe, expect, it } from 'vitest';
import { compileErrorMessage } from '../compileErrorMessage';

// 这些文案是后端 `error::CompileError` 各分支的唯一呈现。用例逐个钉住分支,
// 因为 switch 的 `default` 会在新增 kind 时静默兜底成 'Compile error' ——
// 编译期不会报错, 界面上只是少了一句话。

describe('compileErrorMessage — 每条错误都翻译成一句话', () => {
  it('value_cycle: 打印环路节点序列', () => {
    expect(compileErrorMessage({ kind: 'value_cycle', cycle: ['a', 'b', 'c'] }, 'a'))
      .toBe('Value cycle: a → b → c');
  });

  it('byte_cycle: 同样打印环路节点序列', () => {
    expect(compileErrorMessage({ kind: 'byte_cycle', cycle: ['x', 'y'] }, 'x'))
      .toBe('Byte cycle: x → y');
  });

  it('domain_mismatch: 命中源节点时描述"输出口 + 域"', () => {
    const err = {
      kind: 'domain_mismatch',
      edge_id: 'e1',
      source_node: 'n1',
      source_port: 'out',
      src_domain: 'f32',
      target: 'n2',
      target_port: 'in',
      tgt_domain: 'bytes',
    } as const;
    expect(compileErrorMessage(err, 'n1')).toBe('Domain mismatch on out out (f32)');
  });

  it('domain_mismatch: 命中目标节点时描述"输入口 + 域"', () => {
    const err = {
      kind: 'domain_mismatch',
      edge_id: 'e1',
      source_node: 'n1',
      source_port: 'out',
      src_domain: 'f32',
      target: 'n2',
      target_port: 'in',
      tgt_domain: 'bytes',
    } as const;
    expect(compileErrorMessage(err, 'n2')).toBe('Domain mismatch on in in (bytes)');
  });

  it('domain_mismatch: 两个端点都不是该节点时描述整条边', () => {
    const err = {
      kind: 'domain_mismatch',
      edge_id: 'e1',
      source_node: 'n1',
      source_port: 'out',
      src_domain: 'f32',
      target: 'n2',
      target_port: 'in',
      tgt_domain: 'bytes',
    } as const;
    // 该图里有其它节点出错, 本节点同属一个 tab 时仍要能读到消息, 只是措辞不同
    expect(compileErrorMessage(err, 'n9')).toBe('Domain mismatch: out(f32) → in(bytes)');
  });

  it('node_not_found: 区分"就是本节点"与"是别人"', () => {
    expect(compileErrorMessage({ kind: 'node_not_found', id: 'n1' }, 'n1'))
      .toBe('Node not found in compiled graph');
    expect(compileErrorMessage({ kind: 'node_not_found', id: 'n7' }, 'n1'))
      .toBe('Node "n7" not found');
  });

  it('port_not_found: 命中本节点时标出输入/输出方向', () => {
    expect(compileErrorMessage(
      { kind: 'port_not_found', edge_id: 'e1', node_id: 'n1', port: 'p', output: true }, 'n1',
    )).toBe('Output port "p" is not declared');
    expect(compileErrorMessage(
      { kind: 'port_not_found', edge_id: 'e1', node_id: 'n1', port: 'p', output: false }, 'n1',
    )).toBe('Input port "p" is not declared');
  });

  it('port_not_found: 指向别的节点时点名那个节点', () => {
    expect(compileErrorMessage(
      { kind: 'port_not_found', edge_id: 'e1', node_id: 'n5', port: 'q', output: true }, 'n1',
    )).toBe('Port "q" is not declared by node "n5"');
  });
});
