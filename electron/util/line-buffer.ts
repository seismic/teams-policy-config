/**
 * Splits streamed process output into complete lines, carrying a partial trailing line over to the
 * next chunk. A prompt that arrives in several chunks, or without a trailing newline, is still
 * forwarded as one line: the partial line is flushed after `idleMs` without new data, and on close.
 */
export function createLineForwarder(onLine: (line: string) => void, idleMs: number = 250) {
    let pending = '';
    let timer: ReturnType<typeof setTimeout> | undefined;

    const emit = (line: string) => {
        const trimmed = line.trim();
        if (trimmed) {
            onLine(trimmed);
        }
    };

    const clearTimer = () => {
        if (timer) {
            clearTimeout(timer);
            timer = undefined;
        }
    };

    const flush = () => {
        clearTimer();
        const rest = pending;
        pending = '';
        emit(rest);
    };

    return {
        push(text: string) {
            clearTimer();
            const parts = (pending + text).split(/\r?\n/);
            pending = parts.pop() ?? '';
            parts.forEach(emit);
            if (pending) {
                timer = setTimeout(flush, idleMs);
            }
        },
        flush,
    };
}
