import type { ChatStreamEvent, Citation } from '@ai-document-chatbot/shared';
import { serverCode } from './chat-errors';

/** One server-sent event: its `event:` name and its (joined) `data:` lines. */
export interface SseMessage {
  event: string;
  data: string;
}

/**
 * Incremental parser for a `text/event-stream` body. Network chunks can end in
 * the middle of an event (or a line) or hold several events, so text is
 * buffered until a blank line completes an event.
 */
export class SseParser {
  private buffer = '';

  /** Feeds decoded text; returns the events it completed. */
  push(chunk: string): SseMessage[] {
    this.buffer += chunk;
    // A `\r` at the very end may be half of a `\r\n`: wait for the next chunk.
    const end = this.buffer.endsWith('\r')
      ? this.buffer.length - 1
      : this.buffer.length;
    const text = this.buffer.slice(0, end).replace(/\r\n?/g, '\n');
    const blocks = text.split('\n\n');
    // The last block has no terminating blank line yet.
    this.buffer = (blocks.pop() ?? '') + this.buffer.slice(end);
    return blocks.flatMap((block) => {
      const message = parseBlock(block);
      return message ? [message] : [];
    });
  }

  /** The stream ended: parses an event left without its trailing blank line. */
  flush(): SseMessage[] {
    const rest = this.buffer.replace(/\r\n?/g, '\n');
    this.buffer = '';
    const message = parseBlock(rest);
    return message ? [message] : [];
  }
}

function parseBlock(block: string): SseMessage | null {
  let event = 'message';
  const data: string[] = [];
  for (const line of block.split('\n')) {
    if (!line || line.startsWith(':')) continue; // blank or comment
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
  }
  return data.length ? { event, data: data.join('\n') } : null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function isCitation(value: unknown): value is Citation {
  return (
    isRecord(value) &&
    typeof value['number'] === 'number' &&
    typeof value['documentId'] === 'string' &&
    typeof value['documentName'] === 'string' &&
    typeof value['page'] === 'number' &&
    typeof value['snippet'] === 'string'
  );
}

/**
 * Validates an SSE message as a {@link ChatStreamEvent}. Returns null for
 * malformed JSON or unknown shapes, which callers skip.
 */
export function toChatStreamEvent(message: SseMessage): ChatStreamEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(message.data);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const type = parsed['type'] ?? message.event;
  switch (type) {
    case 'start':
      return typeof parsed['conversationId'] === 'string'
        ? { type: 'start', conversationId: parsed['conversationId'] }
        : null;
    case 'delta':
      return typeof parsed['text'] === 'string'
        ? { type: 'delta', text: parsed['text'] }
        : null;
    case 'done': {
      const { modelId, conversationId, citations } = parsed;
      if (typeof modelId !== 'string' || typeof conversationId !== 'string') {
        return null;
      }
      return {
        type: 'done',
        modelId: modelId as Extract<
          ChatStreamEvent,
          { type: 'done' }
        >['modelId'],
        conversationId,
        citations: Array.isArray(citations) ? citations.filter(isCitation) : [],
      };
    }
    case 'error': {
      const { status, message: text, conversationId } = parsed;
      const code = serverCode(parsed);
      return {
        type: 'error',
        status: typeof status === 'number' ? status : 500,
        message: typeof text === 'string' ? text : '',
        ...(typeof conversationId === 'string' ? { conversationId } : {}),
        ...(code ? { code } : {}),
      };
    }
    default:
      return null;
  }
}
