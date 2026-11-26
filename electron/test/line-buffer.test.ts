import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLineForwarder } from '../util/line-buffer';

describe('createLineForwarder', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('joins a line split across chunks', () => {
    const lines: string[] = [];
    const f = createLineForwarder((l) => lines.push(l));
    f.push('To sign in, use a web browser to open the page https://login.microsoft.com/device and ');
    expect(lines).toEqual([]);
    f.push('enter the code ABC123XYZ to authenticate.\r\nnext');
    expect(lines).toEqual(['To sign in, use a web browser to open the page https://login.microsoft.com/device and enter the code ABC123XYZ to authenticate.']);
    f.flush();
    expect(lines[1]).toBe('next');
  });

  it('flushes a prompt without a trailing newline after the idle delay', () => {
    const lines: string[] = [];
    const f = createLineForwarder((l) => lines.push(l), 250);
    f.push('waiting for sign-in');
    vi.advanceTimersByTime(300);
    expect(lines).toEqual(['waiting for sign-in']);
  });

  it('keeps stdout and stderr separate when each has its own forwarder', () => {
    const out: string[] = [];
    const a = createLineForwarder((l) => out.push(l));
    const b = createLineForwarder((l) => out.push(l));
    a.push('abc'); b.push('xyz\n'); a.push('def\n');
    expect(out).toEqual(['xyz', 'abcdef']);
  });
});
