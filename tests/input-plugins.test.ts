import {afterEach, expect, it, vi} from 'vitest';
import {createChatView, createOperationLedger, InputPluginRegistry} from '../src';
import type {InputPlugin, InputPluginContext, ComposerDraft, ChatView, ConversationSnapshot} from '../src';
const views: ChatView[] = [];
afterEach(async () => {for (const view of views.splice(0)) await view.destroy().catch(() => {}); vi.restoreAllMocks(); document.body.replaceChildren();});
function context(): InputPluginContext {
    const textarea = document.createElement('textarea');
    return {textarea, container: document.createElement('div'), getText: () => textarea.value, setText: value => {textarea.value = value;},
        insertAtCursor() {}, replaceRange() {}, getCursorPosition: () => 0, setCursorPosition() {}, triggerSend() {}, focus() {}};
}
it('orders hooks, short-circuits keys and before-send, and keeps IME outside command handling', () => {
    const registry = new InputPluginRegistry(), called: string[] = [];
    const make = (id: string, priority: number): InputPlugin => ({id, priority, activate() {}, deactivate() {},
        onKeyDown: () => {called.push(id); return true;}, onBeforeSend: () => {called.push(id); return false;}});
    registry.register(make('last', 10)); registry.register(make('first', 1)); registry.setContext(context());
    expect(registry.key(new KeyboardEvent('keydown', {key: 'Enter', isComposing: true}))).toBe(false); expect(called).toEqual([]);
    expect(registry.key(new KeyboardEvent('keydown', {key: 'Enter'}))).toBe(true); expect(called).toEqual(['first']);
    called.length = 0; expect(registry.beforeSend('private')).toBe(false); expect(called).toEqual(['first']); registry.destroy();
});
it('preserves retained plugins on rollback and releases removed or failed plugins once', () => {
    const registry = new InputPluginRegistry(), activate = vi.fn(), deactivate = vi.fn();
    const first = {id: 'first', activate, deactivate}, extra = {id: 'extra', activate: vi.fn(), deactivate: vi.fn()};
    registry.register(first); registry.setContext(context()); registry.register(extra); registry.replace([first], true);
    expect(activate).toHaveBeenCalledOnce(); expect(extra.deactivate).toHaveBeenCalledOnce();
    registry.destroy(); registry.destroy(); expect(deactivate).toHaveBeenCalledOnce();
});
it('releases every plugin after an activation failure and reports only safe diagnostic metadata', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {}), registry = new InputPluginRegistry();
    const deactivate = vi.fn(), failed = vi.fn();
    registry.register({id: 'first', activate() {}, deactivate});
    registry.register({id: 'failed', activate() {throw new Error('PRIVATE_INPUT');}, deactivate: failed});
    expect(() => registry.setContext(context())).toThrow('PRIVATE_INPUT'); registry.destroy();
    expect(deactivate).toHaveBeenCalledOnce(); expect(failed).toHaveBeenCalledOnce();
    expect(JSON.stringify(warn.mock.calls)).not.toContain('PRIVATE_INPUT');
    expect(warn.mock.calls[0][1]).toMatchObject({stage: 'activate', result: 'failure', pluginId: 'failed', operationId: expect.any(String)});
});
it('runs acceptance hooks once on durable acceptance and deactivates binding-owned plugins', async () => {
    const root = document.createElement('div'); document.body.append(root);
    const ledger = createOperationLedger(), after = vi.fn(), deactivate = vi.fn(), before = vi.fn().mockReturnValueOnce(false).mockReturnValue(true);
    const snapshot: ConversationSnapshot = {conversationId: 'c', viewId: 'v', revision: 0, title: '', messages: [], interactions: [], loading: false,
        execution: 'idle', connection: 'online', hasEarlier: false, allowed: ['send']};
    const send = vi.fn(async (_input, context) => ({status: 'accepted' as const, operationId: context.operationId}));
    const plugin: InputPlugin<InputPluginContext, ComposerDraft> = {id: 'history', activate() {}, deactivate, onBeforeSend: before, onAfterSend: after};
    const view = await createChatView(root, {source: {getSnapshot: () => snapshot, subscribe: () => () => {}}, operations: ledger,
        actions: {send, reconcile: async operationId => ({status: 'unknown', operationId, message: 'Pending'})}, plugins: [plugin]}); views.push(view);
    view.setText('First'); await view.submit(); expect(send).not.toHaveBeenCalled();
    await view.submit(); expect(send).toHaveBeenCalledOnce(); expect(after).toHaveBeenCalledOnce(); expect(after).toHaveBeenCalledWith('First', expect.objectContaining({text: 'First'}));
    await ledger.settle({status: 'accepted', operationId: ledger.getSnapshot()[0].context.operationId}); expect(after).toHaveBeenCalledOnce();
    await view.destroy(); expect(deactivate).toHaveBeenCalledOnce();
});
