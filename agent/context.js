import env from '../config/env.js';

const MESSAGE_OVERHEAD_CHARS = 32;
const DEFAULT_KEEP_RECENT = 3;

export function estimateSize(messages) {
  return messages.reduce((sum, message) => sum + messageSize(message), 0);
}

function messageSize(message) {
  let size = typeof message.content === 'string' ? message.content.length : 0;
  if (Array.isArray(message.tool_calls)) {
    for (const call of message.tool_calls) {
      size += call.function?.name?.length || 0;
      size += call.function?.arguments?.length || 0;
    }
  }
  return size + MESSAGE_OVERHEAD_CHARS;
}

function buildToolCallIndex(messages) {
  const index = new Map();
  for (const message of messages) {
    if (!Array.isArray(message.tool_calls)) continue;
    for (const call of message.tool_calls) {
      let input;
      try {
        input = JSON.parse(call.function?.arguments || '{}');
      } catch {
        input = undefined;
      }
      index.set(call.id, { name: call.function?.name, input });
    }
  }
  return index;
}

function compressToolContent(content, callInfo) {
  let rowCount;
  try {
    const parsed = JSON.parse(content);
    rowCount = parsed?.rowCount ?? (Array.isArray(parsed?.data) ? parsed.data.length : undefined);
  } catch {
    // non-JSON tool output; omit rowCount
  }

  const stub = {
    compressed: true,
    tool: callInfo?.name,
    ...(callInfo?.input !== undefined ? { input: callInfo.input } : {}),
    ...(rowCount !== undefined ? { rowCount } : {}),
    note: 'Older result removed from context to save tokens. Re-run this tool if you need this data again.',
  };
  return JSON.stringify(stub);
}

export function compressHistory(messages, options = {}) {
  const maxChars = options.maxChars ?? env.MAX_CONTEXT_CHARS;
  const keepRecent = options.keepRecent ?? DEFAULT_KEEP_RECENT;

  if (estimateSize(messages) <= maxChars) {
    return messages;
  }

  const toolCallIndex = buildToolCallIndex(messages);

  const toolPositions = [];
  messages.forEach((message, i) => {
    if (message.role === 'tool') toolPositions.push(i);
  });

  const toCompress = new Set(
    toolPositions.slice(0, Math.max(0, toolPositions.length - keepRecent)),
  );

  return messages.map((message, i) => {
    if (!toCompress.has(i)) return message;
    const callInfo = toolCallIndex.get(message.tool_call_id);
    return { ...message, content: compressToolContent(message.content, callInfo) };
  });
}
