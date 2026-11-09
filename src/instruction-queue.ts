import type {JsonValue} from './contracts';
import {parseArgumentJson} from './argument-json';
import {randomUUID} from './random';

export type InstructionState = 'pending' | 'dispatching' | 'failed' | 'uncertain';
export interface InstructionQueueSnapshot {
    recoveries?: Array<{id: string; turnId: string; recoveredAt: number; outcome: 'unknown'}>;
    recovery?: {id: string; required?: boolean};
    ownerId: string; revision: number; paused: boolean; reason?: string;
    items: Array<{id: string; text: string; state: InstructionState; agentId?: string; targetLabel?: string; input?: JsonValue;
        observation?: {lastProgressAt: number; code?: string; stopping?: boolean}; textEditable?: boolean; files: Array<{name: string}>; error?: string; createdAt?: number; dispatchedAt?: number; acceptedAt?: number}>;
}
export type InstructionQueueChange = {action: 'pause' | 'resume'} | {action: 'remove' | 'retry' | 'recover'; id: string} | {action: 'check'; id: string} | {action: 'stop'; id: string}
    | {action: 'update'; id: string; text: string} | {action: 'update-input'; id: string; value: JsonValue; text: string}
    | {action: 'reorder' | 'merge'; ids: string[]};
export type InstructionQueueEdit = InstructionQueueChange & {expectedRevision: number};
export interface InstructionQueueViewOptions {
    ownerId: string;
    locale?: string;
    initiallyCollapsed?: boolean;
    attentionAfterMs?: number;
    executionControl?: boolean;
    sessionHref?: string;
    toggleIcon?: string;
    labels: Record<'title' | 'resume' | 'pause' | 'merge' | 'paused' | 'hint' | 'attachments' | 'up' | 'down' | 'retry'
        | 'edit' | 'editFailed' | 'save' | 'cancel' | 'remove', string> & {states: Record<InstructionState, string>; reasons?: Record<string, string>; arguments?: string; invalidArguments?: string; createdAt?: string; dispatchedAt?: string; acceptedAt?: string; expand?: string; collapse?: string; recover?: string; confirmRecovery?: string; recovered?: string; recoveryRequired?: string; needsCheck?: string; stalled?: string; check?: string; stop?: string; confirmStop?: string; stopping?: string; lastProgress?: string; openSession?: string};
    removeIcon?: string;
    edit(change: InstructionQueueEdit): Promise<InstructionQueueSnapshot>;
    read(): Promise<InstructionQueueSnapshot>;
    onDiagnostic?(event: {operationId: string; action: string; stage: string; result: 'pending' | 'success' | 'failure';
        instructionId?: string; expectedRevision?: number; revision?: number; durationMs: number; code?: string}): void;
}
function escapeHTML(value: string): string {
    return value.replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]!));
}

/** A projection and command editor; dispatch belongs exclusively to the Session backend. */
export class InstructionQueueView {
    private attentionTimer?: ReturnType<typeof setTimeout>;
    private stopConfirmation?: {id: string; revision: number};
    private recoveryConfirmation?: {id: string; revision: number; operationId: string};
    private queue?: InstructionQueueSnapshot;
    private editing?: {id: string; text: string; input?: string; revision: number};
    private readonly selected = new Set<string>();
    private busy = false;
    private closed = false;
    private readOnly = false;
    private error = '';
    private diagnosticRevision?: number;
    private collapsed: boolean;
    private expandedScroll = 0;
    private readonly bodyId = `instruction-queue-${randomUUID()}`;
    private readonly events = new AbortController();
    constructor(private readonly element: HTMLElement, private readonly options: InstructionQueueViewOptions) {
        this.collapsed = options.initiallyCollapsed ?? false;
        element.className = 'llm-instruction-queue'; element.hidden = true;
        element.addEventListener('click', event => this.click(event), { signal: this.events.signal });
        element.addEventListener('input', event => {
            if (this.editing && event.target instanceof HTMLTextAreaElement) {
                if (event.target.dataset.argumentInput !== undefined) this.editing.input = event.target.value;
                else this.editing.text = event.target.value;
            }
        }, {signal: this.events.signal});
        element.addEventListener('change', event => {
            const input = (event.target as HTMLElement).closest<HTMLInputElement>('input[data-select]');
            if (!input) return;
            if (input.checked) this.selected.add(input.dataset.select!); else this.selected.delete(input.dataset.select!);
            this.render();
        }, { signal: this.events.signal });
    }

    update(queue?: InstructionQueueSnapshot): void {
        if (this.closed || !queue || queue.ownerId !== this.options.ownerId || this.queue && (queue.revision < this.queue.revision
            || queue.revision === this.queue.revision && queue.reason === this.queue.reason && queue.recovery?.id === this.queue.recovery?.id && queue.recovery?.required === this.queue.recovery?.required && JSON.stringify(queue.items.map(item => item.observation)) === JSON.stringify(this.queue.items.map(item => item.observation)))) return;
        if (this.recoveryConfirmation && (this.recoveryConfirmation.revision !== queue.revision || this.recoveryConfirmation.id !== queue.recovery?.id))
            {this.diagnose(this.recoveryConfirmation.operationId, 'recover', 'confirmation_invalidated', 'failure', this.recoveryConfirmation.id, 0, 'QUEUE_CHANGED', queue.revision); this.recoveryConfirmation = undefined;}
        if (this.stopConfirmation?.revision !== queue.revision) this.stopConfirmation = undefined;
        this.queue = this.queue?.revision === queue.revision ? {...this.queue, reason: queue.reason, recovery: queue.recovery,
            items: this.queue.items.map(item => ({...item, observation: queue.items.find(row => row.id === item.id)?.observation}))} : queue;
        for (const id of this.selected) if (!this.queue.items.some(item => item.id === id && item.state === 'pending')) this.selected.delete(id);
        this.render();
    }
    setReadOnly(value: boolean): void {
        if (this.closed || this.readOnly === value) return;
        this.readOnly = value;
        if (this.queue?.recovery) this.diagnose(randomUUID(), 'recover', 'availability', value ? 'failure' : 'success', this.queue.recovery.id, 0, value ? 'QUEUE_READ_ONLY' : undefined);
        this.render();
    }

    private render(): void {
        const queue = this.queue;
        if (!queue) return;
        this.scheduleAttention(queue);
        this.element.hidden = this.hidden(queue);
        this.element.setAttribute('aria-label', this.options.labels.title);
        const focus = document.activeElement instanceof HTMLTextAreaElement && this.element.contains(document.activeElement) ? document.activeElement : null;
        const toggleFocused = document.activeElement === this.element.querySelector('[data-action="toggle"]');
        const selection = focus ? [focus.selectionStart, focus.selectionEnd] : undefined;
        const selector = focus?.dataset.argumentInput !== undefined ? '[data-argument-input]' : 'textarea:not([data-argument-input])';
        const scrollTop = this.element.scrollTop;
        this.element.innerHTML = this.disclosure(queue); this.updateDisclosure(); this.element.scrollTop = scrollTop;
        const input = this.element.querySelector<HTMLTextAreaElement>(selector);
        if (input && selection) {input.focus(); input.setSelectionRange(selection[0], selection[1]);}
        else if (toggleFocused) this.element.querySelector<HTMLButtonElement>('[data-action="toggle"]')!.focus();
    }

    private disclosure(queue: InstructionQueueSnapshot): string {
        const state = queue.items.some(item => item.state === 'uncertain') ? 'uncertain'
            : queue.items.some(item => item.state === 'failed') ? 'failed'
            : queue.items.some(item => item.state === 'pending') ? 'pending' : 'dispatching';
        const status = this.attention(queue) ? this.options.labels.needsCheck ?? this.options.labels.states.uncertain : this.error ? this.options.labels.editFailed : queue.recovery?.required && this.options.labels.recoveryRequired ? this.options.labels.recoveryRequired : ['failed', 'uncertain'].includes(state)
            ? this.options.labels.states[state] : queue.reason && this.options.labels.reasons?.[queue.reason]
                || (queue.paused ? this.options.labels.paused : this.options.labels.states[state]);
        this.element.dataset.attention = String(this.attention(queue) || !!this.error || !!queue.recovery?.required || ['failed', 'uncertain'].includes(state));
        return `<button type="button" class="llm-instruction-queue__toggle" data-action="toggle" aria-controls="${this.bodyId}">
            ${this.options.toggleIcon ?? ''}<strong>${escapeHTML(this.options.labels.title)} · ${queue.items.length}</strong>
            <span class="llm-instruction-queue__status" aria-live="polite">${escapeHTML(status)}</span></button>
            <div id="${this.bodyId}" class="llm-instruction-queue__body">${this.markup(queue)}</div>`;
    }
    private updateDisclosure(): void {
        this.element.dataset.collapsed = String(this.collapsed);
        const toggle = this.element.querySelector<HTMLButtonElement>('[data-action="toggle"]')!;
        const label = (this.collapsed ? this.options.labels.expand : this.options.labels.collapse) ?? this.options.labels.title;
        toggle.setAttribute('aria-expanded', String(!this.collapsed)); toggle.setAttribute('aria-label', label); toggle.title = label;
        this.element.querySelector<HTMLElement>('.llm-instruction-queue__body')!.hidden = this.collapsed;
    }
    private toggle(): void {
        if (!this.collapsed) this.expandedScroll = this.element.scrollTop;
        this.collapsed = !this.collapsed; this.updateDisclosure();
        if (this.collapsed) this.element.querySelector<HTMLButtonElement>('[data-action="toggle"]')!.focus();
        else this.element.scrollTop = this.expandedScroll;
    }

    private hidden(queue: InstructionQueueSnapshot): boolean {
        return !this.attention(queue) && !this.error && !queue.recovery && (!queue.items.length && !queue.recoveries?.length || queue.items.length === 1 && queue.items[0].state === 'dispatching' && !queue.paused);
    }
    private markup(queue: InstructionQueueSnapshot): string {
        return `<header>
            ${this.button(queue.paused ? 'resume' : 'pause', queue.paused ? this.options.labels.resume : this.options.labels.pause)}
            ${this.button('merge', this.options.labels.merge, this.selected.size < 2)}</header>
            <p class="llm-instruction-queue__hint">${escapeHTML(queue.paused && queue.recoveries?.length && this.options.labels.recovered ? this.options.labels.recovered : queue.paused ? this.options.labels.paused : this.options.labels.hint)}</p>
            ${queue.reason ? `<p class="llm-instruction-queue__reason">${escapeHTML(this.options.labels.reasons?.[queue.reason] ?? queue.reason)}</p>` : ''}
            ${this.attentionMarkup(queue)}
            <ol>${queue.items.map((item, index) => this.row(item, index)).join('')}</ol>
            <p class="llm-instruction-queue__error" role="alert">${escapeHTML(this.error)}</p>`;
    }
    private row(item: InstructionQueueSnapshot['items'][number], index: number): string {
        const pending = item.state === 'pending', waiting = this.queue!.items.filter(entry => entry.state === 'pending');
        const position = waiting.findIndex(entry => entry.id === item.id);
        return `<li data-instruction="${escapeHTML(item.id)}"><label><input type="checkbox" data-select="${escapeHTML(item.id)}"
            ${this.selected.has(item.id) ? 'checked' : ''} ${!pending || this.busy || this.readOnly ? 'disabled' : ''}>
            ${this.content(item)}</label>
            <span class="llm-instruction-queue__meta">${index + 1} · ${escapeHTML(this.queue?.recovery?.required && this.queue.recovery.id === item.id ? this.options.labels.recoveryRequired ?? this.options.labels.states[item.state] : this.options.labels.states[item.state])}${item.targetLabel || item.agentId ? ` · ${escapeHTML(item.targetLabel ?? item.agentId!)}` : ''}${item.files.length ? ` · ${item.files.length} ${escapeHTML(this.options.labels.attachments)}` : ''}</span>
            ${this.times(item)}${this.rowActions(item, pending, position, waiting.length)}
            ${item.error ? `<p class="llm-instruction-queue__error">${escapeHTML(this.options.labels.reasons?.[item.error] ?? item.error)}</p>` : ''}</li>`;
    }

    private content(item: InstructionQueueSnapshot['items'][number]): string {
        if (this.editing?.id !== item.id) return `<span class="llm-instruction-queue__text">${escapeHTML(item.text)}${item.input !== undefined ? `\n${escapeHTML(JSON.stringify(item.input, null, 2))}` : ''}</span>`;
        const text = item.textEditable === false ? '' : `<textarea class="llm-instruction-queue__editor" ${this.readOnly ? 'readonly' : ''} aria-label="${escapeHTML(this.options.labels.edit)}">${escapeHTML(this.editing.text)}</textarea>`;
        return text + (this.editing.input === undefined ? '' : `<textarea data-argument-input class="llm-instruction-queue__editor" ${this.readOnly ? 'readonly' : ''} aria-label="${escapeHTML(this.options.labels.arguments ?? this.options.labels.edit)}">${escapeHTML(this.editing.input)}</textarea>`);
    }
    private times(item: InstructionQueueSnapshot['items'][number]): string {
        return (['createdAt', 'dispatchedAt', 'acceptedAt'] as const).flatMap(key => {
            const date = new Date(item[key] ?? NaN);
            if (!Number.isFinite(date.getTime()) || date.getTime() <= 0) return [];
            const label = this.options.labels[key] ?? '';
            const time = date.toLocaleTimeString(this.options.locale, {hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false});
            return [`<span class="llm-instruction-queue__meta">${escapeHTML(label)} <time datetime="${date.toISOString()}" title="${escapeHTML(date.toLocaleString(this.options.locale))}">${escapeHTML(time)}</time></span>`];
        }).join('');
    }
    private rowActions(item: InstructionQueueSnapshot['items'][number], pending: boolean, position: number, total: number): string {
        return `<div class="llm-instruction-queue__actions">${this.button('up', this.options.labels.up, !pending || position === 0)}
            ${this.editing?.id === item.id ? this.button('save', this.options.labels.save) + this.button('cancel', this.options.labels.cancel) : this.button('edit', this.options.labels.edit, !pending)}
            ${this.button('down', this.options.labels.down, !pending || position === total - 1)}
            ${this.queue?.recovery?.id === item.id && this.options.labels.recover ? this.button('recover', this.recoveryConfirmation?.id === item.id ? this.options.labels.confirmRecovery ?? this.options.labels.recover : this.options.labels.recover) : ''}
            ${item.state === 'failed' ? this.button('retry', this.options.labels.retry) : ''}
            ${this.button('remove', this.options.labels.remove, item.state === 'dispatching' || item.state === 'uncertain', this.options.removeIcon)}</div>`;
    }
    private button(action: string, label: string, disabled = false, icon?: string): string {
        return `<button type="button" data-action="${action}" title="${escapeHTML(label)}" aria-label="${escapeHTML(label)}" ${disabled || this.busy || this.readOnly ? 'disabled' : ''}>${icon ?? escapeHTML(label)}</button>`;
    }

    private click(event: Event): void {
        const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]');
        if (!button || button.disabled || !this.queue) return;
        const action = button.dataset.action!, id = button.closest<HTMLElement>('[data-instruction]')?.dataset.instruction;
        this.activate(action, id);
    }
    private activate(action: string, id?: string): void {
        if (action === 'toggle') {this.toggle(); return;}
        if (this.collapsed) return;
        if (this.editAction(action, id)) return;
        if (action === 'stop' && id) {this.stop(id); return;}
        if (action === 'recover' && id) {this.recover(id); return;}
        switch (action) {
            case 'up': case 'down': this.move(id!, action); break;
            case 'merge': void this.edit({action, ids: [...this.selected]}); break;
            case 'pause': case 'resume': void this.edit({action}); break;
            case 'check': case 'remove': case 'retry': void this.edit({action, id: id!}); break;
        }
    }
    private stop(id: string): void {
        if (this.stopConfirmation?.id !== id || this.stopConfirmation.revision !== this.queue!.revision) {
            this.stopConfirmation = {id, revision: this.queue!.revision}; this.render(); return;
        }
        this.stopConfirmation = undefined;
        void this.edit({action: 'stop', id});
    }
    private attention(queue: InstructionQueueSnapshot): boolean {
        const head = queue.items[0];
        if (!head || !['dispatching', 'uncertain'].includes(head.state)) return false;
        const since = head.observation?.lastProgressAt ?? head.dispatchedAt ?? head.createdAt;
        return !!head.observation?.code || head.state === 'uncertain' || !!(this.options.attentionAfterMs && since
            && Date.now() - since >= this.options.attentionAfterMs);
    }
    private scheduleAttention(queue: InstructionQueueSnapshot): void {
        clearTimeout(this.attentionTimer); this.attentionTimer = undefined;
        const head = queue.items[0], threshold = this.options.attentionAfterMs;
        if (!head || !threshold || this.attention(queue) || !['dispatching', 'uncertain'].includes(head.state)) return;
        const since = head.observation?.lastProgressAt ?? head.dispatchedAt ?? head.createdAt;
        if (since) this.attentionTimer = setTimeout(() => {if (!this.closed) this.render();}, Math.max(1, since + threshold - Date.now()));
    }
    private attentionMarkup(queue: InstructionQueueSnapshot): string {
        const head = queue.items[0], labels = this.options.labels;
        if (!head || !['dispatching', 'uncertain'].includes(head.state)) return '';
        const since = head.observation?.lastProgressAt ?? head.dispatchedAt ?? head.createdAt;
        const warning = this.attention(queue) ? `<p class="llm-instruction-queue__error" role="status">${escapeHTML(head.observation?.code ?? labels.stalled ?? labels.states.uncertain)}</p>` : '';
        const time = since ? `<p>${escapeHTML(labels.lastProgress ?? '')} <time>${escapeHTML(new Date(since).toLocaleString(this.options.locale))}</time></p>` : '';
        const controls = this.options.executionControl ? `${this.button('check', labels.check ?? labels.retry)}
            ${this.button('stop', this.stopConfirmation?.id === head.id ? labels.confirmStop ?? labels.cancel : labels.stop ?? labels.cancel, !!head.observation?.stopping)}` : '';
        const link = this.options.sessionHref ? `<a href="${escapeHTML(this.options.sessionHref)}">${escapeHTML(labels.openSession ?? '')}</a>` : '';
        return `<section data-instruction="${escapeHTML(head.id)}">${warning}${time}${head.observation?.stopping ? `<p role="status">${escapeHTML(labels.stopping ?? labels.states.uncertain)}</p>` : ''}<div class="llm-instruction-queue__actions">${controls}${link}</div></section>`;
    }

    private recover(id: string): void {
        if (this.queue?.recovery?.id !== id) return;
        if (this.recoveryConfirmation?.id !== id || this.recoveryConfirmation.revision !== this.queue.revision) {
            this.recoveryConfirmation = {id, revision: this.queue.revision, operationId: randomUUID()};
            this.diagnose(this.recoveryConfirmation.operationId, 'recover', 'confirmation', 'pending', id); this.render(); return;
        }
        const operationId = this.recoveryConfirmation.operationId;
        this.recoveryConfirmation = undefined;
        void this.edit({action: 'recover', id}, operationId);
    }
    private editAction(action: string, id?: string): boolean {
        if (action === 'edit') {
            const item = this.queue!.items.find(row => row.id === id)!; this.editing = {id: item.id, text: item.text, revision: this.queue!.revision,
                ...(item.input !== undefined ? {input: JSON.stringify(item.input, null, 2)} : {})};
            this.render(); this.element.querySelector<HTMLTextAreaElement>('textarea')?.focus(); return true;
        }
        if (action === 'cancel') {this.editing = undefined; this.render(); return true;}
        if (action === 'save' && this.editing) {this.saveInput(); return true;}
        return false;
    }

    private saveInput(): void {
        if (!this.editing) return;
        if (this.editing.input === undefined) {void this.edit({action: 'update', id: this.editing.id, text: this.editing.text}); return;}
        try {void this.edit({action: 'update-input', id: this.editing.id, text: this.editing.text, value: parseArgumentJson(this.editing.input)});}
        catch {this.error = this.options.labels.invalidArguments ?? this.options.labels.editFailed; this.render();}
    }
    private move(id: string, action: 'up' | 'down'): void {
        const ids = this.queue!.items.filter(item => item.state === 'pending').map(item => item.id);
        const from = ids.indexOf(id), to = from + (action === 'up' ? -1 : 1);
        [ids[from], ids[to]] = [ids[to], ids[from]];
        void this.edit({action: 'reorder', ids});
    }

    private async edit(edit: InstructionQueueChange, operationId = randomUUID()): Promise<void> {
        const id = 'id' in edit ? edit.id : undefined, started = Date.now();
        if (this.busy || this.readOnly || !this.queue) {this.diagnose(operationId, edit.action, 'admission', 'failure', id, 0, 'QUEUE_EDIT_BLOCKED'); return;}
        const changesInput = ['update', 'update-input'].includes(edit.action);
        const expectedRevision = changesInput ? this.editing!.revision : this.queue.revision;
        this.diagnosticRevision = expectedRevision; this.diagnose(operationId, edit.action, 'submit', 'pending', id);
        this.busy = true; this.error = ''; this.render();
        try {
            const queue = await this.options.edit({ ...edit, expectedRevision });
            if (changesInput) this.editing = undefined;
            this.update(queue);
            this.diagnose(operationId, edit.action, 'complete', 'success', id, Date.now() - started);
        } catch (error) {
            this.error = error instanceof Error ? error.message : this.options.labels.editFailed;
            const code = (error as {remoteCode?: string; code?: string})?.remoteCode ?? (error as {code?: string})?.code;
            this.diagnose(operationId, edit.action, 'complete', 'failure', id, Date.now() - started, code && /^[A-Z][A-Z0-9_]{0,79}$/.test(code) ? code : 'QUEUE_EDIT_FAILED');
            try { this.update(await this.options.read()); }
            catch { /* Preserve the last confirmed projection and the actionable error. */ }
        } finally { this.busy = false; this.diagnosticRevision = undefined; if (!this.closed) this.render(); }
    }

    private diagnose(operationId: string, action: string, stage: string, result: 'pending' | 'success' | 'failure', instructionId?: string, durationMs = 0, code?: string, revision = this.queue?.revision): void {
        try {this.options.onDiagnostic?.({operationId, action, stage, result, instructionId,
            expectedRevision: this.diagnosticRevision ?? this.recoveryConfirmation?.revision ?? this.queue?.revision, revision, durationMs, code});}
        catch { /* Diagnostics must not change queue operations. */ }
    }

    destroy(): void { this.closed = true; clearTimeout(this.attentionTimer); this.events.abort(); this.element.remove(); }
}
