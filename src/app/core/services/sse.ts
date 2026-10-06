/** One Server-Sent Events frame. */
export interface SseMessage {
  event: string;
  data: string;
}

/**
 * Splits a buffer of Server-Sent Events text into complete frames and whatever
 * trailing text is still waiting for its blank line.
 *
 * `EventSource` would do this for us, but it cannot send an `Authorization`
 * header, so the stream is read with `fetch` and parsed here. Follows the
 * wire format: frames end at a blank line; lines starting with `:` are comments
 * (the server's keep-alive); several `data:` lines join with a newline; a frame
 * with no `event:` is a plain `message`. Both `\n` and `\r\n` are accepted.
 */
export function parseSse(buffer: string): { messages: SseMessage[]; rest: string } {
  const text = buffer.replace(/\r\n/g, '\n');
  const frames = text.split('\n\n');
  const rest = frames.pop() ?? '';
  const messages: SseMessage[] = [];
  for (const frame of frames) {
    let event = 'message';
    const data: string[] = [];
    for (const line of frame.split('\n')) {
      if (line === '' || line.startsWith(':')) {
        continue;
      }
      const colon = line.indexOf(':');
      const field = colon === -1 ? line : line.slice(0, colon);
      const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');
      if (field === 'event') {
        event = value;
      } else if (field === 'data') {
        data.push(value);
      }
    }
    // A frame of only comments (a keep-alive) carries nothing to deliver.
    if (data.length > 0 || event !== 'message') {
      messages.push({ event, data: data.join('\n') });
    }
  }
  return { messages, rest };
}
