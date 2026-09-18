#!/usr/bin/env node
// backend-cli serve 的极简 MCP 客户端 (Streamable HTTP)。
//
// 压测只需要少数生命周期/观测调用, 因此每次调用独立握手 (initialize →
// notifications/initialized → tools/call), 无会话状态, 便于 bash 编排。
// 与 CLI 子命令同源的工具经由 serve 进程内的 control-api 执行。
//
// 用法:
//   node scripts/stress/mcp.mjs [--port 18765] open <node_id>
//   node scripts/stress/mcp.mjs [--port 18765] close <endpoint_id>
//   node scripts/stress/mcp.mjs [--port 18765] run <start|pause|stop>
//   node scripts/stress/mcp.mjs [--port 18765] buffer <source>
//   node scripts/stress/mcp.mjs [--port 18765] raw <source> [max_bytes]
//   node scripts/stress/mcp.mjs [--port 18765] call <tool> [json-arguments]
//
// 成功: 把工具返回的 content 文本原样写到 stdout; 失败: 原因到 stderr, 退出码 1。

function parseArgs(argv) {
  const options = { port: 18_765 };
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--port') {
      i += 1;
      options.port = Number(argv[i]);
      if (!(options.port > 0)) throw new Error('--port 必须是正整数');
    } else {
      positional.push(argv[i]);
    }
  }
  return { options, positional };
}

async function rpc(port, body, session) {
  const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(session ? { 'mcp-session-id': session } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }
  const text = await response.text();
  const messages = [];
  // rmcp 的 Streamable HTTP 以 SSE data: 行返回; 兼容纯 JSON 响应。
  if (text.includes('data:')) {
    for (const line of text.split('\n')) {
      if (line.startsWith('data:')) {
        const payload = line.slice(5).trim();
        if (payload) messages.push(JSON.parse(payload));
      }
    }
  } else if (text.trim()) {
    messages.push(JSON.parse(text));
  }
  return { messages, session: response.headers.get('mcp-session-id') ?? session };
}

async function callTool(port, tool, args) {
  const init = await rpc(port, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'lissio-bench-stress', version: '0.0.0' },
    },
  });
  const initReply = init.messages.find(message => message.id === 1);
  if (!initReply) throw new Error('initialize 无响应');
  if (initReply.error) throw new Error(`initialize 失败: ${initReply.error.message}`);
  await rpc(port, { jsonrpc: '2.0', method: 'notifications/initialized' }, init.session);
  const call = await rpc(
    port,
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: tool, arguments: args } },
    init.session,
  );
  const reply = call.messages.find(message => message.id === 2);
  if (!reply) throw new Error(`tools/call ${tool} 无响应`);
  if (reply.error) throw new Error(reply.error.message ?? JSON.stringify(reply.error));
  const payload = reply.result;
  if (payload.isError) throw new Error(payload.content?.[0]?.text ?? `${tool} 执行失败`);
  return (payload.content ?? []).map(part => part.text ?? '').join('');
}

const { options, positional } = parseArgs(process.argv.slice(2));
const [command, first, second] = positional;
const tools = {
  open: ['open_endpoint', () => ({ node_id: first })],
  close: ['close_endpoint', () => ({ endpoint_id: first })],
  run: ['run_workspace', () => ({ action: first })],
  buffer: ['get_buffer_info', () => ({ source: first })],
  raw: ['get_raw_data', () => ({ source: first, max_bytes: Number(second ?? 4096) })],
  call: [first, () => JSON.parse(second ?? '{}')],
};
const entry = tools[command];
if (!entry) {
  console.error(`未知命令: ${command ?? '(缺省)'} — 可用: ${Object.keys(tools).join(' / ')}`);
  process.exit(2);
}
try {
  process.stdout.write(`${callTool(options.port, entry[0], entry[1()])}\n`);
} catch (cause) {
  console.error(`mcp ${command} 失败: ${cause.message ?? cause}`);
  process.exit(1);
}
