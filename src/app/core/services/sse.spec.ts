import { describe, expect, it } from 'vitest';
import { parseSse } from './sse';

describe('parseSse', () => {
  it('reads the frames the backend sends', () => {
    const { messages, rest } = parseSse('event:ready\ndata:ok\n\nevent:change\ndata:{"type":"finance","id":"a"}\n\n');
    expect(messages).toEqual([
      { event: 'ready', data: 'ok' },
      { event: 'change', data: '{"type":"finance","id":"a"}' },
    ]);
    expect(rest).toBe('');
  });

  it('keeps a half-received frame until its blank line arrives', () => {
    const first = parseSse('event:change\ndata:{"type":"fin');
    expect(first.messages).toEqual([]);
    const second = parseSse(first.rest + 'ance","id":null}\n\n');
    expect(second.messages).toEqual([{ event: 'change', data: '{"type":"finance","id":null}' }]);
  });

  it('ignores the keep-alive comment', () => {
    expect(parseSse(': keep-alive\n\n').messages).toEqual([]);
    expect(parseSse(':keep-alive\n\nevent:change\ndata:x\n\n').messages).toEqual([{ event: 'change', data: 'x' }]);
  });

  it('accepts CRLF line endings, a space after the colon, and multi-line data', () => {
    const { messages } = parseSse('event: change\r\ndata: one\r\ndata: two\r\n\r\n');
    expect(messages).toEqual([{ event: 'change', data: 'one\ntwo' }]);
  });

  it('calls a frame with no event name a message', () => {
    expect(parseSse('data: hello\n\n').messages).toEqual([{ event: 'message', data: 'hello' }]);
  });
});
