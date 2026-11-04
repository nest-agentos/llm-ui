import {afterEach, expect, it, vi} from 'vitest';
import {createChatView, createOperationLedger} from '../src';
import type {ChatBinding, ChatOptions, ChatView, ComposerDraft, ConversationSnapshot, OperationReceipt} from '../src';

vi.mock('@itookit/mdxeditor', async original => ({
    ...await original<typeof import('@itookit/mdxeditor')>(),
    MDxRenderer: class {
        markedExtensions: unknown[] = []; usePlugin() {return this;}
        async render(node: HTMLElement, text: string) {node.textContent = text;}
        async renderStreaming(node: HTMLElement, text: string) {node.textContent = text;}
        destroy() {}
    },
}));
const views: ChatView[] = [], gates: (() => void)[] = [];
afterEach(async () => {
    gates.splice(0).forEach(release => release());
    for (const view of views.splice(0)) await view.destroy().catch(() => {});
    document.body.replaceChildren(); vi.restoreAllMocks();
});
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => {resolve = done;}); gates.push(() => resolve(undefined as T));
    return {promise, resolve};
}
function binding(id = 'chat', viewId = 'first', extra: Partial<ChatBinding> = {}) {
    let snapshot: ConversationSnapshot = {conversationId: id, viewId, revision: 0, title: viewId, messages: [], interactions: [],
        loading: false, execution: 'idle', connection: 'online', hasEarlier: false, allowed: ['send']};
    const listeners = new Set<() => void>(), allListeners: (() => void)[] = [], released = vi.fn();
    const source = {getSnapshot: () => snapshot, subscribe: (listener: () => void) => {
        listeners.add(listener); allListeners.push(listener); return () => {released(); listeners.delete(listener);};
    }};
    const send = vi.fn(async (_input, context) => ({status: 'accepted' as const, operationId: context.operationId}));
    const options: ChatBinding = {source, operations: createOperationLedger(), actions: {send,
        reconcile: async operationId => ({status: 'unknown', operationId, message: 'Unconfirmed'})}, ...extra};
    const publish = (change: Partial<ConversationSnapshot>) => {
        snapshot = {...snapshot, ...change, revision: snapshot.revision + 1}; for (const listener of listeners) listener();
    };
    return {options, publish, source, send, listeners, allListeners, released};
}
async function mount(options: ChatOptions) {
    const root = document.createElement('div'); document.body.append(root);
    const view = await createChatView(root, options); views.push(view);
    const input = root.querySelector<HTMLTextAreaElement>('.llm-chat__input')!, history = root.querySelector('.llm-chat__history');
    return {root, view, input, history};
}
it('retains the input DOM, focus and selection while routing new operations to the new host', async () => {
    const receipt = deferred<OperationReceipt>(), old = binding('chat', 'old');
    old.options.actions.send = vi.fn((_input, context) => receipt.promise.then(() => ({status: 'accepted', operationId: context.operationId})));
    const next = binding('chat', 'new'), f = await mount(old.options);
    f.view.setText('Submitted old draft'); const sending = f.view.submit();
    await vi.waitFor(() => expect(old.options.actions.send).toHaveBeenCalledOnce());
    f.view.setText('Later typing'); f.input.focus(); f.input.setSelectionRange(2, 5);
    await f.view.replaceBinding(next.options);
    expect(f.root.querySelector('.llm-chat__input')).toBe(f.input); expect(f.root.querySelector('.llm-chat__history')).toBe(f.history);
    expect(document.activeElement).toBe(f.input); expect([f.input.selectionStart, f.input.selectionEnd]).toEqual([2, 5]);
    expect(old.released).toHaveBeenCalledOnce(); expect(old.listeners.size).toBe(0);
    old.publish({title: 'Late old title'}); old.allListeners.forEach(listener => listener());
    expect(f.root.querySelector('h2')!.textContent).toBe('new');
    receipt.resolve({status: 'accepted', operationId: 'ignored'}); await sending;
    expect(old.options.operations.getSnapshot()[0].status).toBe('accepted'); expect(next.options.operations.getSnapshot()).toEqual([]);
    expect(f.view.getDraft().text).toBe('Later typing');
    await f.view.submit(); expect(next.send).toHaveBeenCalledOnce(); expect(f.view.getDraft().text).toBe('');
});
it('never dispatches a registration that completed after its original binding was replaced', async () => {
    const gate = deferred<void>(), old = binding('chat', 'old', {operations: createOperationLedger({save: async records => {await gate.promise; return records;}})});
    const f = await mount(old.options); f.view.setText('Original'); const sending = f.view.submit();
    const rejected = expect(sending).rejects.toMatchObject({code: 'STALE_VIEW'});
    const next = binding('chat', 'new'); await f.view.replaceBinding(next.options);
    gate.resolve(); await rejected;
    expect(old.send).not.toHaveBeenCalled(); expect(next.send).not.toHaveBeenCalled();
    expect(old.options.operations.getSnapshot()[0].status).toBe('rejected'); expect(f.view.getDraft().text).toBe('Original');
    await f.view.submit(); expect(next.send).toHaveBeenCalledOnce();
});
it('flushes edits made during a slow old save before handing the draft to another writer', async () => {
    const gate = deferred<void>(), oldSaves: string[] = [], nextSaves: string[] = [];
    const old = binding('chat', 'old', {saveDraft: async draft => {oldSaves.push(draft.text); await gate.promise;}});
    const next = binding('chat', 'new', {saveDraft: async draft => {nextSaves.push(draft.text);}}), f = await mount(old.options);
    f.view.setText('First'); const changing = f.view.replaceBinding(next.options);
    await vi.waitFor(() => expect(oldSaves).toEqual(['First'])); f.view.setText('Latest');
    expect(f.view.inputBusy).toBe(true); await f.view.submit(); expect(old.send).not.toHaveBeenCalled();
    gate.resolve(); await changing; await f.view.flushDraft();
    expect(oldSaves).toEqual(['First', 'Latest']); expect(nextSaves).toEqual(['Latest']); expect(f.view.inputBusy).toBe(false);
});
it('keeps the old binding and input intact after a failed flush or failed next subscription', async () => {
    const old = binding('chat', 'old', {saveDraft: vi.fn().mockRejectedValueOnce(new Error('SAVE_UNAVAILABLE')).mockResolvedValue(undefined)});
    const f = await mount(old.options), next = binding('chat', 'new'); f.view.setText('Keep me');
    await expect(f.view.replaceBinding(next.options)).rejects.toMatchObject({bindingCommitted: false, message: 'SAVE_UNAVAILABLE'});
    expect(old.released).not.toHaveBeenCalled(); expect(next.listeners.size).toBe(0);
    const broken = {...next.options, operations: {...next.options.operations, subscribe: () => {throw new Error('SUBSCRIBE_UNAVAILABLE');}}};
    await expect(f.view.replaceBinding(broken)).rejects.toMatchObject({bindingCommitted: false, message: 'SUBSCRIBE_UNAVAILABLE'});
    expect(next.listeners.size).toBe(0); old.publish({title: 'Still old'});
    expect(f.root.querySelector('h2')!.textContent).toBe('Still old'); expect(f.input.value).toBe('Keep me');
    expect(f.root.querySelector('.llm-chat__input')).toBe(f.input);
});
it('requires an explicit draft for another conversation and restores it into the same input', async () => {
    const old = binding('chat', 'old'), next = binding('other', 'next'), f = await mount(old.options); f.view.setText('Private old draft');
    await expect(f.view.replaceBinding(next.options)).rejects.toMatchObject({code: 'DRAFT_REQUIRED', bindingCommitted: false});
    const draft: ComposerDraft = {revision: 0, textRevision: 0, text: 'Other branch draft', attachments: [],
        input: {revision: 2, targetId: 'missing', signature: {id: 'input', revision: 1, digest: 'sha'}, json: '{invalid'}};
    await f.view.replaceBinding(next.options, {draft});
    expect(f.input.value).toBe('Other branch draft'); expect(f.view.getDraft().input!.json).toBe('{invalid');
    expect(f.root.querySelector('.llm-chat__input')).toBe(f.input); expect(f.view.getDraft().revision).toBe(0);
});
it.each([true, false])('does not consume an identical replacement draft from an old shared receipt (scope=%s)', async scoped => {
    const receipt = deferred<void>(), ledger = createOperationLedger();
    const old = binding('chat', 'old', {operations: ledger});
    old.options.actions.send = vi.fn((_input, context) => receipt.promise.then(() => ({status: 'accepted', operationId: context.operationId})));
    const initialDraft: ComposerDraft = {revision: 1, textRevision: 1, text: 'Same text', attachments: [], ...(scoped ? {scopeId: 'main'} : {})};
    const f = await mount({...old.options, initialDraft}); const sending = f.view.submit();
    await vi.waitFor(() => expect(old.options.actions.send).toHaveBeenCalledOnce());
    const next = binding('chat', 'review', {operations: ledger});
    await f.view.replaceBinding(next.options, {draft: {...initialDraft, ...(scoped ? {scopeId: 'review'} : {})}});
    receipt.resolve(); await sending;
    expect(f.view.getDraft().text).toBe('Same text'); expect(ledger.getSnapshot()[0].status).toBe('accepted');
    expect(f.root.querySelectorAll('.llm-chat__message')).toHaveLength(0);
    await f.view.submit(); expect(next.send).toHaveBeenCalledOnce(); expect(f.view.getDraft().text).toBe('');
});
it('aborts old history reads and ignores their late scroll changes and errors', async () => {
    const gate = deferred<void>(); let signal!: AbortSignal;
    const old = binding('chat', 'old', {actions: {loadEarlier: async options => {signal = options.signal; await gate.promise; throw new Error('OLD_PAGE_FAILURE');}}});
    old.publish({hasEarlier: true}); const f = await mount(old.options);
    f.root.querySelector<HTMLButtonElement>('.llm-chat > button')!.click();
    await vi.waitFor(() => expect(signal).toBeDefined());
    const next = binding('chat', 'next'); await f.view.replaceBinding(next.options);
    expect(signal.aborted).toBe(true); (f.history as HTMLElement).scrollTop = 41; gate.resolve();
    await Promise.resolve(); await Promise.resolve();
    expect((f.history as HTMLElement).scrollTop).toBe(41); expect(f.root.textContent).not.toContain('OLD_PAGE_FAILURE');
});
it('rejects rebinding during an attachment upload without dropping its original draft item', async () => {
    const gate = deferred<void>(), old = binding('chat', 'old', {upload: async () => {await gate.promise; return {id: 'asset', name: 'file.txt'};}});
    const f = await mount(old.options), upload = f.view.addFiles([new File(['data'], 'file.txt')]);
    await expect(f.view.replaceBinding(binding('chat', 'new').options)).rejects.toMatchObject({code: 'VIEW_BUSY', bindingCommitted: false});
    gate.resolve(); await upload; expect(f.view.getDraft().attachments[0].file.id).toBe('asset'); expect(old.released).not.toHaveBeenCalled();
});
it('records safe binding diagnostics and tolerates diagnostic callback failures', async () => {
    const diagnostics: unknown[] = [], old = binding('chat', 'old');
    const f = await mount({...old.options, onBindingDiagnostic: event => {diagnostics.push(event); throw new Error('Diagnostic unavailable');}});
    f.view.setText('Sensitive draft text'); await f.view.replaceBinding(binding('chat', 'next').options);
    await Promise.resolve();
    expect(diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({stage: 'commit', result: 'success', operationId: expect.any(String), durationMs: expect.any(Number)})]));
    expect(JSON.stringify(diagnostics)).not.toContain('Sensitive draft text'); expect(f.input.value).toBe('Sensitive draft text');
});
it('does not install a prepared binding after the view was closed during its old save', async () => {
    const gate = deferred<void>(), old = binding('chat', 'old', {saveDraft: async () => gate.promise});
    const f = await mount(old.options), next = binding('chat', 'new'); f.view.setText('Pending save');
    const changing = f.view.replaceBinding(next.options), rejected = expect(changing).rejects.toMatchObject({bindingCommitted: false});
    const closing = f.view.destroy(); gate.resolve(); await rejected; await closing;
    expect(next.listeners.size).toBe(0); expect(f.root.querySelector('.llm-chat')).toBeNull(); expect(old.released).toHaveBeenCalledOnce();
});
it('marks a failing host presentation as committed and keeps the newly installed observation', async () => {
    const old = binding('chat', 'old'), next = binding('chat', 'new'), f = await mount(old.options);
    await expect(f.view.replaceBinding({...next.options, mountHeader: () => {throw new Error('NEW_HEADER_FAILED');}}))
        .rejects.toMatchObject({bindingCommitted: true, message: 'NEW_HEADER_FAILED'});
    expect(old.released).toHaveBeenCalledOnce(); expect(next.listeners.size).toBe(1);
    next.publish({title: 'New binding remains owned'}); expect(f.root.querySelector('h2')!.textContent).toBe('New binding remains owned');
    expect(f.view.inputBusy).toBe(false); expect(f.root.querySelector('.llm-chat__input')).toBe(f.input);
});
it('finishes all cleanup after an old unsubscribe fails without applying its late notifications', async () => {
    const old = binding('chat', 'old'), next = binding('chat', 'new');
    const release = vi.fn(() => {throw new Error('UNSUBSCRIBE_FAILED');});
    const source = {...old.source, subscribe: (listener: () => void) => {old.allListeners.push(listener); return release;}};
    const f = await mount({...old.options, source}); await f.view.replaceBinding(next.options);
    old.allListeners.forEach(listener => listener()); expect(f.root.querySelector('h2')!.textContent).toBe('new');
    await expect(f.view.destroy()).rejects.toThrow();
    expect(next.released).toHaveBeenCalledOnce(); expect(f.root.querySelector('.llm-chat')).toBeNull(); expect(release).toHaveBeenCalledOnce();
});
it('prepares a host operation identity and sends the frozen draft through its retained binding', async () => {
    const gate = deferred<void>(), first = binding('chat', 'project'), next = binding('chat', 'session');
    const diagnostics: unknown[] = [];
    const f = await mount({...first.options, initialDraft: {revision: 0, textRevision: 0, scopeId: 'draft', text: 'First input', attachments: []},
        onDiagnostic: event => diagnostics.push(event)});
    first.options.actions.prepareSend = async () => {
        await gate.promise; await f.view.replaceBinding(next.options);
        return {operationId: 'host-submission', viewId: 'session'};
    };
    f.input.focus(); const submitting = f.view.submit(); f.view.setText('Typed while preparing'); f.input.setSelectionRange(2, 4);
    await f.view.submit(); expect(first.send).not.toHaveBeenCalled(); gate.resolve(); await submitting;
    expect(next.send).toHaveBeenCalledWith(expect.objectContaining({text: 'First input'}), {operationId: 'host-submission', viewId: 'session'});
    expect(next.options.operations.getSnapshot()[0].context.operationId).toBe('host-submission');
    expect(first.options.operations.getSnapshot()).toEqual([]);
    expect(f.input.value).toBe('Typed while preparing'); expect(document.activeElement).toBe(f.input);
    expect([f.input.selectionStart, f.input.selectionEnd]).toEqual([2, 4]);
    expect(diagnostics).toContainEqual(expect.objectContaining({operationId: 'host-submission', stage: 'prepare', result: 'success'}));
    expect(JSON.stringify(diagnostics)).not.toContain('First input');
});
it('resumes an existing host operation without registering or sending it again', async () => {
    const first = binding(), f = await mount(first.options); f.view.setText('Keep resumed input');
    first.options.actions.prepareSend = vi.fn(async () => null);
    await f.view.submit(); expect(first.send).not.toHaveBeenCalled(); expect(first.options.operations.getSnapshot()).toEqual([]);
    expect(f.input.value).toBe('Keep resumed input');
});
it('rejects a late preparation after replacing the input scope, even with identical text', async () => {
    const gate = deferred<void>(), first = binding('chat', 'first'), next = binding('chat', 'second');
    const draft = {revision: 0, textRevision: 0, text: 'Same text', attachments: [], scopeId: 'old'};
    const f = await mount({...first.options, initialDraft: draft});
    first.options.actions.prepareSend = async () => {await gate.promise; return {operationId: 'old-operation', viewId: 'second'};};
    const sending = f.view.submit(), rejected = expect(sending).rejects.toMatchObject({code: 'STALE_VIEW'});
    await f.view.replaceBinding(next.options, {draft: {...draft, scopeId: 'new'}}); gate.resolve(); await rejected;
    expect(first.send).not.toHaveBeenCalled(); expect(next.send).not.toHaveBeenCalled(); expect(f.input.value).toBe('Same text');
});
it('keeps the draft and enables an explicit retry after host preparation fails', async () => {
    const first = binding(), f = await mount(first.options); f.view.setText('Sensitive draft');
    first.options.actions.prepareSend = vi.fn().mockRejectedValueOnce(Object.assign(new Error('Storage unavailable'), {code: 'STORE_UNAVAILABLE'}))
        .mockResolvedValue({operationId: 'stable-host-operation', viewId: 'first'});
    await expect(f.view.submit()).rejects.toMatchObject({code: 'STORE_UNAVAILABLE'});
    expect(f.input.value).toBe('Sensitive draft'); expect(first.options.operations.getSnapshot()).toEqual([]);
    await f.view.submit(); expect(first.send).toHaveBeenCalledOnce(); expect(f.input.value).toBe('');
});
it('owns binding activation and releases each binding once without changing the view methods', async () => {
    const firstActive = vi.fn(), firstRelease = vi.fn(), nextActive = vi.fn(), nextRelease = vi.fn();
    const first = binding('chat', 'first', {setActive: firstActive, release: firstRelease});
    const next = binding('chat', 'next', {setActive: nextActive, release: nextRelease}), f = await mount(first.options);
    const methods = [f.view.replaceBinding, f.view.setActive, f.view.destroy];
    expect(firstActive.mock.calls).toEqual([[true]]); f.view.setActive(false); f.view.setActive(false);
    await f.view.replaceBinding(next.options);
    expect(firstActive.mock.calls).toEqual([[true], [false]]); expect(nextActive.mock.calls).toEqual([[false]]);
    f.view.setActive(true); f.view.focus(); expect(document.activeElement).toBe(f.input);
    const closing = f.view.destroy(); expect(f.view.destroy()).toBe(closing); await closing;
    expect(firstRelease).toHaveBeenCalledOnce(); expect(nextRelease).toHaveBeenCalledOnce();
    expect(nextActive.mock.calls).toEqual([[false], [true], [false]]);
    expect([f.view.replaceBinding, f.view.setActive, f.view.destroy]).toEqual(methods);
});
it('releases a rejected replacement and keeps the old binding alive after a save failure', async () => {
    const oldRelease = vi.fn(), rejectedRelease = vi.fn();
    const old = binding('chat', 'old', {release: oldRelease, saveDraft: async () => {throw new Error('STORE_UNAVAILABLE');}});
    const f = await mount(old.options); f.view.setText('Unsaved');
    await expect(f.view.replaceBinding(binding('chat', 'rejected', {release: rejectedRelease}).options)).rejects.toMatchObject({bindingCommitted: false});
    expect(rejectedRelease).toHaveBeenCalledOnce(); expect(oldRelease).not.toHaveBeenCalled(); expect(f.input.value).toBe('Unsaved');
});
it('waits for old renderers and slots before releasing their binding resources', async () => {
    const gate = deferred<void>(), release = vi.fn(), slot = vi.fn(async () => {await gate.promise;});
    const first = binding('chat', 'old', {release, mountToolbar: () => ({destroy: slot})}), f = await mount(first.options);
    await f.view.replaceBinding(binding('chat', 'new').options);
    await vi.waitFor(() => expect(slot).toHaveBeenCalledOnce()); expect(release).not.toHaveBeenCalled();
    gate.resolve(); await vi.waitFor(() => expect(release).toHaveBeenCalledOnce());
});
it('releases rejected resources when the view is already closed', async () => {
    const f = await mount(binding().options), release = vi.fn(); await f.view.destroy();
    await expect(f.view.replaceBinding(binding('chat', 'new', {release}).options)).rejects.toMatchObject({code: 'VIEW_CLOSED'});
    expect(release).toHaveBeenCalledOnce();
});
it('releases the binding after initialization fails and still cleans up after release failures', async () => {
    const release = vi.fn(async () => {throw new Error('RELEASE_FAILED');}), initial = binding('chat', 'bad', {release,
        mountHeader: () => {throw new Error('HEADER_FAILED');}});
    await expect(mount(initial.options)).rejects.toThrow('Chat initialization failed'); expect(release).toHaveBeenCalledOnce();
    expect(document.querySelector('.llm-chat')).toBeNull();
});
