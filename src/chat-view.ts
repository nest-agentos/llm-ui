import {ToolOutputGroups} from './tool-groups';
import {ChatOcr} from './ocr';
import {bindChatScrollRouting} from './chat-scroll-routing';
import {mountTitleBar as mountSharedTitleBar} from '@nestos/ui-common';
import {DisclosureController} from './disclosure';
import {isCommandInput} from './commands';
import { randomUUID } from './random';
import { DefaultPrintService } from '@nestos/mdxeditor';
import type { ActionName, ChatMessage, ChatOptions, ChatView, CommandSubmission, ConversationSnapshot, JsonValue,
    MessageTarget, MountedToolbar, OperationContext, OperationReceipt, OperationRecord, ChatBinding, ComposerDraft, BindingDiagnostic, ChatSubmission, SendPreparation } from './contracts';
import { Composer } from './composer';
import { DraftWriter } from './draft';
import { button, presentButton, disposeAll, element, errorText } from './dom';
import { InteractionCard } from './interactions';
import { translator } from './i18n';
import { MessageView } from './message';
import { FlowFeature } from './flow-feature';
import { ConversationSearch } from './search';
import {diagnoseOperation} from './diagnostics';
import {ExecutionStatus} from './execution-status';
import {registerOperation, settleOperation} from './operation-journal';
import {getOperationCallInput} from './submission-input';
import {ScrollController} from './scroll';
import {PromptNavigator} from './prompt-navigation';
import {assertBinding, BindingLifetime, BindingObservation, diagnoseBinding, replaceBindingOptions} from './binding';

interface BindingChange {
    operationId: string; started: number; stage: BindingDiagnostic['stage'];
    prepared?: BindingObservation; committed: boolean;
}

export class ChatController implements ChatView {
    private readonly root = element('section', 'llm-chat');
    private readonly header = element('header', 'llm-chat__header');
    private readonly headerExtra = element('div', 'llm-chat__header-extra');
    private defaultTitleBar?: ReturnType<typeof mountSharedTitleBar>;
    private readonly headerPrimary = element('div', 'llm-chat__header-primary');
    private readonly headerMenu = element('details', 'llm-chat__host-menu');
    private readonly headerMenuBody = element('div', 'llm-chat__header-menu-body');
    private readonly heading = element('h2', 'llm-chat__title');
    private readonly status = element('span', 'llm-chat__status');
    private readonly toolbar = element('div', 'llm-chat__toolbar');
    private readonly history = element('div', 'llm-chat__history');
    private readonly requests = element('div', 'llm-chat__interactions');
    private scroll!: ScrollController;
    private readonly navigation: PromptNavigator;
    private readonly promptsButton: HTMLButtonElement;
    private readonly operationStatus = element('div', 'llm-chat__operations');
    private readonly earlier: HTMLButtonElement;
    private readonly cancel: HTMLButtonElement;
    private readonly composer: Composer;
    private writer: DraftWriter;
    private observation?: BindingObservation;
    private lifetime: BindingLifetime;
    private disclosure: DisclosureController;
    private replacing = false;
    private draftViews?: Set<string>;
    private readonly flow: FlowFeature;
    private readonly search: ConversationSearch;
    private readonly rows = new Map<string, { view: MessageView; message: ChatMessage; permissions: string }>();
    private readonly cards = new Map<string, InteractionCard>();
    private readonly disposers: (() => void | Promise<void>)[] = [];
    private readonly retiring = new Set<Promise<void>>();
    private readonly retirementErrors: unknown[] = [];
    private readonly reads = new Set<AbortController>();
    private confirming = new Set<string>();
    private readonly inFlight = new Map<string, string>();
    private readonly t;
    private readonly executionStatus: ExecutionStatus;
    private snapshot!: ConversationSnapshot;
    private binding?: { viewId: string; conversationId: string };
    private slot?: MountedToolbar;
    private headerSlot?: MountedToolbar;
    private composerSlot?: MountedSlot;
    private startSlot?: MountedSlot;
    private arrangeHeader = () => {};
    private ocr: ChatOcr;
    private toolGroups: ToolOutputGroups;
    private active = true;
    private closed = false;
    private reading = false;
    private earlierError = '';
    private registering?: string;
    private preparing?: symbol;
    private acceptedPlugins = new Set<string>();
    private disposed?: Promise<void>;
    constructor(private readonly container: HTMLElement, private options: ChatOptions) {
        this.lifetime = new BindingLifetime(options);
        this.disclosure = new DisclosureController(this.history, options.disclosure);
        this.t = translator(options.locale, options.translate);
        this.toolGroups = new ToolOutputGroups(this.history, this.t, this.disclosure);
        this.executionStatus = new ExecutionStatus(this.status, this.t);
        this.disposers.push(() => this.executionStatus.destroy());
        this.writer = new DraftWriter(options.saveDraft, error => this.report(error));
        this.flow = new FlowFeature(this.t('flow'), options.flow, error => this.report(error));
        this.search = new ConversationSearch(this.root, this.history, this.t, id => {this.scroll.pauseAutoScroll(); this.rows.get(id)?.view.reveal();});
        this.ocr = new ChatOcr(this, options);
        this.composer = new Composer(this.composerOptions(options), this.t, draft => {
            this.writer.changed(draft);
            try { this.options.onDraftChange?.(draft); } catch (error) { this.report(error); }
            if (this.snapshot && !this.closed) this.updateAvailability();
        }, () => {const binding = this.options; void this.submit().catch(error => {
            if (this.options === binding || (error as {viewId?: string})?.viewId === this.snapshot?.viewId) this.report(error);
        });});
        this.earlier = button(this.t('earlier'), () => { void this.loadEarlier(); });
        this.cancel = button(this.t('cancel'), () => { void this.cancelExecution().catch(error => this.report(error)); });
        this.promptsButton = presentButton(element('button', 'llm-prompt-nav-trigger', this.t('prompts')), 'prompts', options.presentButton);
        this.promptsButton.type = 'button';
        this.layout();
        this.navigation = this.mountNavigation();
        this.disposers.push(() => this.navigation.destroy());
        presentButton(this.cancel, 'cancel', options.presentButton);
        presentButton(this.search.button, 'search', options.presentButton);
    }
    private composerOptions(options: ChatOptions): ChatOptions {
        return {...options, attachmentActions: item => [...(this.ocr?.actions(item) ?? []), ...(options.attachmentActions?.(item) ?? [])]};
    }
    private mountNavigation(): PromptNavigator {
        return new PromptNavigator({root: this.root, history: this.history, trigger: this.promptsButton,
            locale: this.options.locale, translate: this.options.translate, presentButton: this.options.presentButton,
            earlier: () => {void this.loadEarlier();}, refresh: () => {void this.loadPromptHistory();},
            getRows: () => [...this.rows].map(([id, row]) => ({id, element: row.view.element})),
            reveal: id => {this.scroll.pauseAutoScroll(); this.rows.get(id)?.view.reveal(); return this.rows.get(id)?.view.element ?? null;}});
    }
    private observe(options: ChatOptions): BindingObservation {
        return new BindingObservation(options, () => {if (this.options === options) this.changed();},
            () => {if (this.options === options) this.operationChanged();});
    }
    get inputBusy(): boolean {return this.replacing || this.composer.pending;}
    async replaceBinding(binding: ChatBinding, replacement: {readonly draft?: ComposerDraft} = {}): Promise<void> {
        const change: BindingChange = {operationId: randomUUID(), started: Date.now(), stage: 'flush', committed: false};
        const lifetime = new BindingLifetime(binding);
        try {this.assertReplaceable(change);} catch (error) {await this.abandonBinding(lifetime, change); throw error;}
        this.replacing = true; this.composer.send.disabled = true; this.cancel.disabled = true; this.earlier.disabled = true;
        try {
            const draft = replacement.draft && structuredClone(replacement.draft);
            const {options, snapshot, observation} = await this.prepareBinding(binding, draft, change);
            change.stage = 'commit'; change.committed = true;
            this.commitBinding(options, snapshot, observation, lifetime, draft, change.operationId, change.started);
            this.replacing = false; this.changed();
            diagnoseBinding(this.options.onBindingDiagnostic, change.operationId, change.stage, change.started);
        } catch (error) {
            const failure = this.bindingFailure(error, change);
            if (!change.committed) await this.abandonBinding(lifetime, change);
            throw failure;
        }
        finally {
            this.replacing = false;
            if (!change.committed && !this.closed) {try {this.changed();} catch {this.composer.send.disabled = true;}}
        }
    }
    private async abandonBinding(lifetime: BindingLifetime, change: BindingChange): Promise<void> {
        try {await lifetime.release();}
        catch (error) {
            this.retirementErrors.push(error);
            diagnoseBinding(this.options.onBindingDiagnostic, change.operationId, 'cleanup', change.started, error);
        }
    }
    private assertReplaceable(change: BindingChange): void {
        this.ocr.assertRecoverable();
        if (!this.closed && !this.inputBusy) return;
        const error = Object.assign(new Error(this.closed ? 'Chat view is closed' : 'Chat input is busy'),
            {code: this.closed ? 'VIEW_CLOSED' : 'VIEW_BUSY', bindingCommitted: false});
        diagnoseBinding(this.options.onBindingDiagnostic, change.operationId, change.stage, change.started, error); throw error;
    }
    private async prepareBinding(binding: ChatBinding, draft: ComposerDraft | undefined, change: BindingChange) {
        await this.flushBindingDraft(); diagnoseBinding(this.options.onBindingDiagnostic, change.operationId, change.stage, change.started);
        if (this.closed || this.composer.pending) throw Object.assign(new Error('Chat input changed while preparing its binding'), {code: this.closed ? 'VIEW_CLOSED' : 'VIEW_BUSY'});
        change.stage = 'subscribe'; assertBinding(binding);
        const options = replaceBindingOptions(this.options, binding), observation = this.observe(options); change.prepared = observation;
        const snapshot = options.source.getSnapshot();
        if (snapshot.conversationId !== this.snapshot.conversationId && !draft)
            throw Object.assign(new Error('Another conversation requires an explicit draft'), {code: 'DRAFT_REQUIRED'});
        diagnoseBinding(this.options.onBindingDiagnostic, change.operationId, change.stage, change.started);
        return {options, snapshot, observation};
    }
    private bindingFailure(error: unknown, change: BindingChange): Error {
        if (!change.committed) {
            try {change.prepared?.destroy();} catch (cleanup) {diagnoseBinding(this.options.onBindingDiagnostic, change.operationId, 'cleanup', change.started, cleanup);}
        }
        diagnoseBinding(this.options.onBindingDiagnostic, change.operationId, change.stage, change.started, error);
        return Object.assign(new Error(errorText(error), {cause: error}),
            {code: (error as {code?: string})?.code ?? 'BINDING_CHANGE_FAILED', bindingCommitted: change.committed});
    }
    private async flushBindingDraft(): Promise<void> {
        let captured: ComposerDraft;
        do {captured = this.composer.getDraft(); await this.writer.flush();}
        while (!this.closed && this.composer.getDraft() !== captured);
    }
    private commitBinding(options: ChatOptions, snapshot: ConversationSnapshot, observation: BindingObservation,
        lifetime: BindingLifetime, draft: ComposerDraft | undefined, operationId: string, started: number): void {
        const old = this.observation, header = this.headerSlot, toolbar = this.slot, composer = this.composerSlot, startSlot = this.startSlot, previousLifetime = this.lifetime, disclosure = this.disclosure;
        this.toolGroups.destroy();
        this.disclosure = new DisclosureController(this.history, options.disclosure ?? {initialStates: draft ? {} : disclosure.getStates()});
        this.toolGroups = new ToolOutputGroups(this.history, this.t, this.disclosure);
        composer?.element.remove(); startSlot?.element.remove();
        this.headerSlot = undefined; this.slot = undefined; this.composerSlot = undefined; this.startSlot = undefined;
        this.writer.stop(); this.options = options; this.observation = observation; this.lifetime = lifetime;
        this.activateBinding(previousLifetime, false);
        this.writer = new DraftWriter(options.saveDraft, error => {if (this.options === options) this.report(error);});
        this.binding = {viewId: snapshot.viewId, conversationId: snapshot.conversationId}; this.snapshot = snapshot;
        if (draft) {this.draftViews = new Set([snapshot.viewId]); this.preparing = undefined;} else this.draftViews?.add(snapshot.viewId);
        this.confirming = new Set(); this.inFlight.clear(); this.registering = undefined;
        for (const abort of this.reads) abort.abort(); this.reads.clear(); this.reading = false; this.earlierError = '';
        this.navigation.close(false); this.search.setActive(false);
        const rows = [...this.rows.values()]; for (const row of rows) row.view.element.remove(); this.rows.clear();
        for (const card of this.cards.values()) card.destroy(); this.cards.clear();
        this.retireBinding([() => old?.destroy(), () => header?.destroy(), () => toolbar?.destroy(), () => composer?.destroy(), () => startSlot?.destroy(),
            ...rows.map(row => () => row.view.destroy()), () => disclosure.destroy(), () => previousLifetime.release()], operationId, started);
        this.ocr.destroy(); this.ocr = new ChatOcr(this, options); this.ocr.setActive(this.active);
        this.composer.replaceBinding(this.composerOptions(options), draft); this.writer.changed(this.composer.getDraft()); observation.activate();
        this.acceptedPlugins = this.acceptedOperationIds(); this.composer.initializePlugins();
        this.headerSlot = options.mountHeader?.(this.header, this.headerContext());
        this.slot = options.mountToolbar?.(this.toolbar, {snapshot, view: this});
        this.startSlot = mountChatSlot(this.composer.start, options.mountComposerStart, {snapshot, view: this});
        this.composerSlot = mountChatSlot(this.composer.menu, options.mountComposerMenu, {snapshot, view: this});
        this.arrangeHeader(); this.activateBinding(lifetime, this.active);
        this.search.setActive(this.active); if (draft) this.scroll.forceScrollToBottom();
    }
    private retireBinding(steps: (() => void | Promise<void>)[], operationId: string, started: number): void {
        const task = disposeAll(steps);
        this.retire(task);
        void task.then(() => diagnoseBinding(this.options.onBindingDiagnostic, operationId, 'cleanup', started),
            error => diagnoseBinding(this.options.onBindingDiagnostic, operationId, 'cleanup', started, error));
    }
    private activateBinding(lifetime: BindingLifetime, active: boolean): void {
        try {lifetime.setActive(active);}
        catch (error) {
            this.retirementErrors.push(error);
            diagnoseBinding(this.options.onBindingDiagnostic, randomUUID(), 'commit', Date.now(), error);
        }
    }
    initialize(): void {
        if (this.options.features?.flow && !this.options.flow) throw new Error('Flow options are required to enable the Flow feature');
        void this.flow.setEnabled(this.options.features?.flow ?? false);
        assertBinding(this.options);
        this.scroll = new ScrollController(this.history);
        this.disposers.push(bindChatScrollRouting(this.root, this.history, () => this.active && !this.closed, () => this.scroll.pauseAutoScroll()));
        this.disposers.push(() => this.scroll.destroy());
        this.observation = this.observe(this.options); this.observation.activate();
        this.acceptedPlugins = this.acceptedOperationIds(); this.composer.initializePlugins();
        this.changed();
        this.headerSlot = this.options.mountHeader?.(this.header, this.headerContext());
        this.slot = this.options.mountToolbar?.(this.toolbar, { snapshot: this.snapshot, view: this });
        this.startSlot = mountChatSlot(this.composer.start, this.options.mountComposerStart, {snapshot: this.snapshot, view: this});
        this.composerSlot = mountChatSlot(this.composer.menu, this.options.mountComposerMenu, {snapshot: this.snapshot, view: this});
        this.arrangeHeader(); this.activateBinding(this.lifetime, this.active);
    }
    private headerContext() {
        return {snapshot: this.snapshot, view: this, headerMenu: this.headerMenuBody,
            header: {title: this.heading, status: this.status, extra: this.headerExtra,
                primary: this.headerPrimary, menu: this.headerMenu, menuBody: this.headerMenuBody}};
    }
    private iconButton(action: 'refresh' | 'prompts' | 'print', run: () => void): HTMLButtonElement {
        return presentButton(button(this.t(action), run), action, this.options.presentButton);
    }
    private layout(): void {
        const refresh = this.iconButton('refresh', () => {
            const binding = this.options; void binding.source.refresh?.().catch(error => {if (binding === this.options) this.report(error);});
        }); refresh.hidden = !this.options.source.refresh;
        const collapse = presentButton(button(this.t('toggleAll'), () => {if (this.active) this.setAllCollapsed(this.disclosure.shouldCollapse());}), 'collapse', this.options.presentButton);
        const summary = element('summary'), more = presentButton(button(this.t('more'), () => {this.headerMenu.open = !this.headerMenu.open;}), 'more', this.options.presentButton);
        more.addEventListener('click', event => event.preventDefault()); summary.append(more);
        this.headerMenu.dataset.chatMenu = ''; this.headerMenu.append(summary, this.headerMenuBody);
        this.headerMenuBody.append(this.search.button, collapse, this.flow.button, this.iconButton('print', () => {void this.print().catch(error => this.report(error));}));
        this.header.append(this.heading, this.status, this.headerExtra, this.headerPrimary, this.headerMenu);
        const media = globalThis.matchMedia?.('(max-width: 768px)');
        const arrange = this.arrangeHeader = () => {
            for (const control of this.header.querySelectorAll('[data-chat-overflow]')) (media?.matches ? this.headerMenuBody : this.headerExtra).append(control);
            for (const control of [refresh, this.promptsButton]) (media?.matches ? this.headerMenuBody : this.headerPrimary).append(control);
        };
        arrange(); media?.addEventListener?.('change', arrange); this.disposers.push(() => media?.removeEventListener?.('change', arrange));
        summary.classList.add('ui-nav-button');
        this.defaultTitleBar = mountSharedTitleBar(this.header, {title: this.heading,
            actions: [this.status, this.headerExtra, this.headerPrimary], menu: this.headerMenu, menuBody: this.headerMenuBody});
        this.composer.element.querySelector('.llm-chat__composer-actions')!.append(this.cancel);
        this.history.setAttribute('role', 'log');
        this.root.append(this.header, this.toolbar, this.search.element, this.earlier, this.history, this.flow.pane, this.requests, this.operationStatus, this.composer.element);
        this.container.append(this.root);
    }

    private changed(): void {
        if (this.closed) return;
        const snapshot = this.options.source.getSnapshot();
        if (!this.binding) this.binding = { viewId: snapshot.viewId, conversationId: snapshot.conversationId };
        if (snapshot.viewId !== this.binding.viewId || snapshot.conversationId !== this.binding.conversationId) return;
        if (this.snapshot && snapshot.revision < this.snapshot.revision) return;
        this.snapshot = snapshot;
        this.confirmMessages(); this.operationChanged();
    }
    private confirmMessages(): void {
        const records = this.records();
        const receipts: OperationReceipt[] = [...this.snapshot.operationReceipts ?? []];
        for (const message of this.snapshot.messages) {
            if (message.role !== 'user' || message.acceptance !== 'confirmed' || !message.submissionId) continue;
            if (records.some(item => submissionRecord(item) && item.context.operationId === message.submissionId))
                receipts.push({status: 'accepted', operationId: message.submissionId, observedUserMessageId: message.id});
        }
        for (const receipt of receipts) {
            const record = records.find(item => item.context.operationId === receipt.operationId);
            if (!record || this.confirming.has(receipt.operationId)) continue;
            const enrich = record.status === 'accepted' && receipt.status === 'accepted'
                && !record.observedUserMessageId && !!receipt.observedUserMessageId;
            if (!unresolved(record) && !enrich) continue;
            const id = receipt.operationId, confirming = this.confirming, binding = this.options; confirming.add(id);
            void settleOperation(binding, receipt, record.kind)
                .catch(error => {if (binding === this.options) this.report(error);}).finally(() => confirming.delete(id));
        }
    }
    private records(): readonly OperationRecord[] {
        const scopeId = this.composer.getDraft().scopeId;
        return this.options.operations.getSnapshot().filter(record => record.conversationId === this.snapshot.conversationId
            && (!this.draftViews || this.draftViews.has(record.context.viewId) || !!scopeId && record.draft?.scopeId === scopeId));
    }
    private operationChanged(): void {
        if (this.closed || !this.snapshot) return;
        this.confirmMessages();
        for (const record of this.records()) if ((record.kind === 'send' || record.kind === 'command') && record.status === 'accepted' && record.draft
            && (!this.draftViews || this.draftViews.has(record.context.viewId) || !!record.draft.scopeId && record.draft.scopeId === this.composer.getDraft().scopeId))
        {
            this.composer.accept(record.draft);
            if (!this.acceptedPlugins.has(record.context.operationId)) {
                this.acceptedPlugins.add(record.context.operationId);
                try {this.composer.afterSend(record.draft);} catch (error) {this.report(error);}
            }
        }
        if (this.active && !this.replacing) this.render();
    }
    private acceptedOperationIds(): Set<string> {
        return new Set(this.options.operations.getSnapshot().filter(record => record.status === 'accepted').map(record => record.context.operationId));
    }
    private render(): void {
        this.heading.textContent = this.snapshot.title;
        this.defaultTitleBar?.update({title: this.snapshot.title});
        this.executionStatus.update(this.snapshot, this.active);
        this.renderHistory(); this.renderInteractions(); this.renderOperations(); this.updateAvailability();
        try { this.startSlot?.update?.({snapshot: this.snapshot, view: this}); this.composerSlot?.update?.({snapshot: this.snapshot, view: this}); this.headerSlot?.update?.(this.headerContext()); this.slot?.update?.({ snapshot: this.snapshot, view: this }); } catch (error) { this.options.onError?.(error); }
    }
    private updateAvailability(): void {
        this.composer.update(this.snapshot, !this.replacing && !this.preparing && !this.registering && (this.snapshot.commands !== undefined && isCommandInput(this.composer.getDraft().text) ? this.can('command')
            : this.can('send') && !this.records().some(record => submissionRecord(record) && unresolved(record))));
        this.cancel.hidden = !this.can('cancel') || !this.snapshot.executionRef;
        this.cancel.disabled = this.records().some(record => record.kind === 'cancel'
            && record.input === this.snapshot.executionRef && unresolved(record));
        this.earlier.hidden = !this.snapshot.hasEarlier || !this.options.actions.loadEarlier;
        this.earlier.disabled = this.reading || this.replacing;
        const refresh = this.header.querySelector<HTMLButtonElement>('[data-chat-action="refresh"]');
        if (refresh) refresh.hidden = !this.options.source.refresh;
    }
    private renderHistory(): void {
        const records = this.records().filter(submissionRecord);
        const previews = new Map(this.snapshot.operationMessages?.map(item => [item.operationId, item.message]));
        const messages = this.snapshot.messages.filter(message => !(message.role === 'user' && message.acceptance === 'optimistic'
            && records.some(record => record.context.operationId === message.submissionId)));
        const temporary = this.visibleRecords().filter(submissionRecord).filter(record => !record.observedUserMessageId && !messages.some(message => message.role === 'user'
            && message.acceptance === 'confirmed' && message.submissionId === record.context.operationId)).flatMap(record => {
                if (record.status !== 'accepted' || !previews.has(record.context.operationId)) return [temporaryMessage(record, this.t('arguments'))];
                const message = previews.get(record.context.operationId); return message ? [message] : [];
            });
        this.syncMessages([...messages, ...temporary]);
        this.navigation.update(messages.filter(message => message.role === 'user').map(message => ({id: message.id,
            text: message.parts.flatMap(part => part.kind === 'markdown' ? [part.text] : []).join(' ')})));
        this.updateEarlierNavigation();
    }
    private syncMessages(messages: readonly ChatMessage[]): void {
        const ids = new Set(messages.map(message => message.id));
        for (const [id, row] of this.rows) if (!ids.has(id)) {
            row.view.element.remove(); this.retire(row.view.destroy()); this.rows.delete(id);
        }
        this.toolGroups.sync(messages.map(message => ({id: message.id, element: this.messageRow(message).view.element, groupId: message.toolGroupId, boundary: message.role === 'user',
            tools: message.role === 'tool' || message.parts.length > 0 && message.parts.every(part => part.kind === 'tool')
                ? message.parts.filter((part): part is Extract<typeof part, {kind: 'tool'}> => part.kind === 'tool') : undefined,
            continuation: message.role === 'assistant' && message.parts.length > 0 && message.parts.every(part => part.kind === 'reasoning')})), this.snapshot.conversationId);
        this.follow();
        this.search.refresh();
    }
    private messageRow(message: ChatMessage) {
        let row = this.rows.get(message.id);
        const permissions = this.snapshot.allowed.join(',');
        if (!row) {
            const view = new MessageView(this.options, this.t, {
                edit: (target, text) => this.edit(target, text), retry: target => this.retry(target),
            }, () => { this.follow(); this.search.refresh(); }, this.disclosure);
            row = { view, message, permissions }; this.rows.set(message.id, row); view.update(message, this.snapshot);
        } else if (message.revision !== row.message.revision || permissions !== row.permissions) {
            row.message = message; row.permissions = permissions; row.view.update(message, this.snapshot);
        } else if (this.options.messageActions) {
            row.view.renderActions(message, this.snapshot);
        }
        return row;
    }
    private renderInteractions(): void {
        const keys = new Set<string>();
        for (const request of this.snapshot.interactions) {
            const key = `${request.id}:${request.revision}:${request.state}`; keys.add(key);
            let card = this.cards.get(key);
            if (!card) {
                const binding = this.options;
                card = new InteractionCard(request, this.t, response => {
                    if (this.options !== binding) return Promise.reject(new Error('Interaction binding expired'));
                    return this.perform('respond', { id: request.id, revision: request.revision, response } as unknown as JsonValue,
                        context => binding.actions.respond!({ id: request.id, revision: request.revision, response }, context));
                });
                this.cards.set(key, card);
            }
            const operation = this.records().find(record => record.kind === 'respond'
                && typeof record.input === 'object' && record.input !== null && 'id' in record.input
                && record.input.id === request.id && record.input.revision === request.revision && record.status !== 'rejected');
            card.setPending(!this.can('respond') || !!request.responding || !!operation, operation ? this.t(operation.status === 'submitting' ? 'pending' : operation.status) : undefined);
            this.requests.append(card.element);
        }
        for (const [key, card] of this.cards) if (!keys.has(key)) { card.destroy(); this.cards.delete(key); }
    }
    private can(kind: ActionName): boolean { return !!this.options.actions[kind] && this.snapshot.allowed.includes(kind); }
    private visibleRecords(): readonly OperationRecord[] {
        const records = this.records();
        let accepted = -1;
        records.forEach((record, index) => {if (submissionRecord(record) && record.status === 'accepted') accepted = index;});
        return records.filter((record, index) => index >= accepted || record.status !== 'rejected' || !submissionRecord(record));
    }
    private renderOperations(): void {
        this.operationStatus.replaceChildren();
        for (const record of this.visibleRecords()) {
            if (record.status === 'accepted') continue;
            const row = element('p', undefined, `${this.t(record.status === 'submitting' ? 'pending' : record.status)} ${record.message ?? ''}`);
            row.dataset.operationId = record.context.operationId;
            if (unresolved(record) && this.options.actions.reconcile) row.append(button(this.t('reconcile'), () => {
                void this.reconcile(record.context.operationId).catch(error => this.report(error));
            }));
            this.operationStatus.append(row);
        }
    }
    async submit(options?: {asMessage?: boolean}): Promise<void> {
        if (this.closed || !this.active || this.replacing || this.preparing || this.registering || this.composer.uploading) return;
        if (this.composer.commandDraft && !options?.asMessage && this.composer.getCommand()?.command.dispatch !== 'send') {if (this.can('command') && this.composer.beforeSend()) await this.submitCommand(); return;}
        if (!this.can('send')) return;
        if (this.records().some(record => submissionRecord(record) && unresolved(record))) return;
        if (!this.composer.beforeSend() || !this.composer.validInput) return;
        const draft = this.composer.getDraft();
        const input = this.composer.getSubmission();
        if (this.options.actions.prepareSend) {await this.prepareAndSend(input, draft, options?.asMessage); return;}
        const actions = this.options.actions;
        await this.perform('send', input as unknown as JsonValue, context => actions.send!(input, context), draft);
    }
    private async prepareAndSend(input: ChatSubmission, draft: ComposerDraft, asMessage = false): Promise<void> {
        const token = Symbol('send preparation'); this.preparing = token; this.updateAvailability();
        const conversationId = this.snapshot.conversationId, viewId = this.snapshot.viewId;
        let prepared: SendPreparation | null = null;
        try {
            prepared = await this.prepareSubmission(input, draft, token);
            if (!prepared) return;
            this.preparing = undefined;
            if (this.records().some(record => submissionRecord(record) && unresolved(record))) return;
            if (!asMessage && this.snapshot.commands !== undefined && isCommandInput(input.text) && this.composer.getCommand(input.text)?.command.dispatch !== 'send') {
                await this.submitCommand(draft, prepared, input.selection); return;
            }
            const actions = this.options.actions;
            await this.perform('send', input as unknown as JsonValue, context => actions.send!(input, context), draft, prepared);
        } catch (error) {
            const current = this.snapshot.conversationId === conversationId && this.composer.getDraft().scopeId === draft.scopeId;
            throw Object.assign(new Error(errorText(error), {cause: error}), {code: (error as {code?: string})?.code,
                viewId: prepared?.viewId ?? (current ? this.snapshot.viewId : viewId)});
        } finally {if (this.preparing === token) this.preparing = undefined; if (!this.closed) this.updateAvailability();}
    }
    private async prepareSubmission(input: ChatSubmission, draft: ComposerDraft, token: symbol): Promise<SendPreparation | null> {
        const options = this.options, conversationId = this.snapshot.conversationId, operationId = randomUUID(), started = Date.now();
        try {
            const prepared = await options.actions.prepareSend!(input, draft);
            if (this.closed || this.preparing !== token || this.snapshot.conversationId !== conversationId || this.composer.getDraft().scopeId !== draft.scopeId
                || prepared && (prepared.viewId !== this.snapshot.viewId || !prepared.operationId))
                throw Object.assign(new Error('Submission preparation binding expired'), {code: 'STALE_VIEW'});
            diagnoseOperation(options.onDiagnostic, {operationId: prepared?.operationId ?? operationId, kind: 'send', stage: 'prepare', result: 'success'}, started);
            return prepared;
        } catch (error) {
            diagnoseOperation(options.onDiagnostic, {operationId, kind: 'send', stage: 'prepare', result: 'failed'}, started, (error as {code?: unknown})?.code ?? 'SEND_PREPARATION_FAILED');
            throw error;
        }
    }
    private async submitCommand(draft = this.composer.getDraft(), prepared?: SendPreparation, selection = this.composer.getSelection()): Promise<void> {
        if (!this.can('command')) return;
        const resolved = this.composer.getCommand(draft.text);
        if (!resolved) throw new Error(this.t('commandUnavailable'));
        if (resolved.command.kind === 'prompt' && this.records().some(record => submissionRecord(record) && unresolved(record)))
            throw new Error('Operation is awaiting reconciliation');
        if (draft.attachments.length) throw new Error('Command attachments require host support');
        const input: CommandSubmission = {target: {id: resolved.command.id, expectedRevision: resolved.command.revision},
            ...(resolved.command.execution ? {execution: resolved.command.execution} : {}),
            text: draft.text, arguments: resolved.arguments, kind: resolved.command.kind, selection};
        const actions = this.options.actions;
        await this.perform('command', input as unknown as JsonValue, context => actions.command!(input, context), {...draft, input: undefined, context: undefined}, prepared);
    }
    private async perform(kind: ActionName, input: JsonValue, action: (context: OperationContext) => Promise<OperationReceipt>,
        draft?: import('./contracts').ComposerDraft, prepared?: SendPreparation): Promise<void> {
        if (this.closed || !this.active || this.replacing || !this.can(kind)) throw new Error('Operation is unavailable');
        const key = operationKey(kind, input);
        if (this.pendingTransport(key)) return;
        if (this.records().some(record => operationKey(record.kind, record.input) === key
            && (unresolved(record) && !(queryOperation(kind, input) && record.status === 'unknown') || kind === 'respond' && record.status === 'accepted')))
            throw new Error('Operation is awaiting reconciliation or an updated request');
        if (prepared && prepared.viewId !== this.snapshot.viewId) throw Object.assign(new Error('Prepared view changed before dispatch'), {code: 'STALE_VIEW'});
        const context = prepared ?? {viewId: this.snapshot.viewId, operationId: randomUUID()};
        this.inFlight.set(key, context.operationId);
        try { await this.dispatch(context, kind, input, action, draft); }
        finally { if (this.inFlight.get(key) === context.operationId) this.inFlight.delete(key); }
    }
    private pendingTransport(key: string): boolean {
        const running = this.inFlight.get(key);
        if (!running) return false;
        const prior = this.records().find(record => record.context.operationId === running);
        return !prior || !(submissionRecord(prior) || queryOperation(prior.kind, prior.input)) || prior.status !== 'accepted';
    }
    private async register(record: OperationRecord, options: ChatOptions): Promise<boolean> {
        if (record.kind === 'send' || record.kind === 'command') this.registering = record.context.operationId;
        if (!this.closed) this.updateAvailability();
        try {return await registerOperation(options, record);}
        finally {
            if (this.registering === record.context.operationId) this.registering = undefined;
            if (!this.closed) this.updateAvailability();
        }
    }
    private async dispatch(context: OperationContext, kind: ActionName, input: JsonValue, action: (context: OperationContext) => Promise<OperationReceipt>,
        draft?: import('./contracts').ComposerDraft): Promise<void> {
        const options = this.options;
        if (!await this.register({ context, conversationId: this.snapshot.conversationId, kind, input, draft, status: 'submitting' }, options)) return;
        if (this.closed || this.options !== options) {
            await settleOperation(options, {status: 'rejected', operationId: context.operationId, code: 'STALE_VIEW', message: 'View changed before dispatch'}, kind);
            throw Object.assign(new Error('View changed before dispatch'), {code: 'STALE_VIEW'});
        }
        const started = Date.now();
        let receipt: OperationReceipt, code: string | undefined;
        try { receipt = await action(context); }
        catch (error) { code = 'OPERATION_TRANSPORT_ERROR'; receipt = { status: 'unknown', operationId: context.operationId, message: errorText(error) }; }
        if (receipt.operationId !== context.operationId) {
            code = 'RECEIPT_IDENTITY_MISMATCH'; receipt = { status: 'unknown', operationId: context.operationId, message: 'Mismatched receipt identity' };
        }
        await settleOperation(options, receipt, kind);
        diagnoseOperation(options.onDiagnostic, {operationId: context.operationId, kind, stage: 'dispatch', result: receipt.status}, started,
            receipt.status === 'rejected' ? receipt.code : code ?? (receipt.status === 'unknown' ? 'OUTCOME_UNCONFIRMED' : undefined));
        const settled = options.operations.getSnapshot().find(record => record.context.operationId === context.operationId)!;
        if (settled.status !== 'accepted') throw new Error(settled.message ?? this.t('unknown'));
    }
    async reconcile(operationId: string): Promise<void> {
        const options = this.options;
        const record = this.records().find(item => item.context.operationId === operationId);
        if (!record || !options.actions.reconcile || !unresolved(record)) return;
        const started = Date.now();
        const receipt = await options.actions.reconcile!(operationId);
        if (receipt.operationId !== operationId) throw new Error('Mismatched reconciliation identity');
        await settleOperation(options, receipt, record.kind);
        diagnoseOperation(options.onDiagnostic, {operationId, kind: record.kind, stage: 'reconcile', result: receipt.status}, started,
            receipt.status === 'rejected' ? receipt.code : undefined);
    }
    private async cancelExecution(): Promise<void> {
        const target = this.snapshot.executionRef;
        if (!target || this.cancel.disabled) return;
        const actions = this.options.actions;
        await this.perform('cancel', target, context => actions.cancel!(target, context));
    }
    private edit(target: MessageTarget, text: string): Promise<void> {
        const actions = this.options.actions;
        return this.perform('edit', { ...target, text }, context => actions.edit!(target, text, context));
    }
    private retry(target: MessageTarget): Promise<void> {
        const actions = this.options.actions;
        return this.perform('retry', { ...target }, context => actions.retry!(target, context));
    }
    private async loadEarlier(): Promise<void> {
        if (this.reading || this.closed || this.replacing || !this.options.actions.loadEarlier) return;
        const binding = this.options;
        const abort = new AbortController(); this.reads.add(abort); this.reading = true; this.earlierError = '';
        this.updateAvailability(); this.updateEarlierNavigation();
        const height = this.history.scrollHeight, top = this.history.scrollTop; this.scroll.pauseAutoScroll();
        try { await binding.actions.loadEarlier!({ signal: abort.signal }); }
        catch (error) { if (!abort.signal.aborted && !this.closed && this.options === binding) {this.earlierError = errorText(error); this.report(error);} }
        finally {
            const owned = this.reads.delete(abort);
            if (owned && !this.closed && this.options === binding) {
                this.reading = false;
                this.history.scrollTop = top + this.history.scrollHeight - height;
                this.updateAvailability(); this.updateEarlierNavigation();
            }
        }
    }
    private async loadPromptHistory(): Promise<void> {
        const binding = this.options, limit = Math.min(10, Math.max(0, Math.floor(binding.promptHistoryPages ?? 0)));
        for (let page = 0; page < limit; page++) {
            if (this.closed || !this.active || this.options !== binding || this.reading || !this.snapshot.hasEarlier
                || this.snapshot.messages.some(message => message.role === 'user')) return;
            await this.loadEarlier(); if (this.earlierError) return;
        }
    }
    private updateEarlierNavigation(): void {this.navigation.setEarlier(this.snapshot.hasEarlier && !!this.options.actions.loadEarlier, this.reading, this.earlierError);}
    private follow(): void { if (!this.closed && this.active) this.scroll.handleContentResize(); }
    private report(error: unknown): void {
        if (!this.closed) this.composer.feedback.textContent = errorText(error);
        this.options.onError?.(error);
    }
    private retire(task: Promise<void>): void {
        this.retiring.add(task);
        void task.then(() => this.retiring.delete(task), error => {this.retiring.delete(task); this.retirementErrors.push(error);});
    }
    private async finishRetirement(): Promise<void> {
        await Promise.allSettled([...this.retiring]);
        if (this.retirementErrors.length) throw new AggregateError(this.retirementErrors, 'Retired view cleanup failed');
    }
    async print(): Promise<void> {
        const service = new DefaultPrintService();
        try { await service.printFromHtml(this.history.innerHTML, { title: this.snapshot.title, locale: this.options.locale }); }
        finally { service.destroy(); }
    }
    setActive(active: boolean): void {
        if (this.closed) return;
        if (this.snapshot) this.executionStatus.update(this.snapshot, active);
        this.ocr.setActive(active); this.active = active; if (!active) {for (const read of this.reads) read.abort(); this.reads.clear(); this.reading = false;} this.composer.setActive(active); this.flow.setActive(active); this.search.setActive(active); if (active) this.changed();
        this.scroll.setActive(active); if (!active) this.navigation.close(false);
        this.activateBinding(this.lifetime, active);
    }
    setFlowEnabled(enabled: boolean): Promise<void> { return this.flow.setEnabled(enabled); }
    retryMessage(target: MessageTarget): Promise<void> {return this.retry(target);}
    revealMessage(id: string): boolean {
        const row = this.rows.get(id); if (!row || this.closed) return false;
        this.scroll.pauseAutoScroll(); row.view.reveal();
        row.view.element.scrollIntoView?.({block: 'nearest'}); row.view.element.tabIndex = -1; row.view.element.focus({preventScroll: true}); return true;
    }
    scrollHistory(position: 'start' | 'end'): void {
        if (this.closed) return;
        if (position === 'end') this.scroll.forceScrollToBottom(); else {this.scroll.pauseAutoScroll(); this.history.scrollTop = 0;}
    }
    openPrompts(): void {if (!this.closed && this.active) this.promptsButton.click();}
    setAllCollapsed(collapsed: boolean): void {if (!this.closed) this.disclosure.setAllCollapsed(collapsed);}
    captureRecovery(): import('./contracts').ChatRecoverySnapshot {
        this.ocr.assertRecoverable();
        if (this.closed || this.replacing || this.preparing || this.registering || this.composer.pending)
            throw Object.assign(new Error('Finish the pending input operation before recovery'), {code: 'RECOVERY_BUSY'});
        const textarea = this.composer.textarea;
        this.composer.setText(textarea.value);
        return {version: 1, conversationId: this.snapshot.conversationId, draft: structuredClone(this.composer.getDraft()),
            selectionStart: textarea.selectionStart, selectionEnd: textarea.selectionEnd,
            selectionDirection: textarea.selectionDirection, focused: document.activeElement === textarea};
    }
    restoreRecovery(recovery: import('./contracts').ChatRecoverySnapshot): void {
        if (recovery.version !== 1 || recovery.conversationId !== this.snapshot.conversationId)
            throw Object.assign(new Error('Recovery belongs to another conversation'), {code: 'RECOVERY_IDENTITY_MISMATCH'});
        this.captureRecovery();
        this.composer.replaceBinding(this.composerOptions(this.options), recovery.draft); this.composer.initializePlugins();
        this.writer.changed(this.composer.getDraft()); this.changed();
        this.composer.textarea.setSelectionRange(recovery.selectionStart, recovery.selectionEnd, recovery.selectionDirection);
        if (recovery.focused) this.focus();
    }
    disclosureState(): {affectedCount: number; allCollapsed: boolean} {
        return {affectedCount: this.disclosure.entries().length, allCollapsed: !this.disclosure.shouldCollapse()};
    }
    collapseCurrent(): void {
        if (this.closed) return;
        const location = this.disclosure.findUnfoldedByViewport('current');
        if (location?.kind !== 'item') return;
        const entry = this.disclosure.entries().find(item => item.id === location.id);
        if (entry) this.disclosure.toggle(entry, true);
    }
    focus(): void { if (!this.closed && this.active) this.composer.textarea.focus(); }
    getDraft() { return this.composer.getDraft(); }
    setText(text: string): void { this.composer.setText(text); }
    removeAttachment(target: Parameters<ChatView['removeAttachment']>[0]): boolean {return this.composer.removeAttachment(target);}
    inputContext() {return this.composer.inputContext();}
    configureInput(input: Parameters<ChatView['configureInput']>[0], expectedRevision: number): void {
        this.composer.configureInput(input, expectedRevision);
    }
    setArguments(json: string): void {this.composer.setArguments(json);}
    setContext(value: JsonValue): void {this.composer.setContext(value);}
    addFiles(files: readonly File[]): Promise<void> { return this.composer.addFiles(files); }
    flushDraft(): Promise<void> { return this.writer.flush(); }
    destroy(): Promise<void> {
        if (this.disposed) return this.disposed;
        this.closed = true;
        this.executionStatus.destroy();
        return this.disposed = Promise.resolve().then(() => this.disposeView());
    }
    private disposeView(): Promise<void> {
        this.writer.stop();
        this.activateBinding(this.lifetime, false);
        for (const abort of this.reads) abort.abort();
        const steps = [() => this.toolGroups.destroy(), () => this.ocr.destroy(), () => this.composer.destroy(), () => this.observation?.destroy(), ...this.disposers, () => this.writer.flush(), () => this.finishRetirement(), () => this.slot?.destroy(), () => this.headerSlot?.destroy(), () => this.defaultTitleBar?.destroy(), () => this.composerSlot?.destroy(), () => this.startSlot?.destroy(), () => this.flow.destroy(),
            () => this.search.destroy(),
            ...[...this.rows.values()].map(row => () => row.view.destroy()),
            ...[...this.cards.values()].map(card => () => card.destroy()), () => this.disclosure.destroy(), () => this.lifetime.release(), () => this.root.remove()];
        return disposeAll(steps);
    }
}
function unresolved(record: OperationRecord): boolean { return record.status === 'submitting' || record.status === 'unknown'; }
function operationKey(kind: OperationRecord['kind'], input: JsonValue): string {
    if (kind === 'command' && input && typeof input === 'object' && 'target' in input) {
        const target = input.target;
        if (target && typeof target === 'object' && 'id' in target && typeof target.id === 'string') return `${queryOperation(kind, input) ? 'query' : 'command'}:${target.id}`;
    }
    if (typeof input === 'object' && input !== null && !Array.isArray(input)) {
        if ((kind === 'edit' || kind === 'retry') && 'messageId' in input) return `message:${input.messageId}`;
        if (kind === 'respond' && 'id' in input && 'revision' in input) return `respond:${input.id}:${input.revision}`;
    }
    return `${kind}:${JSON.stringify(input)}`;
}
function temporaryMessage(record: OperationRecord, label: string): ChatMessage {
    const input = getOperationCallInput(record);
    return { id: `operation:${record.context.operationId}`, revision: ['submitting', 'accepted', 'unknown', 'rejected'].indexOf(record.status),
        role: 'user', state: record.status === 'rejected' ? 'failed' : 'pending',
        parts: [{ id: 'text', kind: 'markdown', text: record.draft?.text ?? '' },
            ...(input ? [{id: 'arguments', kind: 'json' as const, label, value: input.values}] : []),
            { id: 'status', kind: 'tool', name: record.status, summary: record.message ?? '', state: record.status === 'rejected' ? 'failed' : 'running' },
            ...(record.draft?.attachments ?? []).map(item => ({ id: item.id, kind: 'attachment' as const, file: item.file }))],
    };
}

function submissionRecord(record: OperationRecord): boolean {
    return record.kind === 'send' || record.kind === 'command' && !!record.input && typeof record.input === 'object'
        && !Array.isArray(record.input) && (record.input as Record<string, JsonValue>).kind === 'prompt';
}
function queryOperation(kind: OperationRecord['kind'], input: JsonValue): boolean {
    return kind === 'command' && !!input && typeof input === 'object' && !Array.isArray(input)
        && 'execution' in input && input.execution === 'query' && 'kind' in input && input.kind === 'action';
}

type MountedSlot = MountedToolbar & {element: HTMLElement};
function mountChatSlot(container: HTMLElement, mount: ChatOptions['mountComposerMenu'],
    context: import('./contracts').ToolbarContext): MountedSlot | undefined {
    if (!mount) return;
    const root = element('div', 'llm-chat__slot'); container.append(root);
    try {
        const slot = mount(root, context);
        return {element: root, update: next => slot.update?.(next), destroy: () => disposeAll([() => root.remove(), () => slot.destroy()])};
    } catch (error) {root.remove(); throw error;}
}
