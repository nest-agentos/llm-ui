import {afterEach, expect, it, vi} from 'vitest';
import {InstructionQueueView, type InstructionQueueSnapshot, type InstructionQueueViewOptions} from '../src/instruction-queue';

const views: InstructionQueueView[] = [];
it('shows persisted admission stages with seconds and leaves unknown times absent', () => {
    const f = setup(), createdAt = Date.now();
    expect(f.host.querySelector('time')).toBeNull();
    f.view.update({...f.queue, revision: 8, items: [{...f.queue.items[0], createdAt}]});
    expect(f.host.querySelectorAll('time')).toHaveLength(1);
    expect(f.host.querySelector('time')!.dateTime).toBe(new Date(createdAt).toISOString());
    expect(f.host.querySelector('time')!.textContent).toMatch(/\d{2}:\d{2}:\d{2}/);
    f.view.update({...f.queue, revision: 9, items: [{...f.queue.items[0], createdAt, dispatchedAt: createdAt + 1000, acceptedAt: createdAt + 2000}]});
    expect([...f.host.querySelectorAll('time')].map(node => node.dateTime)).toEqual([createdAt, createdAt + 1000, createdAt + 2000].map(time => new Date(time).toISOString()));
});
afterEach(() => {views.splice(0).forEach(view => view.destroy()); document.body.replaceChildren();});
function setup(options: Partial<InstructionQueueViewOptions> = {}) {
    const host = document.createElement('section'); document.body.append(host);
    const queue: InstructionQueueSnapshot = {ownerId: 'conversation', revision: 7, paused: false,
        items: [{id: 'a', text: 'Original', state: 'pending', files: []}]};
    const labels: InstructionQueueViewOptions['labels'] = {
        title: 'Queue', resume: 'Resume', pause: 'Pause', merge: 'Merge', paused: 'Paused', hint: 'Queued', attachments: 'Attachments',
        up: 'Up', down: 'Down', retry: 'Retry', edit: 'Edit', editFailed: 'Edit failed', save: 'Save', cancel: 'Cancel', remove: 'Remove',
        states: {pending: 'Pending', dispatching: 'Running', failed: 'Failed', uncertain: 'Unknown'},
    };
    const edit = vi.fn(async () => ({...queue, revision: 9})), read = vi.fn(async () => queue);
    const view = new InstructionQueueView(host, {ownerId: queue.ownerId, labels, edit, read, ...options}); views.push(view); view.update(queue);
    const click = (action: string) => host.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)!.click();
    return {host, view, edit, read, queue, click};
}

it('collapses without discarding edits or selections and stays collapsed through queue updates', async () => {
    const f = setup({initiallyCollapsed: true}), body = () => f.host.querySelector<HTMLElement>('.llm-instruction-queue__body')!;
    const toggle = () => f.host.querySelector<HTMLButtonElement>('[data-action="toggle"]')!;
    expect(body().hidden).toBe(true); expect(toggle().getAttribute('aria-expanded')).toBe('false');
    f.click('toggle'); const checkbox = f.host.querySelector<HTMLInputElement>('[data-select="a"]')!;
    checkbox.checked = true; checkbox.dispatchEvent(new Event('change', {bubbles: true})); f.click('edit');
    const input = f.host.querySelector<HTMLTextAreaElement>('textarea')!;
    input.value = 'Unsent edit'; input.dispatchEvent(new Event('input', {bubbles: true}));
    f.click('toggle'); expect(body().hidden).toBe(true); expect(f.host.querySelector('textarea')).toBe(input);
    expect(document.activeElement).toBe(toggle());
    f.view.update({...f.queue, revision: 8, paused: true});
    expect(body().hidden).toBe(true); expect(toggle().textContent).toContain('Paused'); expect(document.activeElement).toBe(toggle());
    f.click('toggle'); expect(body().hidden).toBe(false); expect(f.host.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe('Unsent edit');
    expect(f.host.querySelector<HTMLInputElement>('[data-select="a"]')!.checked).toBe(true);
    expect(f.edit).not.toHaveBeenCalled(); expect(f.read).not.toHaveBeenCalled();
    f.click('save'); await vi.waitFor(() => expect(f.edit).toHaveBeenCalledWith({action: 'update', id: 'a', text: 'Unsent edit', expectedRevision: 7}));
});

it('keeps failed status visible in the compact entry and allows read-only users to expand it', () => {
    const f = setup({initiallyCollapsed: true}); f.view.setReadOnly(true);
    f.view.update({...f.queue, revision: 8, paused: true, items: [{...f.queue.items[0], state: 'failed', error: 'Rejected'}]});
    expect(f.host.querySelector('.llm-instruction-queue__status')!.textContent).toBe('Failed');
    expect(f.host.dataset.attention).toBe('true');
    expect(f.host.querySelector<HTMLButtonElement>('[data-action="toggle"]')!.disabled).toBe(false);
    f.click('toggle'); expect(f.host.querySelector<HTMLElement>('.llm-instruction-queue__body')!.hidden).toBe(false);
    expect(f.host.querySelector<HTMLButtonElement>('[data-action="retry"]')!.disabled).toBe(true);
    expect(f.edit).not.toHaveBeenCalled();
});

it('updates a changed blocking reason at the same queue revision while retaining the edit CAS revision', async () => {
    const f = setup(); f.click('edit');
    f.view.update({...f.queue, reason: 'terminal-unconfirmed'});
    expect(f.host.querySelector('.llm-instruction-queue__reason')!.textContent).toBe('terminal-unconfirmed');
    f.click('save'); await vi.waitFor(() => expect(f.edit).toHaveBeenCalledWith(expect.objectContaining({expectedRevision: 7})));
});

it.each(['missing', 'throws'])('keeps stable, distinct disclosure identities without native UUID (%s)', mode => {
    const original = globalThis.crypto;
    vi.stubGlobal('crypto', {getRandomValues: original.getRandomValues.bind(original),
        ...(mode === 'throws' ? {randomUUID: () => {throw new Error('Unavailable');}} : {})});
    try {
        const first = setup({initiallyCollapsed: true}), second = setup({initiallyCollapsed: true});
        const identity = (host: HTMLElement) => host.querySelector('[data-action="toggle"]')!.getAttribute('aria-controls');
        const id = identity(first.host)!;
        expect(id).not.toBe(identity(second.host)); expect(document.getElementById(id)).toBe(first.host.querySelector('.llm-instruction-queue__body'));
        first.view.update({...first.queue, revision: 8}); first.click('toggle');
        expect(identity(first.host)).toBe(id);
    } finally {vi.unstubAllGlobals();}
});

it('preserves edited text and selection across notifications and saves with the original revision', async () => {
    const f = setup(); f.click('edit');
    let input = f.host.querySelector<HTMLTextAreaElement>('textarea')!;
    input.value = 'Edited <script>text</script>'; input.dispatchEvent(new Event('input', {bubbles: true})); input.setSelectionRange(2, 8);
    f.view.update({...f.queue, revision: 8, paused: true});
    input = f.host.querySelector<HTMLTextAreaElement>('textarea')!;
    expect(input.value).toBe('Edited <script>text</script>'); expect([input.selectionStart, input.selectionEnd]).toEqual([2, 8]);
    expect(f.host.querySelector('script')).toBeNull();
    f.click('save');
    await vi.waitFor(() => expect(f.edit).toHaveBeenCalledWith({action: 'update', id: 'a', text: 'Edited <script>text</script>', expectedRevision: 7}));
});

it('refreshes a conflicting edit without replaying it or losing the user text', async () => {
    const f = setup(); f.click('edit');
    const input = f.host.querySelector<HTMLTextAreaElement>('textarea')!;
    input.value = 'Keep my edit'; input.dispatchEvent(new Event('input', {bubbles: true}));
    f.edit.mockRejectedValueOnce(new Error('Queue changed; refresh before editing'));
    f.read.mockResolvedValueOnce({...f.queue, revision: 8}); f.click('save');
    await vi.waitFor(() => expect(f.host.querySelector('[role="alert"]')?.textContent).toContain('Queue changed'));
    expect(f.edit).toHaveBeenCalledOnce(); expect(f.host.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe('Keep my edit');
    f.view.update({...f.queue, revision: 9, items: [{...f.queue.items[0], state: 'uncertain'}]});
    expect(f.host.querySelector<HTMLButtonElement>('[data-action="remove"]')!.disabled).toBe(true);
    f.view.destroy(); f.view.update({...f.queue, revision: 99}); expect(document.body.children).toHaveLength(0);
});

it('edits structured arguments with the original revision and retains invalid JSON locally', async () => {
    const f = setup(); f.view.update({...f.queue, revision: 8, items: [{...f.queue.items[0], textEditable: false, input: {count: 0}}]});
    f.click('edit'); let input = f.host.querySelector<HTMLTextAreaElement>('[data-argument-input]')!;
    expect(f.host.querySelectorAll('textarea')).toHaveLength(1);
    input.value = '{invalid'; input.dispatchEvent(new Event('input', {bubbles: true})); f.click('save');
    expect(f.edit).not.toHaveBeenCalled(); expect(f.host.querySelector<HTMLTextAreaElement>('[data-argument-input]')!.value).toBe('{invalid');
    input = f.host.querySelector<HTMLTextAreaElement>('[data-argument-input]')!; input.value = '{"count":2}';
    input.dispatchEvent(new Event('input', {bubbles: true})); input.focus(); input.setSelectionRange(2, 7);
    f.view.update({...f.queue, revision: 9, items: [{...f.queue.items[0], textEditable: false, input: {count: 1}}]});
    input = f.host.querySelector<HTMLTextAreaElement>('[data-argument-input]')!;
    expect(input.value).toBe('{"count":2}'); expect([input.selectionStart, input.selectionEnd]).toEqual([2, 7]);
    f.click('save'); await vi.waitFor(() => expect(f.edit).toHaveBeenCalledWith({action: 'update-input', id: 'a', text: 'Original', value: {count: 2}, expectedRevision: 8}));
});

it('shows timed recovery at the same revision and requires confirmation before editing', async () => {
    const f = setup({labels: {title: 'Queue', resume: 'Resume', pause: 'Pause', merge: 'Merge', paused: 'Paused', hint: 'Queued', attachments: 'Attachments',
        up: 'Up', down: 'Down', retry: 'Retry', edit: 'Edit', editFailed: 'Edit failed', save: 'Save', cancel: 'Cancel', remove: 'Remove',
        recover: 'Recover session', confirmRecovery: 'Confirm unknown outcome', states: {pending: 'Pending', dispatching: 'Running', failed: 'Failed', uncertain: 'Unknown'}}});
    const queue = {...f.queue, items: [{...f.queue.items[0], state: 'dispatching' as const}]};
    f.view.update({...queue, revision: 9}); expect(f.host.hidden).toBe(true);
    f.view.update({...queue, revision: 9, recovery: {id: queue.items[0].id}}); expect(f.host.hidden).toBe(false);
    f.click('recover'); expect(f.edit).not.toHaveBeenCalled();
    expect(f.host.querySelector('[data-action="recover"]')!.textContent).toBe('Confirm unknown outcome');
    f.click('recover'); await Promise.resolve();
    expect(f.edit).toHaveBeenCalledWith({action: 'recover', id: queue.items[0].id, expectedRevision: 9});
});

it('keeps the unknown outcome notice visible after the recovered queue becomes empty', () => {
    const f = setup();
    f.view.update({...f.queue, revision: 9, paused: true, items: [], recoveries: [{id: 'a', turnId: 'old', recoveredAt: 1, outcome: 'unknown'}]});
    expect(f.host.hidden).toBe(false);
    expect(f.host.querySelector('[data-action="recover"]')).toBeNull();
});
