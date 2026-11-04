import {afterEach, expect, it, vi} from 'vitest';
import {ExecutionNotice} from '../src/execution-notice';

afterEach(() => {vi.useRealTimers(); vi.restoreAllMocks();});
it('keeps a visible stage notice and a separate clock, then clears both when the stage ends', () => {
    vi.useFakeTimers(); vi.setSystemTime(10000);
    const notice = new ExecutionNotice(seconds => `Waiting ${seconds}s`);
    try {
        document.body.append(notice.element);
        notice.update({message: 'Compacting context', updatedAt: 8000});
        expect(notice.element.hidden).toBe(false); expect(notice.element.textContent).toContain('Waiting 2s');
        expect(notice.element.querySelector('[role="status"]')?.textContent).toBe('Compacting context');
        expect(notice.element.querySelector('[aria-live="off"]')).not.toBeNull();
        vi.advanceTimersByTime(3000); expect(notice.element.textContent).toContain('Waiting 5s');
        notice.update(undefined); expect(notice.element.hidden).toBe(true); expect(vi.getTimerCount()).toBe(0);
        notice.update({message: 'Compacting context'}, false); expect(notice.element.hidden).toBe(true);
        notice.update({message: 'Compacting context', updatedAt: 8000}); notice.destroy();
        expect(vi.getTimerCount()).toBe(0); expect(notice.element.isConnected).toBe(false);
    } finally {notice.destroy();}
});
