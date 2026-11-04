import {afterEach, expect, it, vi} from 'vitest';
import {ExecutionStatus} from '../src/execution-status';
import {translator} from '../src/i18n';
import type {ConversationSnapshot} from '../src/contracts';

const instances: ExecutionStatus[] = [];
afterEach(() => {instances.forEach(status => status.destroy()); instances.length = 0; vi.useRealTimers(); vi.restoreAllMocks();});
function fixture() {
    vi.useFakeTimers(); vi.setSystemTime(10_000);
    const element = document.createElement('span'), status = new ExecutionStatus(element, translator());
    instances.push(status);
    const state: ConversationSnapshot = {conversationId: 'c', viewId: 'v', revision: 1, title: '', messages: [], interactions: [],
        loading: false, execution: 'running', executionRef: 'turn', connection: 'online', hasEarlier: false, allowed: [],
        executionActivity: {label: '正在思考', updatedAt: 8_000}};
    return {element, status, state};
}
it('updates only elapsed text and stops after completion or destruction', () => {
    const f = fixture(); f.status.update(f.state, true);
    expect(f.element.textContent).toBe('已连接 · 正在思考 · 最近活动 2 秒前');
    expect(f.element.dataset.executionActivity).toBe('true');
    vi.advanceTimersByTime(3000); expect(f.element.textContent).toContain('5 秒前');
    f.status.update({...f.state, execution: 'idle'}, true);
    expect(f.element.textContent).toBe('已连接'); expect(vi.getTimerCount()).toBe(0);
    expect(f.element.dataset.executionActivity).toBe('false');
    f.status.update(f.state, true); f.status.destroy(); expect(vi.getTimerCount()).toBe(0);
});
it('pauses hidden or inactive views and resumes using the original activity time', () => {
    const f = fixture(); f.status.update(f.state, false); expect(vi.getTimerCount()).toBe(0);
    f.status.update(f.state, true); expect(vi.getTimerCount()).toBe(1);
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true); document.dispatchEvent(new Event('visibilitychange'));
    expect(vi.getTimerCount()).toBe(0); vi.advanceTimersByTime(5000);
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false); document.dispatchEvent(new Event('visibilitychange'));
    expect(f.element.textContent).toContain('7 秒前'); expect(vi.getTimerCount()).toBe(1);
});
it('does not invent activity timestamps or replace errors with a running clock', () => {
    const f = fixture(); f.status.update({...f.state, executionActivity: {label: '执行中'}}, true);
    expect(f.element.textContent).toBe('已连接 · 执行中'); expect(vi.getTimerCount()).toBe(0);
    f.status.update({...f.state, error: {code: 'EIO', message: '更新失败'}}, true);
    expect(f.element.textContent).toBe('更新失败'); expect(vi.getTimerCount()).toBe(0);
});
