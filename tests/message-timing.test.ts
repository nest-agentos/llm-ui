import {afterEach, expect, it, vi} from 'vitest';
import {ContentView} from '@nestos/mdxeditor';
import {MessageTiming} from '../src/message-timing';
import {translator} from '../src/i18n';
import type {ChatMessage} from '../src/contracts';
afterEach(() => {vi.useRealTimers(); vi.restoreAllMocks(); document.body.replaceChildren();});
const base: ChatMessage = {id: 'a', role: 'assistant', state: 'streaming', revision: 0, parts: []};
function setup() {
    const view = new ContentView({labels: {expand: 'Expand', collapse: 'Collapse', details: 'Details'}});
    const timing = new MessageTiming(view, translator()); return {view, timing};
}
it('shows the prompt instant, and response completion only after authoritative completion', () => {
    const {view, timing} = setup(), start = 1791458565000;
    timing.update({...base, role: 'user', state: 'complete', timing: {submittedAt: start}});
    expect(view.time.textContent).toContain('发送于');
    timing.update({...base, timestamp: start}); expect(view.time.textContent).toContain('记录于');
    timing.update({...base, state: 'complete', timing: {startedAt: start, completedAt: start + 11000, scope: 'turn'}});
    expect(view.time.textContent).toContain('完成于'); expect(view.status.textContent).toContain('本轮耗时 11 秒');
    expect(view.time.dateTime).toBe(new Date(start + 11000).toISOString()); timing.destroy(); view.destroy();
});
it('keeps missing completion unknown, distinguishes failures, and stops the live clock while hidden', () => {
    vi.useFakeTimers(); vi.setSystemTime(1791458570000);
    const {view, timing} = setup(), start = Date.now() - 5000;
    timing.update({...base, timing: {startedAt: start}}); expect(view.status.textContent).toContain('5 秒');
    timing.setActive(false); expect(vi.getTimerCount()).toBe(0);
    timing.update({...base, state: 'complete'}); expect(view.timing.hidden).toBe(true);
    timing.update({...base, state: 'failed', timing: {startedAt: start, endedAt: start + 3000}});
    expect(view.time.textContent).toContain('失败于'); expect(view.time.textContent).not.toContain('完成于');
    timing.destroy(); view.destroy(); expect(vi.getTimerCount()).toBe(0);
});
it('shows host recovery status without inventing execution completion or changing the pending state', () => {
    const {view, timing} = setup();
    timing.update({...base, role: 'user', state: 'pending', statusLabel: '需要恢复', timestamp: 1791458565000});
    expect(view.status.textContent).toBe('需要恢复'); expect(view.time.textContent).toContain('发送于');
    expect(view.time.textContent).not.toContain('完成于'); timing.destroy(); view.destroy();
});
