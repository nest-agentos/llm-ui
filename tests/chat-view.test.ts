import { afterEach, describe, expect, it, vi } from 'vitest';
import { createChatView, createOperationLedger, composeCommandCatalogs } from '../src';
import type { ChatOptions, ChatView, ConversationSnapshot, OperationReceipt, OperationRecord } from '../src';

const destroyed = vi.hoisted(() => vi.fn());
vi.mock('@nestos/mdxeditor', async importOriginal => ({
    ...await importOriginal<typeof import('@nestos/mdxeditor')>(),
    AssetResolverPlugin: class {},
    MDxRenderer: class {
        markedExtensions: unknown[] = [];
        usePlugin() { return this; }
        async render(node: HTMLElement, text: string) { node.textContent = text; }
        async renderStreaming(node: HTMLElement, text: string) { node.textContent = text; }
        destroy() { destroyed(); }
    },
    DefaultPrintService: class { async printFromHtml() {} destroy() {} },
}));
const views: ChatView[] = [];
it('releases the shared input resize listener when host header initialization fails', async () => {
    const added = vi.spyOn(globalThis, 'addEventListener'), removed = vi.spyOn(globalThis, 'removeEventListener');
    const host = fixture({mountHeader: () => {throw new Error('HEADER_UNAVAILABLE');}});
    try {
        await expect(host.open()).rejects.toThrow('HEADER_UNAVAILABLE');
        const listeners = added.mock.calls.filter(([type]) => type === 'resize').map(([, listener]) => listener);
        expect(listeners.length).toBeGreaterThan(0);
        for (const listener of listeners) expect(removed.mock.calls.some(([type, stopped]) => type === 'resize' && stopped === listener)).toBe(true);
        expect(host.host.querySelector('.llm-chat')).toBeNull();
    } finally {added.mockRestore(); removed.mockRestore();}
});
it('keeps a paging failure in the shared directory until an explicit successful retry', async () => {
    const read = vi.fn().mockRejectedValueOnce(new Error('HISTORY_PAGE_UNAVAILABLE')).mockResolvedValue(undefined);
    const host = fixture({onError: vi.fn(), actions: {loadEarlier: read}}); host.publish({hasEarlier: true});
    await host.open(); host.host.querySelector<HTMLButtonElement>('[data-chat-action="prompts"]')!.click();
    const earlier = host.host.querySelector<HTMLButtonElement>('.llm-prompt-nav [data-action="earlier"]')!;
    earlier.click();
    await vi.waitFor(() => expect(host.host.querySelector('.llm-prompt-nav__scope')!.textContent).toContain('HISTORY_PAGE_UNAVAILABLE'));
    host.publish({title: 'Unrelated update'}); expect(read).toHaveBeenCalledOnce();
    expect(host.host.querySelector('.llm-prompt-nav__scope')!.textContent).toContain('HISTORY_PAGE_UNAVAILABLE');
    earlier.click(); await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(earlier.disabled).toBe(false));
    expect(host.host.querySelector('.llm-prompt-nav__scope')!.textContent).not.toContain('HISTORY_PAGE_UNAVAILABLE');
});
it('keeps IME confirmation out of command completion and uses the shared question directory', async () => {
    const host = fixture({actions: {command: vi.fn(), reconcile: vi.fn()}});
    host.publish({allowed: ['command'], commands: composeCommandCatalogs([{source: {id: 'host', label: 'Host'}, commands: [
        {id: 'command', revision: 1, name: 'command', description: '', kind: 'action'},
    ]}]), messages: [{id: 'question', revision: 0, role: 'user', state: 'complete', parts: [{id: 'text', kind: 'markdown', text: 'Find this question'}]}]});
    const view = await host.open(); view.setText('/com');
    host.host.querySelector('textarea')!.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', isComposing: true, bubbles: true, cancelable: true}));
    expect(view.getDraft().text).toBe('/com'); expect(host.options.actions.command).not.toHaveBeenCalled();
    host.host.querySelector<HTMLButtonElement>('[data-chat-action="prompts"]')!.click();
    expect(host.host.querySelector('.llm-prompt-nav [data-prompt-id="question"]')!.textContent).toContain('Find this question');
    view.setActive(false); expect((host.host.querySelector('.llm-prompt-nav') as HTMLElement).hidden).toBe(true);
});
it('retains a replacement image when the earlier content version is accepted', async () => {
    const accepted = deferred<OperationReceipt>();
    const send = vi.fn((_input, context) => accepted.promise.then(() => ({status: 'accepted' as const, operationId: context.operationId})));
    const imageEditing = {edit: vi.fn(async () => [{id: 'image', expectedFileId: 'old', expectedRevision: 0,
        file: {id: 'new', name: 'new.png', mimeType: 'image/png'}}])};
    const host = fixture({initialDraft: {revision: 1, textRevision: 1, text: 'Image', attachments: [
        {id: 'image', file: {id: 'old', name: 'old.png', mimeType: 'image/png'}},
    ]}, imageEditing, actions: {send, reconcile: vi.fn()}});
    const view = await host.open(), submitting = view.submit();
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    host.host.querySelector<HTMLButtonElement>('[data-attachment-id=image] button')!.click();
    await vi.waitFor(() => expect(view.getDraft().attachments[0].file.id).toBe('new'));
    accepted.resolve({status: 'accepted', operationId: 'unused'}); await submitting;
    expect(view.getDraft().attachments).toMatchObject([{id: 'image', revision: 1, file: {id: 'new'}}]);
});
it('rejects an image replacement if its attachment was removed while the editor was open', async () => {
    const result = deferred<readonly {id: string; expectedFileId: string; expectedRevision: number; file: {id: string; name: string}}[]>();
    const host = fixture({initialDraft: {revision: 1, textRevision: 0, text: '', attachments: [
        {id: 'image', file: {id: 'old', name: 'old.png', mimeType: 'image/png'}},
    ]}, imageEditing: {edit: () => result.promise}});
    const view = await host.open(); host.host.querySelector<HTMLButtonElement>('[data-attachment-id=image] button')!.click();
    host.host.querySelectorAll<HTMLButtonElement>('[data-attachment-id=image] button')[1].click();
    result.resolve([{id: 'image', expectedFileId: 'old', expectedRevision: 0, file: {id: 'new', name: 'new.png'}}]);
    await vi.waitFor(() => expect(host.host.querySelector('.llm-chat__composer .llm-chat__error')!.textContent).not.toBe(''));
    expect(view.getDraft().attachments).toEqual([]);
});
afterEach(async () => { for (const view of views.splice(0)) await view.destroy().catch(() => {}); document.body.replaceChildren(); vi.clearAllMocks(); });
function deferred<T>() {
    let resolve!: (value: T) => void, reject!: (error: unknown) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}
function fixture(extra: Partial<ChatOptions> = {}) {
    let snapshot: ConversationSnapshot = { conversationId: 'conversation', viewId: 'binding-1', revision: 0, title: 'Chat',
        messages: [], interactions: [], loading: false, execution: 'idle', connection: 'online', hasEarlier: false,
        allowed: ['send', 'edit', 'retry', 'respond', 'cancel'] };
    const listeners = new Set<() => void>();
    const source = { getSnapshot: () => snapshot, subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; } };
    const operations = extra.operations ?? createOperationLedger();
    const host = document.createElement('div'); document.body.append(host);
    const options: ChatOptions = { source, operations, actions: {
        send: async (_input, context) => ({ status: 'accepted', operationId: context.operationId }),
        reconcile: async operationId => ({ status: 'unknown', operationId, message: 'not visible yet' }),
    }, ...extra };
    const open = async (overrides: Partial<ChatOptions> = {}) => { const view = await createChatView(host, { ...options, ...overrides }); views.push(view); return view; };
    const publish = (update: Partial<ConversationSnapshot>) => { snapshot = { ...snapshot, ...update, revision: snapshot.revision + 1 }; listeners.forEach(listener => listener()); };
    return { host, open, publish, options, operations, listeners };
}
function user(submissionId: string, acceptance: 'confirmed' | 'optimistic' = 'confirmed') {
    return { id: 'user-1', revision: 0, role: 'user' as const, state: 'complete' as const, submissionId, acceptance,
        parts: [{ id: 'body', kind: 'markdown' as const, text: 'A' }] };
}

it.each(['accepted', 'unknown'] as const)('uses host previews only for %s operations without changing frozen input or acceptance evidence', async status => {
    const host = fixture(), operationId = 'queued';
    await host.operations.register({context: {operationId, viewId: 'binding-1'}, conversationId: 'conversation', kind: 'send',
        input: {text: 'Original input', attachments: []}, status,
        draft: {revision: 0, textRevision: 0, text: 'Original input', attachments: []}});
    const before = structuredClone(host.operations.getSnapshot());
    host.publish({operationMessages: [{operationId, message: null}]}); await host.open();
    expect(host.host.querySelectorAll('.llm-chat__message[data-role=user]')).toHaveLength(status === 'accepted' ? 0 : 1);
    expect(host.operations.getSnapshot()).toEqual(before);
    host.publish({operationMessages: [{operationId, message: {id: 'operation:queued', revision: 3, role: 'user', state: 'pending',
        parts: [{id: 'body', kind: 'markdown', text: 'Edited preview'}]}}]});
    expect(host.host.textContent).toContain(status === 'accepted' ? 'Edited preview' : 'Original input');
    expect(host.operations.getSnapshot()).toEqual(before);
});

describe('structured call composer', () => {
    it('selects Agent and Flow targets with colliding ids and requires reapplying preserved arguments', async () => {
        const send = vi.fn(async (_input, context) => ({status: 'accepted' as const, operationId: context.operationId}));
        const agent = {kind: 'agent', id: 'same', version: '1', digest: 'agent'}, flow = {kind: 'flow', id: 'same', version: '1', digest: 'flow'};
        const signature = {id: 'same', revision: 1, digest: 'signature'};
        const entries = [{id: 'agent-choice', label: 'Agent', target: agent, inputContract: {targetId: 'agent-choice', label: 'Agent', signature}},
            {id: 'flow-choice', label: 'Flow', target: flow, inputContract: {targetId: 'flow-choice', label: 'Flow', signature}}];
        const host = fixture({actions: {send, reconcile: vi.fn()}}); host.publish({callTargets: {entries, loading: false}});
        const view = await host.open(); view.setArguments('{"count":0}');
        const select = host.host.querySelector<HTMLSelectElement>('[data-call-target]')!;
        select.value = 'flow-choice'; select.dispatchEvent(new Event('change', {bubbles: true}));
        expect(view.getDraft().input?.json).toBe('{"count":0}'); await view.submit(); expect(send).not.toHaveBeenCalled();
        view.setArguments(view.getDraft().input!.json); await view.submit();
        expect(send.mock.calls[0][0]).toMatchObject({target: flow, input: {targetId: 'flow-choice', target: flow, values: {count: 0}}});
    });

    it('keeps a removed or revised target draft without silently selecting another published target', async () => {
        const target = {kind: 'flow', id: 'flow', version: '1', digest: 'one'};
        const host = fixture(); host.publish({callTargets: {entries: [{id: 'old', label: 'Flow', target}], loading: false}});
        const view = await host.open(); view.setText('Keep this input');
        host.publish({callTargets: {entries: [{id: 'new', label: 'Flow v2', target: {...target, version: '2', digest: 'two'}}], loading: false}});
        expect(view.getDraft().target).toEqual(target); expect(view.getDraft().text).toBe('Keep this input');
        expect(host.host.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled).toBe(true);
        expect(host.host.querySelector<HTMLSelectElement>('[data-call-target]')!.value).toBe('');
    });

    const contract = {targetId: 'reader', label: 'Reader', signature: {id: 'flow', revision: 1, digest: 'one'}};
    it('submits zero arguments without text and records the exact signature in the existing ledger', async () => {
        const send = vi.fn(async (_input, context) => ({status: 'accepted' as const, operationId: context.operationId}));
        const host = fixture({actions: {send, reconcile: vi.fn()}}); host.publish({inputContract: contract});
        const view = await host.open();
        expect(host.host.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled).toBe(false);
        await view.submit();
        expect(send.mock.calls[0][0]).toMatchObject({text: '', attachments: [], input: {targetId: contract.targetId, signature: contract.signature, values: {}}});
        expect(host.operations.getSnapshot()[0].input).toMatchObject({input: {signature: contract.signature, values: {}}});
        await vi.waitFor(() => expect(host.host.querySelector('[data-json-part="arguments"]')).not.toBeNull());
    });
    it('preserves invalid JSON drafts and never submits the previous valid value', async () => {
        const send = vi.fn(), saveDraft = vi.fn(async () => {});
        const host = fixture({actions: {send, reconcile: vi.fn()}, saveDraft}); host.publish({inputContract: contract});
        const view = await host.open(); view.setArguments('{"count":0}'); view.setArguments('{invalid');
        await view.flushDraft(); await view.submit();
        expect(send).not.toHaveBeenCalled(); expect(saveDraft.mock.calls.at(-1)?.[0]).toMatchObject({input: {json: '{invalid'}});
        expect(host.host.querySelector<HTMLTextAreaElement>('.llm-chat__argument-input')!.value).toBe('{invalid');
        expect(host.host.textContent).toContain('有效的 JSON 对象');
        view.setArguments('{"enabled":false,"count":0,"text":"","nullable":null,"items":[]}');
        expect(host.host.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled).toBe(false);
    });
    it('preserves arguments across target changes and requires explicit review against the new signature', async () => {
        const host = fixture(); host.publish({inputContract: contract}); const view = await host.open();
        view.setArguments('{"count":0}'); host.publish({inputContract: {...contract, signature: {...contract.signature, revision: 2, digest: 'two'}}});
        await view.submit(); expect(host.operations.getSnapshot()).toHaveLength(0);
        expect(view.getDraft().input?.json).toBe('{"count":0}');
        const apply = [...host.host.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === '应用到所选目标')!;
        apply.click(); await view.submit();
        expect(host.operations.getSnapshot()[0].input).toMatchObject({input: {signature: {revision: 2, digest: 'two'}, values: {count: 0}}});
    });
    it('does not clear newer arguments when an earlier submission is accepted', async () => {
        const result = deferred<void>();
        const send = vi.fn(async (_input, context) => {await result.promise; return {status: 'accepted' as const, operationId: context.operationId};});
        const host = fixture({actions: {send, reconcile: vi.fn()}}); host.publish({inputContract: contract}); const view = await host.open();
        view.setArguments('{"count":1}'); const sending = view.submit();
        await vi.waitFor(() => expect(send).toHaveBeenCalledOnce()); view.setArguments('{"count":2}');
        result.resolve(); await sending; expect(view.getDraft().input?.json).toBe('{"count":2}');
    });
    it('restores a parameter-only uncertain submission and confirms it without replaying the send', async () => {
        const send = vi.fn(async (_input, context) => ({status: 'unknown' as const, operationId: context.operationId, message: 'Disconnected'}));
        const host = fixture({actions: {send, reconcile: vi.fn()}}); host.publish({inputContract: contract});
        const first = await host.open(); first.setArguments('{"count":0}');
        await expect(first.submit()).rejects.toThrow('Disconnected');
        const draft = structuredClone(first.getDraft()), operationId = host.operations.getSnapshot()[0].context.operationId;
        await first.destroy(); const restored = await host.open({initialDraft: draft});
        expect(restored.getDraft().input?.json).toBe('{"count":0}');
        await restored.submit(); expect(send).toHaveBeenCalledOnce();
        host.publish({operationReceipts: [{status: 'accepted', operationId}]});
        await vi.waitFor(() => expect(host.operations.getSnapshot()[0].status).toBe('accepted'));
        expect(restored.getDraft().input?.json).toBe('{}'); expect(send).toHaveBeenCalledOnce();
    });
    it('checks host field constraints at the button and programmatic submission boundaries', async () => {
        const host = fixture({validateInput: input => input.input?.values.count === 0 ? [] : ['Count must be zero']});
        host.publish({inputContract: contract}); const view = await host.open(); view.setArguments('{"count":1}');
        expect(host.host.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled).toBe(true);
        await view.submit(); expect(host.operations.getSnapshot()).toHaveLength(0); expect(host.host.textContent).toContain('Count must be zero');
        view.setArguments('{"count":0}'); await view.submit(); expect(host.operations.getSnapshot()).toHaveLength(1);
    });
});

it('renders JSON parts on expansion as literal text and preserves the open part during updates', async () => {
    const host = fixture();
    host.publish({messages: [{id: 'result', revision: 1, role: 'assistant', state: 'complete',
        parts: [{id: 'value', kind: 'json', value: {literal: '<img src=x onerror=alert(1)>'}}]}]});
    await host.open();
    await vi.waitFor(() => expect(host.host.querySelector('[data-json-part="value"]')).not.toBeNull());
    const details = host.host.querySelector<HTMLDetailsElement>('[data-json-part="value"]')!;
    expect(details.querySelector('pre')!.textContent).toBe('');
    details.open = true; details.dispatchEvent(new Event('toggle'));
    expect(details.querySelector('pre')!.textContent).toContain('<img src=x onerror=alert(1)>'); expect(details.querySelector('img')).toBeNull();
    host.publish({messages: [{id: 'result', revision: 2, role: 'assistant', state: 'complete', parts: [{id: 'value', kind: 'json', value: {count: 0}}]}]});
    await vi.waitFor(() => expect(details.querySelector('pre')!.textContent).toContain('"count": 0'));
    expect(host.host.querySelector('[data-json-part="value"]')).toBe(details); expect(details.open).toBe(true);
});

it('scopes uncertain cancellation to its execution instead of locking later execution controls', async () => {
    const cancel = vi.fn(async (_target, context) => ({status: 'unknown' as const, operationId: context.operationId, message: 'Awaiting confirmation'}));
    const host = fixture({actions: {cancel, reconcile: vi.fn()}});
    host.publish({executionRef: 'execution-one', execution: 'running'}); await host.open();
    const stop = [...host.host.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === '停止')!;
    stop.click(); await vi.waitFor(() => expect(host.operations.getSnapshot()[0]?.status).toBe('unknown'));
    expect(stop.disabled).toBe(true); stop.click(); expect(cancel).toHaveBeenCalledOnce();
    host.publish({executionRef: 'execution-two'}); expect(stop.disabled).toBe(false);
    stop.click(); await vi.waitFor(() => expect(cancel).toHaveBeenCalledTimes(2));
    expect(cancel.mock.calls.map(call => call[0])).toEqual(['execution-one', 'execution-two']);
    expect(cancel.mock.calls[0][1].operationId).not.toBe(cancel.mock.calls[1][1].operationId);
});

describe('composer command capabilities', () => {
    it('accepts another query after a durable report arrives while the first transport is still unresolved', async () => {
        const pending = deferred<OperationReceipt>();
        const command = vi.fn(async (_input, context): Promise<OperationReceipt> => ({status: 'accepted' as const, operationId: context.operationId}));
        command.mockImplementationOnce(() => pending.promise);
        const host = fixture({actions: {command, reconcile: vi.fn()}});
        host.publish({commands: composeCommandCatalogs([{source: {id: 'native', label: 'Native'}, commands: [
            {id: 'state', name: 'state', revision: 1, description: 'State', kind: 'action', execution: 'query'},
        ]}]), allowed: ['command']});
        const view = await host.open(); view.setText('/state'); const first = view.submit();
        await vi.waitFor(() => expect(command).toHaveBeenCalledOnce()); const id = host.operations.getSnapshot()[0].context.operationId;
        host.publish({operationReceipts: [{status: 'accepted', operationId: id}]});
        await vi.waitFor(() => expect(host.operations.getSnapshot()[0].status).toBe('accepted'));
        view.setText('/state'); await view.submit(); expect(command).toHaveBeenCalledTimes(2);
        pending.resolve({status: 'unknown', operationId: id, message: 'Late transport response'}); await first;
        expect(host.operations.getSnapshot()[0].status).toBe('accepted');
    });
    it('retains query classification for recovery after its command directory disappears', async () => {
        const command = vi.fn(async (_input, context) => ({status: 'unknown' as const, operationId: context.operationId, message: 'Report acknowledgement lost'}));
        const reconcile = vi.fn(async operationId => ({status: 'accepted' as const, operationId}));
        const host = fixture({actions: {command, reconcile}});
        host.publish({commands: composeCommandCatalogs([{source: {id: 'native', label: 'Native'}, commands: [
            {id: 'state', name: 'state', revision: 1, description: 'State', kind: 'action', execution: 'query'},
        ]}]), allowed: ['command']});
        const view = await host.open(); view.setText('/state'); await expect(view.submit()).rejects.toThrow('Report acknowledgement lost');
        const record = host.operations.getSnapshot()[0]; expect(record).toMatchObject({status: 'unknown', input: {execution: 'query', kind: 'action'}});
        await expect(view.submit()).rejects.toThrow('Report acknowledgement lost'); expect(command).toHaveBeenCalledTimes(2);
        expect(host.operations.getSnapshot()[1].context.operationId).not.toBe(record.context.operationId);
        host.publish({commands: []}); await view.reconcile(record.context.operationId);
        expect(reconcile).toHaveBeenCalledWith(record.context.operationId); expect(host.operations.getSnapshot()[0].status).toBe('accepted');
    });
    const catalogs = () => composeCommandCatalogs(['ui', 'harness'].map(id => ({source: {id, label: id}, commands: [
        {id: 'compact', revision: 1, name: 'compact', description: id + ' compact', kind: 'action' as const},
    ]})));
    it('preserves both sources, requires disambiguation and never executes completion', async () => {
        const command = vi.fn(async (_input, context) => ({status: 'accepted' as const, operationId: context.operationId}));
        const send = vi.fn();
        const host = fixture({actions: {send, command, reconcile: async operationId => ({status: 'unknown', operationId, message: 'unknown'})}});
        host.publish({commands: catalogs(), allowed: ['send', 'command']}); const view = await host.open();
        view.setText('/compact');
        expect(document.querySelectorAll('[data-chat-commands] [role=option]')).toHaveLength(2);
        await expect(view.submit()).rejects.toThrow('同名');
        expect(command).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled();
        const choice = [...document.querySelectorAll<HTMLElement>('[data-chat-commands] [role=option]')].find(row => row.textContent?.includes('harness'))!;
        choice.click(); expect(command).not.toHaveBeenCalled(); expect(view.getDraft().text).toBe('/compact ');
        await view.submit();
        expect(command.mock.calls[0][0]).toMatchObject({target: {id: JSON.stringify(['harness', 'compact']), expectedRevision: 1}, kind: 'action'});
        expect(view.getDraft().text).toBe(''); expect(host.host.querySelectorAll('[data-message-id]')).toHaveLength(0);
        view.setText('/missing'); await expect(view.submit()).rejects.toThrow('不可用'); expect(send).not.toHaveBeenCalled();
    });
    it('rejects a selected command whose revision changed before submission', async () => {
        const command = vi.fn(), host = fixture({actions: {command, reconcile: vi.fn()}});
        host.publish({commands: catalogs().slice(0, 1), allowed: ['command']}); const view = await host.open();
        view.setText('/com'); document.querySelector<HTMLElement>('[data-chat-commands] [role=option]')!.click();
        host.publish({commands: [{...catalogs()[0], revision: 2}]});
        await expect(view.submit()).rejects.toThrow('不可用'); expect(command).not.toHaveBeenCalled();
        expect(view.getDraft().text).toBe('/compact ');
    });
    it('uses Enter to complete a command without executing it and closes the menu when hidden', async () => {
        const command = vi.fn(), host = fixture({actions: {command, reconcile: vi.fn()}});
        host.publish({commands: catalogs().slice(0, 1), allowed: ['command']}); const view = await host.open();
        view.setText('/com'); host.host.querySelector('textarea')!.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true, cancelable: true}));
        expect(command).not.toHaveBeenCalled(); expect(view.getDraft().text).toBe('/compact ');
        view.setText('/com'); view.setActive(false);
        expect(document.querySelector('[data-chat-commands].llm-popup--visible')).toBeNull();
    });
    it('retains an unknown command and never falls through to a model send or automatic replay', async () => {
        const command = vi.fn(async (_input, context) => ({status: 'unknown' as const, operationId: context.operationId, message: 'unknown'})), send = vi.fn();
        const host = fixture({actions: {command, send, reconcile: vi.fn()}});
        host.publish({commands: catalogs().slice(0, 1), allowed: ['send', 'command']}); const view = await host.open();
        view.setText('/compact'); await expect(view.submit()).rejects.toThrow('unknown');
        view.setText('/compact '); await expect(view.submit()).rejects.toThrow('awaiting reconciliation');
        expect(command).toHaveBeenCalledOnce(); expect(send).not.toHaveBeenCalled(); expect(view.getDraft().text).toBe('/compact ');
    });
});

it('scopes dependent reasoning choices to the selected model and removes obsolete selector values', async () => {
    const send = vi.fn(async (_input, context) => ({status: 'accepted' as const, operationId: context.operationId}));
    const host = fixture({actions: {send, reconcile: vi.fn()}});
    host.publish({selectors: [
        {id: 'modelId', label: 'Model', value: 'thinking', choices: [{id: 'thinking', label: 'Thinking'}, {id: 'plain', label: 'Plain'}]},
        {id: 'effort', label: 'Effort', value: '', choices: [{id: '', label: 'Default'}], variants: {selectorId: 'modelId', values: {
            thinking: {value: 'high', choices: [{id: 'high', label: 'High'}]}, plain: {value: '', choices: [{id: '', label: 'Default'}]},
        }}},
    ]});
    const view = await host.open();
    const parent = host.host.querySelector<HTMLSelectElement>('[data-selector-id="modelId"]')!;
    host.publish({execution: 'running'});
    expect(host.host.querySelector('[data-selector-id="modelId"]')).toBe(parent);
    parent.value = 'plain'; parent.dispatchEvent(new Event('change'));
    expect(host.host.querySelector<HTMLSelectElement>('[data-selector-id="effort"]')!.value).toBe('');
    host.publish({selectors: host.options.source.getSnapshot().selectors!.slice(0, 1)});
    view.setText('Prompt'); await view.submit();
    expect(send.mock.calls[0][0].selection).toEqual({modelId: 'plain'});
});

describe('conversation content search integration', () => {
    it('offers a header button and refreshes matches after streaming and earlier history load', async () => {
        const host = fixture(), view = await host.open();
        const message = { ...user('s'), state: 'streaming' as const, parts: [{ id: 'body', kind: 'markdown' as const, text: 'needle' }] };
        host.publish({ messages: [message] });
        await vi.waitFor(() => expect(host.host.querySelector('.llm-chat__body')!.textContent).toBe('needle'));
        [...host.host.querySelectorAll('.llm-chat__header button')].find(button => button.textContent === '搜索内容')!.click();
        const input = host.host.querySelector<HTMLInputElement>('.llm-chat__search-input')!;
        input.value = 'needle'; input.dispatchEvent(new Event('input', { bubbles: true }));
        const status = () => host.host.querySelector('.llm-chat__search-status')!.textContent;
        expect(status()).toBe('1 / 1');
        const row = host.host.querySelector('[data-message-id="user-1"]');
        host.publish({ messages: [{ ...message, revision: 1, parts: [{ ...message.parts[0], text: 'needle needle' }] }] });
        await vi.waitFor(() => expect(status()).toBe('1 / 2'));
        expect(host.host.querySelector('[data-message-id="user-1"]')).toBe(row);
        const latest = host.options.source.getSnapshot().messages[0];
        host.publish({ messages: [{ ...message, id: 'earlier' }, latest] });
        await vi.waitFor(() => expect(status()).toBe('2 / 3'));
        view.setActive(false); host.publish({ messages: [] }); expect(status()).toBe('2 / 3');
        view.setActive(true); await vi.waitFor(() => expect(status()).toBe('无匹配结果'));
    });
    it('leaves custom renderer content and composer drafts outside search', async () => {
        const host = fixture({ renderers: { custom: container => { container.textContent = 'private needle'; return { destroy() {} }; } } });
        const view = await host.open(); view.setText('draft needle');
        host.publish({ messages: [{ ...user('s'), parts: [{ id: 'ext', kind: 'extension', type: 'custom', data: null }] }] });
        await vi.waitFor(() => expect(host.host.querySelector('.llm-chat__part[data-search-exclude]')?.textContent).toBe('private needle'));
        [...host.host.querySelectorAll('button')].find(button => button.textContent === '搜索内容')!.click();
        const input = host.host.querySelector<HTMLInputElement>('.llm-chat__search-input')!;
        input.value = 'needle'; input.dispatchEvent(new Event('input', { bubbles: true }));
        expect(host.host.querySelector('.llm-chat__search-status')!.textContent).toBe('无匹配结果');
        expect(host.host.querySelector('mark.llm-chat__search-match')).toBeNull(); expect(view.getDraft().text).toBe('draft needle');
    });
});

describe('submission acceptance and recovery', () => {
    it('reports registration failures without logging operation content or dispatching the action', async () => {
        const diagnostic = vi.fn(), send = vi.fn();
        const operations = createOperationLedger({save: async () => {throw new Error('Private persistence details');}});
        const host = fixture({operations, onDiagnostic: diagnostic, actions: {send, reconcile: vi.fn()}}), view = await host.open();
        view.setText('Private user message'); await expect(view.submit()).rejects.toThrow('Private persistence details');
        expect(send).not.toHaveBeenCalled(); expect(view.getDraft().text).toBe('Private user message');
        expect(diagnostic).toHaveBeenCalledWith(expect.objectContaining({stage: 'register', result: 'failed', code: 'OPERATION_REGISTRATION_FAILED'}));
        expect(JSON.stringify(diagnostic.mock.calls)).not.toContain('Private');
    });
    it('accepts queue receipts before history exists and admits another identical draft while transport is pending', async () => {
        const firstReply = deferred<OperationReceipt>(), secondReply = deferred<OperationReceipt>();
        const send = vi.fn((_input, context) => {
            if (send.mock.calls.length === 1) {
                host.publish({operationReceipts: [{status: 'accepted', operationId: context.operationId, submissionRef: 'instruction-1'}]});
                return firstReply.promise;
            }
            return secondReply.promise;
        });
        const host = fixture({actions: {send, reconcile: vi.fn()}}), view = await host.open();
        view.setText('Same prompt'); const first = view.submit();
        await vi.waitFor(() => expect(host.operations.getSnapshot()[0]?.status).toBe('accepted'));
        expect(host.options.source.getSnapshot().messages).toEqual([]);
        expect(host.operations.getSnapshot()[0].observedUserMessageId).toBeUndefined();
        view.setText('Same prompt'); const second = view.submit();
        await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
        const ids = host.operations.getSnapshot().map(record => record.context.operationId);
        expect(ids[0]).not.toBe(ids[1]);
        firstReply.resolve({status: 'accepted', operationId: ids[0]}); await first;
        await view.submit(); expect(send).toHaveBeenCalledTimes(2);
        expect(view.getDraft().text).toBe('Same prompt');
        secondReply.resolve({status: 'accepted', operationId: ids[1]}); await second;
        expect(view.getDraft().text).toBe('');
    });
    it('only settles registered operations belonging to the observed conversation', async () => {
        const host = fixture();
        await host.operations.register({context: {viewId: 'another-view', operationId: 'other'},
            conversationId: 'another-conversation', kind: 'send', input: {}, status: 'submitting'});
        host.publish({operationReceipts: [{status: 'accepted', operationId: 'other'}, {status: 'accepted', operationId: 'missing'}]});
        const view = await host.open(); view.setText('New draft');
        expect(host.operations.getSnapshot()[0].status).toBe('submitting');
        expect(view.getDraft().text).toBe('New draft');
    });
    it('does not revive an observed temporary bubble when its formal message leaves the loaded page', async () => {
        const host = fixture(), first = await host.open(); first.setText('A'); await first.submit();
        const id = host.operations.getSnapshot()[0].context.operationId;
        host.publish({ messages: [user(id)] });
        await vi.waitFor(() => expect(host.operations.getSnapshot()[0].observedUserMessageId).toBe('user-1'));
        await first.destroy(); host.publish({ viewId: 'binding-2', messages: [] });
        await host.open(); expect(host.host.querySelectorAll('[data-role="user"]')).toHaveLength(0);
    });
    it('keeps a temporary bubble after acceptance and replaces only its user message', async () => {
        const host = fixture(), view = await host.open(); view.setText('A'); await view.submit();
        expect(view.getDraft().text).toBe('');
        expect(host.host.querySelectorAll('[data-role="user"]')).toHaveLength(1);
        const id = host.operations.getSnapshot()[0].context.operationId;
        host.publish({ messages: [user(id), { id: 'reply-1', revision: 0, role: 'assistant', state: 'complete', submissionId: id, parts: [] },
            { id: 'reply-2', revision: 0, role: 'assistant', state: 'complete', submissionId: id, parts: [] }] });
        expect(host.host.querySelectorAll('[data-role="user"]')).toHaveLength(1);
        expect(host.host.querySelectorAll('[data-role="assistant"]')).toHaveLength(2);
    });
    it('does not treat an optimistic source message as acceptance', async () => {
        const reply = deferred<OperationReceipt>();
        const host = fixture({ actions: { send: (_input, context) => { host.publish({ messages: [user(context.operationId, 'optimistic')] }); return reply.promise; },
            reconcile: async operationId => ({ status: 'unknown', operationId, message: '?' }) } });
        const view = await host.open(); view.setText('A'); const sending = view.submit();
        await vi.waitFor(() => expect(host.operations.getSnapshot()).toHaveLength(1));
        const id = host.operations.getSnapshot()[0].context.operationId;
        reply.resolve({ status: 'rejected', operationId: id, code: 'DENIED', message: 'Denied' });
        await expect(sending).rejects.toThrow('Denied'); expect(view.getDraft().text).toBe('A');
    });
    it('does not downgrade authoritative acceptance after a late transport failure', async () => {
        const reply = deferred<OperationReceipt>();
        const host = fixture({ actions: { send: (_input, context) => { host.publish({ messages: [user(context.operationId)] }); return reply.promise; },
            reconcile: async operationId => ({ status: 'unknown', operationId, message: '?' }) } });
        const view = await host.open(); view.setText('A'); const sending = view.submit();
        await vi.waitFor(() => expect(host.operations.getSnapshot()[0]?.status).toBe('accepted'));
        reply.reject(new Error('Network disconnected')); await sending;
        expect(view.getDraft().text).toBe(''); expect(host.operations.getSnapshot()[0].status).toBe('accepted');
    });
    it('retains unknown operation content across destruction and reconciles without the expired viewId', async () => {
        const send = vi.fn(async (_input, context) => ({ status: 'unknown' as const, operationId: context.operationId, message: '?' }));
        const reconcile = vi.fn(async operationId => ({ status: 'accepted' as const, operationId }));
        const host = fixture({ actions: { send, reconcile } });
        const first = await host.open(); first.setText('A'); await expect(first.submit()).rejects.toThrow();
        const draft = first.getDraft(), id = host.operations.getSnapshot()[0].context.operationId;
        await first.destroy(); host.publish({ viewId: 'binding-2' });
        const second = await host.open({ initialDraft: draft });
        await second.submit(); expect(send).toHaveBeenCalledTimes(1);
        await second.reconcile(id); expect(reconcile).toHaveBeenCalledWith(id); expect(second.getDraft().text).toBe('');
    });
    it('records a send before dispatch and continues settlement after the view is destroyed', async () => {
        const reply = deferred<OperationReceipt>(), send = vi.fn((_input, _context) => reply.promise);
        const host = fixture({ actions: { send, reconcile: async operationId => ({ status: 'unknown', operationId, message: '?' }) } });
        const view = await host.open(); view.setText('A'); const sending = view.submit();
        await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
        const id = host.operations.getSnapshot()[0].context.operationId;
        await view.destroy(); reply.resolve({ status: 'accepted', operationId: id }); await sending;
        expect(host.operations.getSnapshot()[0].status).toBe('accepted'); expect(host.host.children).toHaveLength(0);
    });
    it('isolates observer exceptions and does not publish an unsaved registration', async () => {
        const saved = deferred<void>(), save = vi.fn(() => saved.promise), operations = createOperationLedger({ save });
        operations.subscribe(() => { throw new Error('observer failed'); });
        const host = fixture({ operations }), view = await host.open(); view.setText('A'); const sending = view.submit();
        await vi.waitFor(() => expect(save).toHaveBeenCalledOnce()); expect(operations.getSnapshot()).toHaveLength(0);
        saved.resolve(); await sending; expect(operations.getSnapshot()[0].status).toBe('accepted');
    });
});

describe('draft, attachment and lifecycle races', () => {
    it('clears submitted text when only attachments changed during acceptance', async () => {
        const reply = deferred<OperationReceipt>();
        const host = fixture({ upload: async file => ({ id: file.name, name: file.name }), actions: {
            send: (_input, _context) => reply.promise, reconcile: async operationId => ({ status: 'unknown', operationId, message: '?' }) } });
        const view = await host.open(); view.setText('A'); await view.addFiles([new File(['x'], 'X')]);
        const sending = view.submit(); await vi.waitFor(() => expect(host.operations.getSnapshot()).toHaveLength(1));
        await view.addFiles([new File(['y'], 'Y')]);
        reply.resolve({ status: 'accepted', operationId: host.operations.getSnapshot()[0].context.operationId }); await sending;
        expect(view.getDraft().text).toBe(''); expect(view.getDraft().attachments.map(item => item.file.name)).toEqual(['Y']);
    });
    it('preserves new text while hidden and applies acceptance before reactivation', async () => {
        const reply = deferred<OperationReceipt>();
        const host = fixture({ actions: { send: (_input, _context) => reply.promise,
            reconcile: async operationId => ({ status: 'unknown', operationId, message: '?' }) } });
        const view = await host.open(); view.setText('A'); const sending = view.submit();
        await vi.waitFor(() => expect(host.operations.getSnapshot()).toHaveLength(1)); view.setActive(false); view.setText('B');
        reply.resolve({ status: 'accepted', operationId: host.operations.getSnapshot()[0].context.operationId }); await sending;
        expect(view.getDraft().text).toBe('B'); view.setActive(true); expect(view.getDraft().text).toBe('B');
    });
    it('does not restore an upload removed before completion', async () => {
        const result = deferred<{ id: string; name: string }>(), host = fixture({ upload: () => result.promise });
        const view = await host.open(), uploading = view.addFiles([new File(['x'], 'X')]);
        host.host.querySelector<HTMLButtonElement>('[data-upload-id] button')!.click(); result.resolve({ id: 'X', name: 'X' }); await uploading;
        expect(view.getDraft().attachments).toEqual([]);
    });
    it('flushes the latest debounced draft and retries a failed save', async () => {
        const save = vi.fn().mockRejectedValueOnce(new Error('disk full')).mockResolvedValue(undefined);
        const host = fixture({ saveDraft: save }), view = await host.open(); view.setText('latest');
        await expect(view.flushDraft()).rejects.toThrow('disk full'); await view.flushDraft();
        expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ text: 'latest' }));
    });
    it('releases all resources when an extension and a toolbar throw during destruction', async () => {
        const slot = vi.fn(() => { throw new Error('toolbar cleanup'); }), extension = vi.fn(() => { throw new Error('extension cleanup'); });
        const host = fixture({ renderers: { custom: () => ({ destroy: extension }) }, mountToolbar: () => ({ destroy: slot }) });
        const view = await host.open(); host.publish({ messages: [{ id: 'm', role: 'assistant', revision: 0, state: 'complete',
            parts: [{ id: 'md', kind: 'markdown', text: 'content' }, { id: 'ext', kind: 'extension', type: 'custom', data: null }] }] });
        await vi.waitFor(() => expect(host.host.textContent).toContain('content'));
        const disposal = view.destroy(); expect(view.destroy()).toBe(disposal); await expect(disposal).rejects.toBeInstanceOf(AggregateError);
        expect(slot).toHaveBeenCalledOnce(); expect(extension).toHaveBeenCalledOnce(); expect(destroyed).toHaveBeenCalled();
        expect(host.listeners.size).toBe(0); expect(host.host.children).toHaveLength(0);
    });
});

it('uses the revision captured when editing started, even if another window changes the message', async () => {
    const edit = vi.fn(async (_target, _text, context) => ({ status: 'rejected' as const, operationId: context.operationId, code: 'CONFLICT', message: 'Version conflict' }));
    const host = fixture({ actions: { edit, reconcile: async operationId => ({ status: 'unknown', operationId, message: '?' }) } });
    await host.open(); const message = { ...user('s'), allowed: ['edit' as const], revision: 7 };
    host.publish({ messages: [message] });
    [...host.host.querySelectorAll('button')].find(node => node.textContent === '编辑')!.click();
    host.publish({ messages: [{ ...message, revision: 8 }] });
    const form = host.host.querySelector<HTMLFormElement>('.llm-chat__edit')!;
    form.querySelector('textarea')!.value = 'changed'; form.dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(edit).toHaveBeenCalled()); expect(edit.mock.calls[0][0]).toEqual({ messageId: 'user-1', expectedRevision: 7 });
    expect(host.host.querySelector('.llm-chat__edit')).not.toBeNull();
});

it('keeps the published ledger version when saving a receipt fails', async () => {
    const initial: OperationRecord = { context: { operationId: 'op', viewId: 'old' }, conversationId: 'c', kind: 'send', input: 'A', status: 'unknown' };
    const ledger = createOperationLedger({ initial: [initial], save: async () => { throw new Error('disk full'); } });
    await expect(ledger.settle({ status: 'accepted', operationId: 'op' })).rejects.toThrow('disk full');
    expect(ledger.getSnapshot()[0].status).toBe('unknown');
});

it('blocks another regeneration until an unknown operation is reconciled, including after reopening', async () => {
    const retry = vi.fn(async (_target, context) => ({ status: 'unknown' as const, operationId: context.operationId, message: 'Receipt lost' }));
    const host = fixture({ actions: { retry, reconcile: async operationId => ({ status: 'rejected', operationId, code: 'NOT_STARTED', message: 'Not started' }) } });
    const first = await host.open(); host.publish({ messages: [{ ...user('s'), allowed: ['retry'] }] });
    const click = () => [...host.host.querySelectorAll('button')].find(button => button.textContent === '重新生成')!.click();
    click(); await vi.waitFor(() => expect(host.operations.getSnapshot()[0]?.status).toBe('unknown'));
    await first.destroy(); host.publish({ viewId: 'binding-2' }); const second = await host.open(); click();
    await vi.waitFor(() => expect(host.host.textContent).toContain('awaiting reconciliation'));
    expect(retry).toHaveBeenCalledOnce();
    await second.reconcile(host.operations.getSnapshot()[0].context.operationId); click();
    await vi.waitFor(() => expect(retry).toHaveBeenCalledTimes(2));
});

it.each(['accepted', 'unknown'] as const)('keeps an approval locked after its response is %s', async status => {
    const respond = vi.fn(async (_request, context) => status === 'accepted'
        ? { status, operationId: context.operationId } : { status, operationId: context.operationId, message: 'Receipt lost' });
    const host = fixture({ actions: { respond, reconcile: async operationId => ({ status: 'unknown', operationId, message: '?' }) } });
    await host.open(); host.publish({ interactions: [{ id: 'approval', revision: 0, kind: 'approval', title: 'Approve?',
        state: 'pending', decisions: [{ id: 'yes', label: 'YES' }] }] });
    const control = host.host.querySelector<HTMLButtonElement>('[data-request-id="approval"] button')!;
    control.click(); await vi.waitFor(() => expect(host.operations.getSnapshot()[0]?.status).toBe(status));
    await vi.waitFor(() => expect(control.disabled).toBe(true)); control.click();
    expect(respond).toHaveBeenCalledOnce();
    host.publish({ interactions: [{ ...host.options.source.getSnapshot().interactions[0], revision: 1 }] });
    const updated = host.host.querySelector<HTMLButtonElement>('[data-request-id="approval"] button')!;
    expect(updated.disabled).toBe(false); updated.click();
    await vi.waitFor(() => expect(respond).toHaveBeenCalledTimes(2));
});

it.each(['missing', 'throws'])('uploads and submits without native UUID (%s)', async mode => {
    const original = globalThis.crypto;
    vi.stubGlobal('crypto', {getRandomValues: original.getRandomValues.bind(original),
        ...(mode === 'throws' ? {randomUUID: () => {throw new Error('Unavailable native UUID');}} : {})});
    try {
        const host = fixture({upload: async file => ({id: file.name, name: file.name, mimeType: file.type})}), view = await host.open();
        view.setText('Compatible draft'); await view.addFiles([new File(['x'], 'X.txt')]); await view.submit();
        expect(host.operations.getSnapshot()[0]).toMatchObject({status: 'accepted'});
        expect(host.operations.getSnapshot()[0].context.operationId).toMatch(/^[\da-f]{8}-[\da-f-]{27}$/i);
    } finally {vi.unstubAllGlobals();}
});

it('regenerates restored images on a host policy notification and blocks sending until ready', async () => {
    type Changes = NonNullable<Awaited<ReturnType<NonNullable<ChatOptions['imageEditing']>['edit']>>>;
    let revision = '1024', notify!: () => void;
    const pending = deferred<Changes>(), release = vi.fn();
    const refresh = vi.fn(async (_items: readonly import('../src').DraftAttachment[]) => revision === '1024' ? [] : pending.promise);
    const send = vi.fn(async (_input, context) => ({status: 'accepted' as const, operationId: context.operationId}));
    const host = fixture({initialDraft: {revision: 0, textRevision: 0, text: 'Prompt', attachments: [
        {id: 'image', file: {id: 'original', name: 'photo.png', mimeType: 'image/png'}},
    ]}, imageEditing: {getRevision: () => revision, subscribe: listener => {notify = listener; return release;}, refresh, edit: async () => []}, actions: {send, reconcile: async operationId => ({status: 'unknown', operationId, message: 'Pending'})}});
    const view = await host.open(); await vi.waitFor(() => expect(host.host.querySelector<HTMLButtonElement>('[type=submit]')!.disabled).toBe(false));
    revision = '2048'; notify(); await view.submit(); expect(send).not.toHaveBeenCalled();
    pending.resolve([{id: 'image', expectedFileId: 'original', expectedRevision: 0, file: {id: 'larger', name: 'photo.png', mimeType: 'image/png'}}]);
    await vi.waitFor(() => expect(view.getDraft().attachments[0].file.id).toBe('larger'));
    await vi.waitFor(() => expect(host.host.querySelector<HTMLButtonElement>('[type=submit]')!.disabled).toBe(false));
    await view.submit(); expect(send).toHaveBeenCalledWith(expect.objectContaining({attachments: [expect.objectContaining({id: 'larger'})]}), expect.anything());
    await view.destroy(); expect(release).toHaveBeenCalledOnce();
});
it('restarts an in-flight upload from its original when the host policy changes', async () => {
    let revision = '1024'; const first = deferred<File>();
    const original = new File(['original'], 'photo.png', {type: 'image/png'}), large = new File(['2048'], 'photo.png', {type: 'image/png'});
    const prepare = vi.fn(async (_file: File, _options: {signal: AbortSignal}) => prepare.mock.calls.length === 1 ? first.promise : large);
    const upload = vi.fn(async file => ({id: String(file.size), name: file.name, mimeType: file.type}));
    const host = fixture({upload, imageEditing: {getRevision: () => revision, prepare, edit: async () => []}}), view = await host.open();
    const adding = view.addFiles([original]); revision = '2048'; first.resolve(new File(['1024-small'], 'photo.png', {type: 'image/png'}));
    await adding; expect(prepare).toHaveBeenCalledTimes(2); expect(prepare.mock.calls.every(call => call[0] === original)).toBe(true);
    expect(view.getDraft().attachments[0].file.id).toBe(String(large.size));
});

it('handles invalid policy notifications without recursive rendering and leaves text-only input usable', async () => {
    let invalid = false, notify!: () => void;
    const host = fixture({imageEditing: {edit: async () => [], refresh: async () => [],
        getRevision: () => {if (invalid) throw new Error('invalid-policy'); return 'valid';},
        subscribe: listener => {notify = listener; return () => {};}}});
    const view = await host.open(); view.setText('Text only'); invalid = true;
    expect(() => notify()).not.toThrow(); await view.submit();
    expect(host.operations.getSnapshot()).toMatchObject([{status: 'accepted'}]);
});

it.each(['accepted', 'rejected', 'unknown'] as const)('does not dispatch when persistence already knows a %s operation', async status => {
    const save = vi.fn(async (records: readonly OperationRecord[]) => records.map(record => ({...record, status})));
    const operations = createOperationLedger({save}), send = vi.fn(), host = fixture({operations, actions: {send, reconcile: async operationId => ({operationId, status: 'unknown'})}}), view = await host.open();
    view.setText('Input');
    if (status === 'accepted') await view.submit(); else await expect(view.submit()).rejects.toBeInstanceOf(Error);
    expect(send).not.toHaveBeenCalled(); expect(operations.getSnapshot()[0].status).toBe(status);
});
it('freezes host context with the submitted draft and preserves a newer context on admission', async () => {
    const accepted = deferred<OperationReceipt>(), send = vi.fn((_input, _context) => accepted.promise);
    const f = fixture({actions: {send, reconcile: async operationId => ({operationId, status: 'unknown', message: 'Pending'})}}), view = await f.open(), choice = {checkpoint: 'original'};
    view.setText('Task'); view.setContext(choice); choice.checkpoint = 'caller mutation';
    const sending = view.submit(); await vi.waitFor(() => expect(send).toHaveBeenCalled());
    expect(send.mock.calls[0][0].context).toEqual({checkpoint: 'original'});
    view.setContext({checkpoint: 'next'});
    accepted.resolve({operationId: send.mock.calls[0][1].operationId, status: 'accepted'}); await sending;
    expect(view.getDraft().context).toEqual({revision: 2, value: {checkpoint: 'next'}});
    expect(f.operations.getSnapshot()[0].draft?.context).toEqual({revision: 1, value: {checkpoint: 'original'}});
});
it('consumes only the matching context revision and persists a cleared revision for reopening', async () => {
    const saveDraft = vi.fn(async (_draft) => {}), f = fixture({saveDraft}), view = await f.open();
    view.setText('Task'); view.setContext({checkpoint: 'same'}); await view.submit(); await view.flushDraft();
    expect(view.getDraft().context).toEqual({revision: 2, value: null});
    const reopened = await f.open({initialDraft: structuredClone(view.getDraft())});
    reopened.setContext({checkpoint: 'same'}); expect(reopened.getDraft().context?.revision).toBe(3);
    expect(saveDraft).toHaveBeenLastCalledWith(expect.objectContaining({context: {revision: 2, value: null}}));
});
it('does not consume host context when a composer command is accepted', async () => {
    const f = fixture({actions: {command: async (_input, context) => ({operationId: context.operationId, status: 'accepted'}), reconcile: async operationId => ({operationId, status: 'unknown', message: 'Pending'})}});
    f.publish({allowed: ['command'], commands: composeCommandCatalogs([{source: {id: 'native', label: 'Native'}, commands: [{id: 'status', revision: 1, name: 'status', description: 'Status', kind: 'action'}]}])});
    const view = await f.open(); view.setContext({checkpoint: 'keep'}); view.setText('/status'); await view.submit();
    expect(view.getDraft().context?.value).toEqual({checkpoint: 'keep'});
});

it('preserves expanded tool details through state updates and shares bulk disclosure with JSON parts', async () => {
    const host = fixture();
    const message = {id: 'tool-message', revision: 0, role: 'assistant' as const, state: 'streaming' as const, parts: [
        {id: 'tool', kind: 'tool' as const, name: 'Tool', summary: 'Queued', state: 'pending' as const},
        {id: 'json', kind: 'json' as const, value: {result: 42}},
    ]};
    host.publish({messages: [message]}); const view = await host.open();
    await vi.waitFor(() => expect(host.host.querySelectorAll('.llm-chat__part details')).toHaveLength(2));
    const tool = host.host.querySelector<HTMLDetailsElement>('.llm-chat__part details')!;
    view.setAllCollapsed(false); expect(tool.open).toBe(true);
    await vi.waitFor(() => expect(host.host.querySelector('[data-json-part] pre')!.textContent).toContain('42'));
    host.publish({messages: [{...message, revision: 1, parts: [{...message.parts[0], state: 'cancelled', summary: 'Cancelled'}, message.parts[1]]}]});
    await vi.waitFor(() => expect(tool.dataset.state).toBe('cancelled'));
    expect(host.host.querySelector('.llm-chat__part details')).toBe(tool); expect(tool.open).toBe(true);
    view.setAllCollapsed(true); expect(tool.open).toBe(false);
});

it('applies host choices without replacing the composer and rejects a stale draft revision', async () => {
    const host = fixture(), view = await host.open(); view.setText('Unsent text');
    const before = view.getDraft(), input = host.host.querySelector('textarea');
    view.configureInput({selection: {connectionId: 'chosen'}}, before.revision);
    expect(view.getDraft()).toMatchObject({text: before.text, textRevision: before.textRevision, revision: before.revision + 1, selection: {connectionId: 'chosen'}});
    expect(host.host.querySelector('textarea')).toBe(input);
    expect(() => view.configureInput({selection: {connectionId: 'stale'}}, before.revision)).toThrow('Input choices changed');
    expect(view.getDraft().selection?.connectionId).toBe('chosen');
});

it('dispatches a frozen first-draft command on the adopted binding without sending it as a message', async () => {
    const command = vi.fn(async (_input, context) => ({status: 'accepted' as const, operationId: context.operationId}));
    const send = vi.fn(), registered: OperationRecord[] = [];
    const formal = fixture({operations: createOperationLedger({save: records => {registered.splice(0, registered.length, ...records);}}), actions: {command, send, reconcile: vi.fn()}});
    formal.publish({viewId: 'formal', allowed: ['send', 'command'], commands: composeCommandCatalogs([{source: {id: 'host', label: 'Host'},
        commands: [{id: 'inspect', name: 'inspect', revision: 2, kind: 'action', description: ''}]}])});
    let view!: ChatView;
    const draft = fixture({actions: {send, reconcile: vi.fn(), prepareSend: async () => {
        await view.replaceBinding(formal.options);
        view.setText('New input typed during handoff');
        return {operationId: 'stable-command', viewId: 'formal'};
    }}});
    view = await draft.open(); const textarea = draft.host.querySelector('textarea'); view.setText('/inspect original');
    await view.submit();
    expect(command).toHaveBeenCalledWith(expect.objectContaining({text: '/inspect original', arguments: 'original'}), {operationId: 'stable-command', viewId: 'formal'});
    expect(send).not.toHaveBeenCalled(); expect(registered).toMatchObject([{kind: 'command', status: 'accepted'}]);
    expect(view.getDraft().text).toBe('New input typed during handoff'); expect(draft.host.querySelector('textarea')).toBe(textarea);
});

it('keeps an unrecognized command after first-draft adoption and blocks hidden host actions', async () => {
    const send = vi.fn(), command = vi.fn(); let view!: ChatView;
    const formal = fixture({actions: {send, command, reconcile: vi.fn()}}); formal.publish({commands: [], allowed: ['send', 'command', 'retry']});
    const draft = fixture({actions: {send, reconcile: vi.fn(), prepareSend: async () => {await view.replaceBinding(formal.options); return {operationId: 'first', viewId: 'binding-1'};}}});
    view = await draft.open(); view.setText('/unknown original');
    await expect(view.submit()).rejects.toThrow(); expect(send).not.toHaveBeenCalled(); expect(command).not.toHaveBeenCalled();
    expect(view.getDraft().text).toBe('/unknown original'); expect(formal.operations.getSnapshot()).toEqual([]);
    view.setActive(false); await view.submit(); expect(send).not.toHaveBeenCalled();
    await expect(view.retryMessage({messageId: 'missing', expectedRevision: 0})).rejects.toThrow('unavailable');
});

it('reveals only a collapsed message wrapper and preserves nested disclosure state', async () => {
    const host = fixture(); host.publish({messages: [{id: 'question', revision: 1, role: 'user', state: 'complete', parts: [
        {id: 'text', kind: 'markdown', text: 'Question'}, {id: 'data', kind: 'json', label: 'Arguments', value: {count: 1}},
    ]}]});
    const view = await host.open(); view.setAllCollapsed(true);
    const row = host.host.querySelector<HTMLElement>('[data-message-id="question"]')!;
    expect(row.classList.contains('is-collapsed')).toBe(true);
    expect(view.revealMessage('question')).toBe(true); expect(row.classList.contains('is-collapsed')).toBe(false);
    expect(row.querySelector('details')!.open).toBe(false);
});

it('uses one send ledger for host commands that delegate to message preparation', async () => {
    const send = vi.fn(async (_input, context) => ({status: 'accepted' as const, operationId: context.operationId})), command = vi.fn();
    const host = fixture({actions: {send, command, reconcile: vi.fn()}});
    host.publish({allowed: ['send', 'command'], commands: composeCommandCatalogs([{source: {id: 'host', label: 'Host'}, commands: [
        {id: 'invoke', name: 'invoke', revision: 1, description: '', kind: 'action', dispatch: 'send'},
    ]}])});
    const view = await host.open(); view.setText('/invoke arguments'); await view.submit();
    expect(send).toHaveBeenCalledOnce(); expect(command).not.toHaveBeenCalled();
    expect(host.operations.getSnapshot()).toMatchObject([{kind: 'send', status: 'accepted'}]); expect(view.getDraft().text).toBe('');
});

it('recovers actual textarea text and selection without changing the input or borrowing another conversation identity', async () => {
    const host = fixture(), view = await host.open(), input = host.host.querySelector('textarea')!;
    input.value = 'Unobserved edit'; input.focus(); input.setSelectionRange(3, 8, 'backward');
    const recovery = view.captureRecovery(); expect(recovery.draft.text).toBe('Unobserved edit');
    view.setText('Server draft'); view.restoreRecovery(recovery);
    expect(host.host.querySelector('textarea')).toBe(input); expect(input.value).toBe('Unobserved edit');
    expect([input.selectionStart, input.selectionEnd, input.selectionDirection]).toEqual([3, 8, 'backward']);
    expect(() => view.restoreRecovery({...recovery, conversationId: 'another'})).toThrow('another conversation');
});

it('mounts input menu extensions within the composer and retires them once without replacing input DOM', async () => {
    const released = vi.fn(), updated = vi.fn();
    const mount = (container: HTMLElement) => {const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Settings'; container.append(button);
        return {update: updated, destroy: () => {released(); button.remove();}};};
    const host = fixture({mountComposerMenu: mount}), view = await host.open();
    const input = host.host.querySelector('textarea'), history = host.host.querySelector('.llm-chat__history');
    expect(host.host.querySelector('.llm-chat__header')!.textContent).not.toContain('Settings');
    expect(host.host.querySelector('.llm-chat__input-menu')!.textContent).toContain('Settings');
    host.publish({title: 'Updated'}); await vi.waitFor(() => expect(updated).toHaveBeenCalled());
    await view.replaceBinding({...host.options, mountComposerMenu: mount});
    await vi.waitFor(() => expect(released).toHaveBeenCalledOnce());
    expect(host.host.querySelector('textarea')).toBe(input); expect(host.host.querySelector('.llm-chat__history')).toBe(history);
    expect(host.host.querySelectorAll('.llm-chat__composer-menu button')).toHaveLength(1);
    await view.destroy(); expect(released).toHaveBeenCalledTimes(2);
});
it('shows an unavailable target error only once and distinguishes an empty catalog', async () => {
    const target = {kind: 'agent', id: 'removed', version: '1', digest: 'one'};
    const host = fixture({initialDraft: {revision: 0, textRevision: 0, text: 'Keep', attachments: [], target}});
    host.publish({callTargets: {loading: false, entries: [{id: 'other', label: 'Other', target: {...target, id: 'other'}}]}});
    const view = await host.open();
    expect(host.host.textContent!.split('目标已变化或不可用，请重新选择')).toHaveLength(2);
    expect(view.getDraft().target).toEqual(target);
    host.publish({callTargets: {loading: false, entries: []}});
    await vi.waitFor(() => expect(host.host.querySelector('.llm-chat__validation')!.textContent).toContain('没有可用的执行目标'));
    expect(view.getDraft().text).toBe('Keep');
});
it('combines dependent selectors atomically while advanced options stay inside the input menu', async () => {
    const host = fixture(); host.publish({selectors: [
        {id: 'connection', label: 'Model', value: 'a', combineWith: 'tier', choices: [{id: 'a', label: 'A'}, {id: 'b', label: 'B'}]},
        {id: 'tier', label: 'Tier', value: 'auto', choices: [], variants: {selectorId: 'connection', values: {
            a: {value: 'auto', choices: [{id: 'auto', label: 'Default'}]},
            b: {value: 'auto', choices: [{id: 'auto', label: 'Default'}, {id: 'fast', label: 'Fast'}]}}}},
        {id: 'mode', label: 'Call mode', value: 'current', placement: 'more', choices: [{id: 'current', label: 'Current'}]},
    ]});
    const view = await host.open(), select = host.host.querySelector<HTMLSelectElement>('[data-selector-id=connection]')!;
    expect(host.host.querySelector('[data-selector-id=tier]')).toBeNull();
    expect(host.host.querySelector('.llm-chat__input-menu [data-selector-id=mode]')).not.toBeNull();
    const before = view.getDraft().revision; select.value = JSON.stringify(['b', 'fast']); select.dispatchEvent(new Event('change'));
    expect(view.getDraft()).toMatchObject({revision: before + 1, selection: {connection: 'b', tier: 'fast'}});
    host.publish({title: 'Refreshed'}); await vi.waitFor(() => expect(host.host.querySelector<HTMLSelectElement>('[data-selector-id=connection]')!.value).toBe(JSON.stringify(['b', 'fast'])));
});

it('keeps input menu forms from dispatching a chat submission', async () => {
    const send = vi.fn(), host = fixture({actions: {send, reconcile: vi.fn()}, mountComposerMenu: root => {
        const form = document.createElement('form'); form.onsubmit = event => event.preventDefault(); root.append(form);
        return {destroy: () => form.remove()};
    }});
    const view = await host.open(); view.setText('Do not send');
    host.host.querySelector('.llm-chat__composer-menu form')!.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));
    expect(send).not.toHaveBeenCalled(); expect(view.getDraft().text).toBe('Do not send');
    await view.replaceBinding({...host.options, mountComposerMenu: undefined});
    expect(host.host.querySelector<HTMLDetailsElement>('.llm-chat__input-menu')!.hidden).toBe(true);
});

it('moves existing header controls into one menu on narrow screens and releases the media listener', async () => {
    const media = {matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn()};
    const previous = globalThis.matchMedia; globalThis.matchMedia = (() => media) as unknown as typeof matchMedia;
    try {
        const host = fixture({mountHeader: (root, context) => {
            const branch = document.createElement('select'); branch.dataset.chatOverflow = ''; root.append(branch);
            const action = document.createElement('button'); action.type = 'button'; action.textContent = 'Host action'; context.headerMenu!.append(action);
            return {destroy: () => {branch.remove(); action.remove();}};
        }}), view = await host.open();
        const input = host.host.querySelector('textarea'), prompts = host.host.querySelector('[data-chat-action=prompts]')!;
        const branch = host.host.querySelector('[data-chat-overflow]')!, menu = host.host.querySelector('.llm-chat__header-menu-body')!;
        expect(host.host.querySelectorAll('.llm-chat__header .llm-chat__host-menu')).toHaveLength(1);
        expect(prompts.parentElement).not.toBe(menu); expect(branch.parentElement).not.toBe(menu);
        const search = host.host.querySelector('[data-chat-action=search]')!, collapse = host.host.querySelector('[data-chat-action=collapse]')!;
        expect(search.parentElement).toBe(menu); expect(collapse.parentElement).toBe(menu);
        const listener = media.addEventListener.mock.calls.find(([event]) => event === 'change')![1] as () => void;
        media.matches = true; listener(); expect(prompts.parentElement).toBe(menu); expect(branch.parentElement).toBe(menu);
        expect(search.parentElement).toBe(menu); expect(collapse.parentElement).toBe(menu);
        media.matches = false; listener(); expect(branch.parentElement).not.toBe(menu); expect(host.host.querySelector('textarea')).toBe(input);
        expect(search.parentElement).toBe(menu); expect(collapse.parentElement).toBe(menu);
        await view.destroy(); expect(media.removeEventListener).toHaveBeenCalledWith('change', listener);
    } finally {globalThis.matchMedia = previous;}
});
it('presents composer choices through one picker per canonical select and releases portals on rebinding', async () => {
    const host = fixture({mountComposerStart: root => {
        const project = document.createElement('span'); project.textContent = 'Project'; root.append(project); return {destroy: () => project.remove()};
    }});
    host.publish({selectors: [{id: 'model', label: 'Model', value: 'one', placement: 'end', choices: [{id: 'one', label: 'Model One'}]}]});
    const view = await host.open(), native = host.host.querySelector<HTMLSelectElement>('[data-selector-id=model]')!;
    expect(native.hidden).toBe(true);
    expect(host.host.querySelector('.llm-chat__selectors--end .llm-chat__picker')!.textContent).toContain('Model One');
    expect(host.host.querySelector('.llm-chat__composer-start')!.textContent).toBe('Project');
    const count = document.querySelectorAll('.llm-popup').length;
    await view.replaceBinding(host.options);
    await vi.waitFor(() => expect(document.querySelectorAll('.llm-popup').length).toBe(count));
    expect(host.host.querySelector('.llm-chat__composer-start')!.textContent).toBe('Project');
    await view.destroy(); expect(document.querySelectorAll('.llm-popup')).toHaveLength(0);
});

it('keeps host parameter forms out of the chat input and never selects the first catalog entry implicitly', async () => {
    const target = {kind: 'flow', id: 'anki', version: '1', digest: 'one'}, signature = {id: 'anki', revision: 1, digest: 'one'};
    const send = vi.fn(async (_input, context) => ({status: 'accepted' as const, operationId: context.operationId}));
    const host = fixture({inputPresentation: 'host', actions: {send, reconcile: vi.fn()}});
    host.publish({callTargets: {loading: false, autoSelectFirst: false, entries: [{id: 'anki', label: 'Anki', target,
        inputContract: {targetId: 'anki', label: 'Anki', signature}}]}});
    const view = await host.open(); expect(view.getDraft().target).toBeUndefined();
    const select = host.host.querySelector<HTMLSelectElement>('[data-call-target]')!;
    select.value = 'anki'; select.dispatchEvent(new Event('change'));
    expect(host.host.querySelector<HTMLElement>('.llm-chat__arguments')!.hidden).toBe(true);
    await view.submit(); expect(send).toHaveBeenCalledWith(expect.objectContaining({target, input: expect.objectContaining({signature})}), expect.anything());
});

it('keeps message timing in the shared header and secondary actions tied to their frozen target', async () => {
    const remove = vi.fn(), host = fixture({messageActions: () => [{id: 'delete', label: 'Delete', placement: 'more', run: remove}]});
    host.publish({messages: [{id: 'message', revision: 2, role: 'user', state: 'complete', timestamp: 1700000000000,
        parts: [{id: 'body', kind: 'markdown', text: 'Keep'}]}]});
    await host.open();
    expect(host.host.querySelector('time')!.dateTime).toBe(new Date(1700000000000).toISOString());
    const button = host.host.querySelector<HTMLButtonElement>('.llm-chat__message-menu button')!;
    expect(button.textContent).toBe('Delete'); button.click(); await vi.waitFor(() => expect(remove).toHaveBeenCalledOnce());
});

it('keeps all published Agent and Flow choices searchable under their original category filters', async () => {
    const host = fixture(); host.publish({callTargets: {loading: false, autoSelectFirst: false, entries: [
        {id: 'agent', label: 'Agent choice', group: 'Agent', description: 'Agent description', target: {kind: 'agent', id: 'same', version: '1', digest: 'agent'}},
        {id: 'flow', label: 'Flow choice', group: 'Flow', description: 'Flow description', target: {kind: 'flow', id: 'same', version: '2', digest: 'flow'}},
    ]}});
    const view = await host.open(); host.host.querySelector<HTMLButtonElement>('[data-call-target]')!.parentElement!.querySelector<HTMLButtonElement>('button')!.click();
    const popup = document.querySelector<HTMLElement>('.llm-popup--visible')!;
    expect([...popup.querySelectorAll('.llm-popup__filter')].map(node => node.textContent)).toEqual(['全部', 'Agent', 'Flow']);
    expect(popup.querySelectorAll('.llm-popup__item')).toHaveLength(2);
    popup.querySelector<HTMLButtonElement>('[data-popup-group=Flow]')!.click();
    expect(popup.querySelectorAll('.llm-popup__item')).toHaveLength(1);
    expect(popup.querySelector('.llm-popup__item')!.textContent).toContain('Flow description');
    popup.querySelector<HTMLElement>('.llm-popup__item')!.click();
    expect(view.getDraft().target).toEqual({kind: 'flow', id: 'same', version: '2', digest: 'flow'});
});
it('shows queue semantics only when the host declares them and restores send after execution', async () => {
    const present = vi.fn((node: HTMLButtonElement, action: string) => {if (action === 'queue') node.innerHTML = '<svg aria-hidden="true"></svg>';});
    const f = fixture({presentButton: present}); await f.open();
    f.publish({execution: 'running', submissionMode: 'queue'});
    const submit = f.host.querySelector<HTMLButtonElement>('.llm-chat__composer button[type=submit]')!;
    expect(submit.dataset.chatAction).toBe('queue'); expect(submit.title).toContain('队列'); expect(submit.getAttribute('aria-label')).toContain('队列');
    expect(submit.querySelector('svg')).not.toBeNull();
    f.publish({execution: 'idle', submissionMode: 'send'}); expect(submit.dataset.chatAction).toBe('send'); expect(submit.title).toBe('发送');
});

it('updates compact composer indicators without replacing the draft or closing its touch disclosure', async () => {
    const host = fixture(); const view = await host.open(); view.setText('Keep this draft');
    const input = host.host.querySelector('textarea')!;
    host.publish({composerIndicators: [{id: 'context', label: 'Context', value: '10k / 200k', detail: '5% used'}, {id: 'budget', label: 'Quota', value: '75% left'}]});
    const disclosure = host.host.querySelector<HTMLDetailsElement>('.llm-chat__input-status')!;
    expect(disclosure.hidden).toBe(false); disclosure.open = true;
    host.publish({composerIndicators: [{id: 'context', label: 'Context', value: '20k / 200k', detail: '10% used'}, {id: 'budget', label: 'Quota', value: '5% left', tone: 'warning'}]});
    expect(disclosure.open).toBe(true); expect(host.host.querySelector('textarea')).toBe(input); expect(input.value).toBe('Keep this draft');
    expect(disclosure.querySelector('.llm-chat__input-status-value')!.textContent).toBe('20k / 200k');
    expect(disclosure.querySelector('[data-tone=warning]')).not.toBeNull();
    host.publish({composerIndicators: [{id: 'budget', label: '<script>unsafe</script>', value: '—'}]});
    expect(disclosure.querySelector('script')).toBeNull();
    host.publish({composerIndicators: []}); expect(disclosure.hidden).toBe(true); expect(disclosure.open).toBe(false);
});

it('updates the submission mode immediately when a model selector changes without replacing input text', async () => {
    const host = fixture({resolveSubmissionMode: draft => draft.selection?.modelId === 'next' ? 'queue' : 'steer'});
    host.publish({selectors: [{id: 'modelId', label: 'Model', value: 'current', choices: [{id: 'current', label: 'Current'}, {id: 'next', label: 'Next'}]}]});
    const view = await host.open(); view.setText('Preserve input'); const input = host.host.querySelector('textarea')!;
    expect(host.host.querySelector('[data-chat-action=steer]')).not.toBeNull();
    const model = host.host.querySelector<HTMLSelectElement>('[data-selector-id=modelId]')!;
    model.value = 'next'; model.dispatchEvent(new Event('change', {bubbles: true}));
    expect(host.host.querySelector('[data-chat-action=queue]')).not.toBeNull();
    expect(host.host.querySelector('textarea')).toBe(input); expect(input.value).toBe('Preserve input');
});

it('dismisses more on outside pointer or Escape while keeping its portaled child usable', async () => {
    const {PopupPanel} = await import('../src');
    const host = fixture({mountComposerMenu: () => ({destroy() {}})});
    const view = await host.open(); view.setText('Keep draft');
    const more = host.host.querySelector<HTMLDetailsElement>('.llm-chat__input-menu')!;
    more.querySelector<HTMLButtonElement>('[data-chat-action=more]')!.click(); expect(more.open).toBe(true);
    const trigger = document.createElement('button'); more.append(trigger);
    const child = new PopupPanel(trigger, {showSearch: true});
    try {
        const selected = vi.fn(); child.show([{id: 'high', label: 'High'}], {onSelect: selected});
        child.element.querySelector('input')!.dispatchEvent(new Event('pointerdown', {bubbles: true})); expect(more.open).toBe(true);
        const choice = child.element.querySelector<HTMLElement>('[role=option]')!;
        choice.dispatchEvent(new Event('pointerdown', {bubbles: true})); expect(more.open).toBe(true);
        choice.click(); expect(selected).toHaveBeenCalledWith(expect.objectContaining({id: 'high'}));
        host.host.querySelector('textarea')!.dispatchEvent(new Event('pointerdown', {bubbles: true}));
        expect(more.open).toBe(false); expect(view.getDraft().text).toBe('Keep draft');
        more.querySelector<HTMLButtonElement>('[data-chat-action=more]')!.click();
        more.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true})); expect(more.open).toBe(false);
    } finally {child.destroy();}
});

it('keeps an accessible occupancy meter beside attach and preserves unknown values without claiming zero usage', async () => {
    const host = fixture({upload: vi.fn()}), view = await host.open(); view.setText('Keep draft');
    const indicators = (progress: number | null) => [{id: 'context', label: 'Context', value: '100 / 200', progress}, {id: 'budget', label: 'Cost estimate', value: '≈ $1.00'}];
    host.publish({composerIndicators: indicators(.5)});
    const actions = host.host.querySelector('.llm-chat__composer-actions')!;
    const disclosure = actions.querySelector<HTMLDetailsElement>('.llm-chat__input-status')!;
    expect(actions.querySelector('[data-chat-action=attach]')!.nextElementSibling).toBe(disclosure);
    expect(disclosure.querySelector('[role=meter]')!.getAttribute('aria-valuenow')).toBe('50');
    expect(disclosure.querySelectorAll('[data-filled=true]')).toHaveLength(4);
    host.publish({composerIndicators: indicators(.000005)});
    expect(disclosure.querySelector('[role=meter]')!.getAttribute('aria-valuenow')).toBe('0.0005');
    disclosure.open = true; host.publish({composerIndicators: indicators(null)});
    expect(disclosure.open).toBe(true); expect(disclosure.querySelector('[role=meter]')).toBeNull();
    expect(disclosure.querySelector('[data-unknown=true]')).not.toBeNull();
    host.host.querySelector('textarea')!.dispatchEvent(new Event('pointerdown', {bubbles: true}));
    expect(disclosure.open).toBe(false); expect(view.getDraft().text).toBe('Keep draft');
});

it('clears a rejected prompt preview only after the next prompt is accepted and retains its ledger fact', async () => {
    let attempts = 0;
    const host = fixture({actions: {send: async (_input, context) => ++attempts === 1
        ? {status: 'rejected', operationId: context.operationId, code: 'BUSY', message: 'Busy'}
        : {status: 'accepted', operationId: context.operationId},
        reconcile: async operationId => ({status: 'unknown', operationId, message: 'Pending'})}});
    const view = await host.open(); view.setText('first');
    await expect(view.submit()).rejects.toThrow('Busy');
    expect(host.host.querySelectorAll('[data-state="failed"][data-role="user"]')).toHaveLength(1);
    view.setText('second'); await view.submit();
    expect(host.host.querySelectorAll('[data-state="failed"][data-role="user"]')).toHaveLength(0);
    expect(host.operations.getSnapshot().map(record => record.status)).toEqual(['rejected', 'accepted']);
    expect(host.host.querySelectorAll('[data-operation-id]')).toHaveLength(0);
    await view.destroy();
});

it('groups consecutive historical and live tool messages without hiding assistant text or resetting expansion', async () => {
    const host = fixture(), tool = (id: string, state: 'running' | 'succeeded' = 'succeeded') => ({id, revision: 0, role: 'tool' as const,
        state: 'complete' as const, parts: [{id, kind: 'tool' as const, name: id, summary: id, detail: 'output ' + id, state}]});
    const answer = {id: 'answer', revision: 0, role: 'assistant' as const, state: 'complete' as const,
        parts: [{id: 'text', kind: 'markdown' as const, text: 'Useful answer'}]};
    host.publish({messages: [tool('one'), tool('two'), answer]}); const view = await host.open();
    const group = host.host.querySelector<HTMLDetailsElement>('.llm-chat__history > .llm-tool-group')!;
    expect(group).not.toBeNull(); expect(group.open).toBe(false);
    expect(group.querySelector('.llm-tool-group__summary')!.textContent).toContain('2');
    expect(group.querySelectorAll('[data-message-id]')).toHaveLength(2);
    expect(host.host.querySelector('[data-message-id="answer"]')?.closest('.llm-tool-group')).toBeNull();
    group.open = true; group.dispatchEvent(new Event('toggle'));
    const original = group.querySelector('[data-message-id="two"]');
    host.publish({messages: [tool('older'), tool('one'), tool('two'), answer, tool('live', 'running')]});
    await vi.waitFor(() => expect(host.host.querySelectorAll('.llm-chat__history > .llm-tool-group')).toHaveLength(2));
    expect(group.open).toBe(true); expect(group.querySelector('[data-message-id="two"]')).toBe(original);
    expect(group.querySelector('.llm-tool-group__summary')!.textContent).toContain('3');
    view.setAllCollapsed(true); expect(group.open).toBe(false);
    expect(view.revealMessage('two')).toBe(true); expect(group.open).toBe(true);
});
it('groups adjacent tool parts inside a mixed assistant message and preserves live group identity', async () => {
    const host = fixture(), tool = (id: string, state: 'running' | 'succeeded' | 'failed' = 'running') => ({id, kind: 'tool' as const, name: id, summary: id, detail: 'body', state});
    const message = {id: 'mixed', revision: 0, role: 'assistant' as const, state: 'streaming' as const, parts: [
        {id: 'intro', kind: 'markdown' as const, text: 'Plan'}, tool('one'),
        {id: 'thinking', kind: 'reasoning' as const, text: 'Check the next step'}, tool('two')]};
    host.publish({messages: [message]}); await host.open();
    const group = host.host.querySelector<HTMLDetailsElement>('.llm-chat__body > .llm-tool-group')!;
    expect(group.open).toBe(false); expect(group.dataset.state).toBe('running');
    group.open = true; group.dispatchEvent(new Event('toggle'));
    host.publish({messages: [{...message, revision: 1, parts: [message.parts[0], tool('one', 'succeeded'), message.parts[2], tool('two', 'failed'),
        {id: 'answer', kind: 'markdown', text: 'Conclusion'}]}]});
    await vi.waitFor(() => expect(group.dataset.state).toBe('failed')); expect(group.open).toBe(true);
    expect(host.host.querySelector('.llm-chat__body > .llm-tool-group')).toBe(group);
    expect(group.querySelectorAll('.llm-chat__part')).toHaveLength(3);
    await vi.waitFor(() => expect(host.host.querySelector('.llm-chat__body')!.textContent).toContain('Conclusion'));
});
it('offers standalone OCR review only when configured and consumes the captured image version', async () => {
    const revoke = vi.fn();
    vi.stubGlobal('URL', class extends URL {static createObjectURL = vi.fn(() => 'blob:ocr'); static revokeObjectURL = revoke;});
    const image = {id: 'image', file: {id: 'asset', name: 'image.png', mimeType: 'image/png'}, revision: 2};
    const initialDraft = {revision: 1, textRevision: 1, text: 'Existing ', attachments: [image]};
    const recognize = vi.fn(async () => 'Recognized'), onDiagnostic = vi.fn();
    const host = fixture({initialDraft, ocr: {recognize, prepare: async blob => blob, read: async () => new Blob(['image']), onDiagnostic}});
    const view = await host.open(); host.host.querySelector<HTMLButtonElement>('[data-chat-action="ocr"]')!.click();
    await vi.waitFor(() => expect(host.host.querySelector<HTMLTextAreaElement>('.llm-ocr__text')?.value).toBe('Recognized'));
    expect(() => view.captureRecovery()).toThrow('识别');
    host.host.querySelector<HTMLTextAreaElement>('.llm-ocr__text')!.value = 'Reviewed';
    host.host.querySelector<HTMLButtonElement>('.llm-ocr__actions button')!.click();
    expect(view.getDraft().attachments).toHaveLength(0); expect(view.getDraft().text).toContain('Reviewed');
    expect(onDiagnostic).toHaveBeenCalledWith(expect.objectContaining({operation: 'chat.ocr', stage: 'apply', result: 'success'}));
    expect(JSON.stringify(onDiagnostic.mock.calls)).not.toContain('Reviewed'); expect(revoke).toHaveBeenCalledWith('blob:ocr');
    vi.unstubAllGlobals();
    const plain = fixture({initialDraft}); await plain.open(); expect(plain.host.querySelector('[data-chat-action="ocr"]')).toBeNull();
});
it('discards late OCR after hiding and keeps recognition failures retryable without consuming input', async () => {
    const result = deferred<string>(), error = vi.fn(), recognize = vi.fn().mockReturnValueOnce(result.promise).mockRejectedValueOnce(new Error('OCR offline'));
    const host = fixture({onError: error, initialDraft: {revision: 1, textRevision: 1, text: 'draft', attachments: [{id: 'image', file: {id: 'asset', name: 'image', mimeType: 'image/png'}}]},
        ocr: {recognize, read: async () => new Blob(['image']), prepare: async blob => blob}});
    const view = await host.open(), action = () => host.host.querySelector<HTMLButtonElement>('[data-chat-action="ocr"]')!.click();
    action(); await vi.waitFor(() => expect(recognize).toHaveBeenCalledOnce()); view.setActive(false); result.resolve('late');
    await Promise.resolve(); expect(host.host.querySelector('.llm-ocr__text')).toBeNull();
    view.setActive(true); action(); await vi.waitFor(() => expect(host.host.querySelector('.llm-ocr__error')?.textContent).toBe('OCR offline'));
    expect(view.getDraft().attachments).toHaveLength(1); expect(view.getDraft().text).toBe('draft');
});

it('rejects OCR review after its original attachment is removed without altering newer input', async () => {
    vi.stubGlobal('URL', class extends URL {static createObjectURL = vi.fn(() => 'blob:ocr'); static revokeObjectURL = vi.fn();});
    try {
        const onError = vi.fn(), onDiagnostic = vi.fn();
        const host = fixture({onError, initialDraft: {revision: 1, textRevision: 1, text: 'Original',
            attachments: [{id: 'image', revision: 2, file: {id: 'asset', name: 'image', mimeType: 'image/png'}}]},
            ocr: {recognize: async () => 'Recognized', read: async () => new Blob(['image']), prepare: async blob => blob, onDiagnostic}});
        const view = await host.open(); host.host.querySelector<HTMLButtonElement>('[data-chat-action="ocr"]')!.click();
        await vi.waitFor(() => expect(host.host.querySelector('.llm-ocr__text')).not.toBeNull());
        expect(view.removeAttachment({id: 'image', fileId: 'asset', revision: 2})).toBe(true); view.setText('New input');
        host.host.querySelector<HTMLButtonElement>('.llm-ocr__actions button')!.click();
        expect(view.getDraft().text).toBe('New input');
        expect(onError).toHaveBeenCalledWith(expect.objectContaining({code: 'OCR_ATTACHMENT_CHANGED'}));
        expect(onDiagnostic).toHaveBeenCalledWith(expect.objectContaining({stage: 'apply', result: 'failure', code: 'OCR_ATTACHMENT_CHANGED'}));
    } finally {vi.unstubAllGlobals();}
});
it('refreshes recovery status and tool previews without changing the message revision or admission facts', async () => {
    const message = {id: 'queued', revision: 3, role: 'user' as const, state: 'pending' as const,
        parts: [{id: 'status', kind: 'tool' as const, name: 'Waiting', state: 'running' as const}]};
    const host = fixture(); host.publish({messages: [message]}); await host.open();
    host.publish({messages: [{...message, statusLabel: '需要恢复', parts: [{id: 'status', kind: 'tool', name: '需要恢复', state: 'unknown'}]}]});
    await vi.waitFor(() => expect(host.host.textContent).toContain('需要恢复'));
    await vi.waitFor(() => expect(host.host.textContent).not.toContain('Waiting'));
    expect(host.host.textContent).not.toContain('执行中');
});

it('shows accepted queued submissions as admission status without inventing a running tool', async () => {
    const host = fixture({actions: {send: async (_input, context) => ({status: 'accepted', operationId: context.operationId}), reconcile: vi.fn()}});
    const view = await host.open(); view.setText('Queued question'); await view.submit();
    expect(host.host.textContent).toContain('Queued question');
    expect(host.host.querySelector('.llm-tool-group')).toBeNull();
    expect(host.operations.getSnapshot()).toMatchObject([{status: 'accepted'}]);
});
