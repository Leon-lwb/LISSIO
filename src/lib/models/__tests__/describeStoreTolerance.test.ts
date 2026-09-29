import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import { tauriMock } from '../../../test/setup';
import { useAppStore } from '../../../store/appStore';
import { canvasNode } from '../../nodes/document';
import { widgetDocument } from '../../../test/nodeDocuments';
import {
  getDescribeEntry,
  resetDescribeForTests,
  startDescribeSync,
} from '../describeStore';

/** 未知 `node.type` 的画布节点 — `nodeDocument` 在此抛 "Unknown node kind"。 */
function unknownKindNode(id: string): Node {
  return {
    id,
    type: 'mystery',
    position: { x: 0, y: 0 },
    data: { tabId: 'default' },
  };
}

/** 缺 `widget.params` 的节点 — `nodeDocument` 在解构处抛 TypeError。 */
function widgetWithoutParamsNode(id: string): Node {
  return {
    id,
    type: 'widget',
    position: { x: 0, y: 0 },
    data: { tabId: 'default', widget: { kind: 'Math' } },
  };
}

/** 最近一次 describe 调用的参数对象 — 未发出时返回 undefined。 */
function lastDescribePayload(): Record<string, unknown> | undefined {
  const calls = tauriMock.invoke.mock.calls.filter(
    ([command]) => command === 'describe_node_documents',
  );
  const last = calls[calls.length - 1];
  return last?.[1];
}

/** 最近一次描述请求实际送出的文档 id — 空数组表示「请求发出但无文档」。 */
function describedIds(): string[] {
  const payload = lastDescribePayload() as { documents?: { id: string }[] } | undefined;
  return (payload?.documents ?? []).map((doc) => doc.id);
}

/** 最近一次描述请求实际送出的边 (原样, 不解释字段)。 */
function describedEdges(): Record<string, unknown>[] {
  const payload = lastDescribePayload() as { edges?: Record<string, unknown>[] } | undefined;
  return payload?.edges ?? [];
}

describe('describeStore 逐节点容错', () => {
  beforeEach(() => {
    resetDescribeForTests();
    useAppStore.setState({ rfNodes: [], rfEdges: [] });
    tauriMock.invoke.mockClear();
  });

  afterEach(() => {
    resetDescribeForTests();
    useAppStore.setState({ rfNodes: [], rfEdges: [] });
    tauriMock.invoke.mockClear();
  });

  it('一条无法投影的节点不会阻止同批其他节点被描述', async () => {
    useAppStore.setState({
      rfNodes: [canvasNode(widgetDocument('w-ok')), unknownKindNode('broken')],
    });
    startDescribeSync();

    // 修复前: documentsOfStore 抛异常 → setPending 与整批描述都不会发生
    await vi.waitFor(() => expect(describedIds()).toContain('w-ok'));
    expect(describedIds()).not.toContain('broken');

    const broken = getDescribeEntry('broken');
    expect(broken.status).toBe('unsupported');
    expect(broken.failed).toBe(true);
    expect(broken.description).toBeNull();
  });

  it('缺 widget.params 的节点同样只影响自己', async () => {
    useAppStore.setState({
      rfNodes: [widgetWithoutParamsNode('broken'), canvasNode(widgetDocument('w-ok'))],
    });
    startDescribeSync();

    await vi.waitFor(() => expect(describedIds()).toContain('w-ok'));
    await vi.waitFor(() => expect(getDescribeEntry('broken').status).toBe('unsupported'));
  });

  it('全部节点都无法投影时描述请求仍会发出, 且每个节点都有明确归属', async () => {
    useAppStore.setState({ rfNodes: [unknownKindNode('bad-a'), unknownKindNode('bad-b')] });
    startDescribeSync();

    await vi.waitFor(() =>
      expect(
        tauriMock.invoke.mock.calls.some(([command]) => command === 'describe_node_documents'),
      ).toBe(true),
    );
    await vi.waitFor(() => {
      expect(getDescribeEntry('bad-a').status).toBe('unsupported');
      expect(getDescribeEntry('bad-b').status).toBe('unsupported');
    });
  });

  it('失败节点在图更新后能重新拿到描述', async () => {
    useAppStore.setState({ rfNodes: [unknownKindNode('w-1')] });
    startDescribeSync();
    await vi.waitFor(() => expect(getDescribeEntry('w-1').failed).toBe(true));

    // 同一 id 的节点变为可投影类型后必须恢复 (失败不得是终态)
    useAppStore.setState({ rfNodes: [canvasNode(widgetDocument('w-1'))] });
    await vi.waitFor(() => expect(describedIds()).toContain('w-1'));
  });

  it('后端调用失败时错误必须可见而不是被静默吞掉', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    useAppStore.setState({ rfNodes: [canvasNode(widgetDocument('w-ok'))] });
    tauriMock.invoke.mockImplementationOnce(() =>
      Promise.reject(new Error('describe backend down')),
    );
    startDescribeSync();

    await vi.waitFor(() => expect(consoleError).toHaveBeenCalled());
    expect(String(consoleError.mock.calls[0]?.[0])).toContain('describeStore');
    consoleError.mockRestore();
  });

  it('边引用按生成的 GraphEdgeRef 形状 (snake_case) 送出', async () => {
    useAppStore.setState({
      rfNodes: [canvasNode(widgetDocument('w-ok'))],
      rfEdges: [
        {
          id: 'e1',
          source: 'w-ok',
          sourceHandle: 'rx',
          target: 'w-ok',
          targetHandle: 'src:w-ok:rx',
        },
      ],
    });
    startDescribeSync();

    await vi.waitFor(() => expect(describedEdges()).toHaveLength(1));
    // toEqual 断言全量键: 多一个 camelCase 的 sourceHandle 即失败。
    // serde 默认忽略未知字段, 手写 camelCase 不会报错 —— 只会让 source_handle
    // 退化为 None, RawData 的 src:* 动态端口随之静默消失。
    expect(describedEdges()[0]).toEqual({
      source: 'w-ok',
      source_handle: 'rx',
      target: 'w-ok',
      target_handle: 'src:w-ok:rx',
    });
  });
});
