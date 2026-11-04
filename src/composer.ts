import {ComposerAttachments} from './composer-attachments';
import {ComposerIndicators} from './composer-indicators';
import {PopupPanel} from './popup-panel';
import {observePopupDismiss} from './popup-dismiss';
import {SelectPicker} from './select-picker';
import {selectorControl} from './selector-control';
import {isCommandInput} from './commands';
import {CommandPicker} from './command-picker';
import {InputPluginRegistry, type InputPluginContext} from './input-plugins';
import {ComposerSelectors} from './selectors';
import {ComposerArguments} from './composer-arguments';
import {ComposerTargets} from './composer-targets';
import {resizeMessageInput, shouldSubmitMessage} from './input-behavior';
import { randomUUID } from './random';
import type { ChatOptions, JsonValue, ChatSubmission, ComposerDraft, ConversationSnapshot, DraftAttachment } from './contracts';
import { button, presentButton, element, errorText } from './dom';
import type { Translate } from './i18n';

interface Upload { readonly file: File; readonly abort: AbortController; error?: string }
export class Composer {
    private readonly plugins = new InputPluginRegistry<InputPluginContext, ComposerDraft>();
    readonly element = element('form', 'llm-chat__composer');
    readonly textarea = element('textarea', 'llm-chat__input');
    readonly feedback = element('p', 'llm-chat__error');
    readonly send: HTMLButtonElement;
    private attach!: HTMLButtonElement;
    private readonly filePicker = element('input');
    private pickerBinding?: ChatOptions;
    private attachmentPopup?: PopupPanel;
    private readonly indicators: ComposerIndicators;
    private readonly actions = element('div', 'llm-chat__composer-actions');
    private readonly attachments = element('div', 'llm-chat__attachments');
    private readonly attachmentList: ComposerAttachments;
    private readonly selectors = element('div', 'llm-chat__selectors');
    readonly start = element('div', 'llm-chat__composer-start');
    private readonly trailing = element('div', 'llm-chat__selectors llm-chat__selectors--end');
    private pickers: SelectPicker[] = [];
    readonly menu = element('div', 'llm-chat__composer-menu');
    private readonly more = element('details', 'llm-chat__input-menu');
    private readonly advanced = element('div', 'llm-chat__selectors');
    private readonly candidates = element('div', 'llm-chat__candidates');
    private readonly validation = element('p', 'llm-chat__validation');
    private readonly resizeInput = () => {if (this.active && !this.closed) resizeMessageInput(this.textarea);};
    private observingResize = false;
    private stopMenuDismiss?: () => void;
    private readonly uploads = new Map<string, Upload>();
    private selection: ComposerSelectors;
    private readonly commands: CommandPicker;
    private readonly arguments: ComposerArguments;
    private readonly targets: ComposerTargets;
    private snapshot?: ConversationSnapshot;
    private selectorSignature?: string;
    private draft: ComposerDraft;
    private search?: AbortController;
    private imageEdit?: AbortController;
    private imageRefresh?: AbortController;
    private imageSignature?: string;
    private imageFailure = false;
    private releaseImages?: () => void;
    private closed = false;
    private active = true;
    constructor(private options: ChatOptions, private readonly t: Translate,
        private readonly changed: (draft: ComposerDraft) => void, private readonly submit: () => void) {
        this.indicators = new ComposerIndicators(t);
        this.attachmentList = new ComposerAttachments(this.attachments, t, options.presentButton);
        this.selection = new ComposerSelectors(options.initialDraft?.selection);
        this.draft = options.initialDraft ?? { revision: 0, textRevision: 0, text: '', attachments: [] };
        this.textarea.rows = 1; this.textarea.value = this.draft.text; this.textarea.setAttribute('aria-label', t('input'));
        this.commands = new CommandPicker(this.textarea, text => this.setText(text), t);
        this.arguments = new ComposerArguments(t, input => this.publish({...this.draft, input}));
        this.targets = new ComposerTargets(t, target => this.publish({...this.draft, target}), options);
        this.send = element('button', undefined, t('send')); this.send.type = 'submit';
        presentButton(this.send, 'send', options.presentButton);
        const summary = element('summary', undefined, t('more')), body = element('div', 'llm-chat__input-menu-body');
        summary.setAttribute('aria-label', t('more'));
        const moreButton = presentButton(button(t('more'), () => {this.more.open = !this.more.open;}), 'more', options.presentButton);
        moreButton.addEventListener('click', event => event.preventDefault()); summary.replaceChildren(moreButton);
        body.append(this.advanced, this.menu); this.more.append(summary, body);
        const choices = element('div', 'llm-chat__composer-choices');
        choices.append(this.start, this.selectors, this.targets.element, this.trailing, this.more);
        this.actions.append(this.indicators.element, choices, this.send);
        this.more.hidden = !options.mountComposerMenu; this.textarea.placeholder = t('inputPlaceholder');
        this.element.append(this.attachmentList.element, this.textarea, this.arguments.element, this.candidates, this.actions, this.validation, this.feedback);
        this.bind(); this.renderAttachments();
        this.stopMenuDismiss = observePopupDismiss([this.more], () => {this.more.open = false;});
        this.resizeInput();
        this.releaseImages = options.imageEditing?.subscribe?.(() => {this.imageSignature = undefined; this.refreshImages();});
    }
    initializePlugins(): void {
        this.plugins.replace(this.options.plugins ?? []); this.plugins.setContext(this.inputContext());
    }
    inputContext(): InputPluginContext {
        return {textarea: this.textarea, container: this.element, getText: () => this.draft.text,
            getDraftRevision: () => this.draft.revision, setText: text => this.setText(text),
            replaceRange: (start, end, text) => {this.setText(this.draft.text.slice(0, start) + text + this.draft.text.slice(end)); this.textarea.setSelectionRange(start + text.length, start + text.length);},
            insertAtCursor: text => {const start = this.textarea.selectionStart; this.setText(this.draft.text.slice(0, start) + text + this.draft.text.slice(this.textarea.selectionEnd)); this.textarea.setSelectionRange(start + text.length, start + text.length);},
            getCursorPosition: () => this.textarea.selectionStart, setCursorPosition: position => this.textarea.setSelectionRange(position, position),
            triggerSend: this.submit, focus: () => this.textarea.focus()};
    }
    beforeSend(): boolean {return this.plugins.beforeSend(this.draft.text);}
    afterSend(draft: ComposerDraft): void {this.plugins.afterSend(draft.text, draft);}
    private bind(): void {
        this.element.addEventListener('submit', event => {if (event.target !== this.element) return; event.preventDefault(); this.submit(); });
        this.textarea.addEventListener('focus', () => {this.element.dataset.editorComposing = 'true'; this.plugins.focus();});
        this.textarea.addEventListener('blur', () => {delete this.element.dataset.editorComposing; this.plugins.blur();});
        this.textarea.addEventListener('input', () => { this.setText(this.textarea.value); this.commands.refresh(); this.plugins.input(this.draft.text, this.textarea.selectionStart); void this.findResources(); });
        this.textarea.addEventListener('keydown', event => {
            if (event.isComposing || event.keyCode === 229) return;
            if (this.plugins.key(event)) return;
            if (this.commands.key(event)) return;
            if (!shouldSubmitMessage(event)) return;
            event.preventDefault(); this.submit();
        });
        this.bindAttachments();
    }
    private bindAttachments(): void {
        const picker = this.filePicker; picker.type = 'file'; picker.multiple = true; picker.hidden = true;
        picker.addEventListener('change', () => {if (this.options === this.pickerBinding && this.active && !this.closed) void this.addFiles(Array.from(picker.files ?? [])); picker.value = '';});
        this.attach = presentButton(button(this.t('attach'), () => this.openAttachmentMenu()), 'attach', this.options.presentButton);
        this.attach.hidden = !this.options.upload; this.actions.prepend(this.attach); this.element.append(picker);
        this.textarea.addEventListener('paste', event => {
            const files = Array.from(event.clipboardData?.files ?? []);
            if (this.options.upload && files.length) { event.preventDefault(); void this.addFiles(files); }
        });
        this.element.addEventListener('dragover', event => {if (this.options.upload) event.preventDefault();});
        this.element.addEventListener('drop', event => {if (this.options.upload) {event.preventDefault(); void this.addFiles(Array.from(event.dataTransfer?.files ?? []));}});
    }
    private pickFiles(options: {accept?: string; capture?: 'user' | 'environment'} = {}): void {
        if (!this.options.upload || !this.active || this.closed) return;
        this.pickerBinding = this.options; this.filePicker.accept = options.accept ?? ''; this.filePicker.multiple = !options.capture;
        if (options.capture) this.filePicker.setAttribute('capture', options.capture); else this.filePicker.removeAttribute('capture');
        this.filePicker.click();
    }
    private openAttachmentMenu(): void {
        if (!this.options.upload || !this.active || this.closed) return;
        if (!this.options.attachmentMenu) {this.pickFiles(); return;}
        if (this.attachmentPopup?.isVisible) {this.attachmentPopup.hide(); return;}
        const binding = this.options, items = binding.attachmentMenu!({input: this.inputContext(), pickFiles: options => this.pickFiles(options)});
        this.attachmentPopup ??= new PopupPanel(this.attach, {locale: binding.locale, translate: binding.translate, minWidth: 220, animated: true});
        this.attachmentPopup.show([...items], {onSelect: item => {
            if (this.options !== binding || !this.active || this.closed) return;
            const action = items.find(action => action.id === item.id);
            if (action) void Promise.resolve().then(() => {
                if (this.options === binding && this.active && !this.closed) return action.run();
            }).catch(error => {if (this.options === binding && !this.closed) {this.feedback.textContent = errorText(error); this.options.onError?.(error);}});
        }});
    }
    getDraft(): ComposerDraft { return this.draft; }
    get pending(): boolean {return !!this.imageEdit || !!this.imageRefresh || this.uploads.size > 0;}
    replaceBinding(options: ChatOptions, draft?: ComposerDraft): void {
        this.indicators.reset();
        this.plugins.destroy(); this.attachmentPopup?.destroy(); this.attachmentPopup = undefined; this.pickerBinding = undefined;
        this.search?.abort(); this.candidates.replaceChildren(); this.commands.reset();
        this.imageEdit?.abort(); this.imageRefresh?.abort(); this.releaseImages?.();
        this.imageEdit = undefined; this.imageRefresh = undefined; this.imageSignature = undefined; this.imageFailure = false;
        this.pickers.forEach(picker => picker.destroy()); this.pickers = []; this.targets.hide();
        this.options = options; this.snapshot = undefined; this.more.open = false; this.selectorSignature = undefined;
        this.attach.hidden = !options.upload;
        if (draft) {
            this.draft = structuredClone(draft); this.selection = new ComposerSelectors(draft.selection);
            this.selectorSignature = undefined; this.selectors.replaceChildren(); this.advanced.replaceChildren();
            if (this.textarea.value !== draft.text) this.textarea.value = draft.text;
        }
        this.releaseImages = options.imageEditing?.subscribe?.(() => {this.imageSignature = undefined; this.refreshImages();});
        this.feedback.textContent = ''; this.validation.textContent = ''; this.resizeInput(); this.renderAttachments();
    }
    getSelection(): Readonly<Record<string, string>> { return this.selection.snapshot(); }
    setArguments(json: string): void {this.arguments.set(json);}
    setContext(value: JsonValue): void {
        if (this.closed) return;
        this.publish({...this.draft, context: {revision: (this.draft.context?.revision ?? 0) + 1, value: structuredClone(value)}});
    }
    getSubmission(): ChatSubmission {
        const input = this.arguments.resolve();
        return {text: this.draft.text, attachments: this.draft.attachments.map(item => item.file), selection: this.getSelection(),
            ...(this.targets.target ? {target: this.targets.target} : {}),
            ...(input ? {input} : {}), ...(this.draft.context?.value != null ? {context: structuredClone(this.draft.context.value)} : {})};
    }
    get validInput(): boolean {
        this.validation.textContent = '';
        if (this.commandDraft) return !!this.draft.text.trim();
        const issue = this.targets.issue();
        if (issue) {this.validation.textContent = issue; return false;}
        if (this.arguments.issue()) return false;
        if (!(this.targets.enabled ? this.targets.contract : this.snapshot?.inputContract) && !this.draft.text.trim() && !this.draft.attachments.length) return false;
        try {
            const issue = this.options.validateInput?.(this.getSubmission())[0];
            this.validation.textContent = issue ?? ''; return !issue;
        } catch (error) {this.validation.textContent = errorText(error); return false;}
    }
    getCommand(text = this.draft.text) {return this.commands.resolve(text);}
    get commandDraft(): boolean {return this.snapshot?.commands !== undefined && isCommandInput(this.draft.text);}
    setActive(active: boolean): void {this.active = active; if (!active) {this.attachmentPopup?.hide(); this.more.open = false; this.targets.hide(); this.pickers.forEach(picker => picker.hide());} this.plugins.setActive(active); this.commands.setActive(active); if (!active) {
        this.search?.abort(); this.imageEdit?.abort(); this.imageRefresh?.abort(); this.imageSignature = undefined; this.candidates.replaceChildren();
    } else {this.resizeInput(); this.refreshImages();}}
    get uploading(): boolean { return !!this.imageEdit || !!this.imageRefresh || this.imageFailure || this.uploads.size > 0; }
    setText(text: string): void {
        if (this.closed || text === this.draft.text) return;
        this.textarea.value = text; this.commands.refresh();
        this.publish({ ...this.draft, text, textRevision: this.draft.textRevision + 1 });
    }
    configureInput(input: {selection?: Readonly<Record<string, string>>; target?: ComposerDraft['target']}, expectedRevision: number): void {
        if (this.closed || this.draft.revision !== expectedRevision)
            throw Object.assign(new Error('Input choices changed before the host update'), {code: 'DRAFT_REVISION_CONFLICT'});
        const next = {...this.draft, ...structuredClone(input)};
        this.selection = new ComposerSelectors(next.selection); this.selectorSignature = undefined;
        this.publish(next);
    }
    accept(submitted: ComposerDraft): void {
        if (this.draft.scopeId !== submitted.scopeId) return;
        const clear = this.draft.textRevision === submitted.textRevision && this.draft.text === submitted.text;
        const attachments = this.draft.attachments.filter(item => !submitted.attachments.some(old => old.id === item.id
            && old.file.id === item.file.id && (old.revision ?? 0) === (item.revision ?? 0)));
        const clearInput = !!submitted.input && JSON.stringify(this.draft.input) === JSON.stringify(submitted.input);
        const clearContext = !!submitted.context && submitted.context.value !== null && JSON.stringify(this.draft.context) === JSON.stringify(submitted.context);
        if (!clear && !clearInput && !clearContext && attachments.length === this.draft.attachments.length) return;
        const text = clear ? '' : this.draft.text;
        this.textarea.value = text; this.commands.refresh();
        this.publish({ ...this.draft, text, attachments, textRevision: this.draft.textRevision + (clear ? 1 : 0),
            ...(clearContext ? {context: {revision: this.draft.context!.revision + 1, value: null}} : {}),
            ...(clearInput ? {input: {...this.draft.input!, revision: this.draft.input!.revision + 1, json: '{}'}} : {}) });
        this.renderAttachments();
    }
    private publish(draft: ComposerDraft): void {
        this.draft = { ...draft, revision: this.draft.revision + 1 };
        this.resizeInput();
        this.changed(this.draft);
    }
    async addFiles(files: readonly File[]): Promise<void> {
        if (this.closed || !this.options.upload) return;
        await Promise.all(files.map(file => this.upload(randomUUID(), file)));
    }
    private async upload(id: string, file: File): Promise<void> {
        const entry: Upload = { file, abort: new AbortController() };
        this.uploads.set(id, entry); this.renderAttachments(); this.changed(this.draft);
        try {
            const ref = await this.prepareUpload(file, entry.abort.signal);
            if (this.closed || this.uploads.get(id) !== entry) return;
            this.uploads.delete(id);
            this.publish({ ...this.draft, attachments: [...this.draft.attachments, { id, file: ref }] });
        } catch (error) {
            if (!this.closed && this.uploads.get(id) === entry) entry.error = errorText(error);
        } finally { if (!this.closed) { this.renderAttachments(); this.changed(this.draft); } }
    }
    private async prepareUpload(file: File, signal: AbortSignal) {
        const images = file.type.startsWith('image/') ? this.options.imageEditing : undefined;
        while (true) {
            signal.throwIfAborted(); const revision = images?.getRevision?.();
            try {
                const prepared = await images?.prepare?.(file, {signal}) ?? file;
                const ref = await this.options.upload!(prepared, {signal});
                await images?.uploaded?.(prepared, ref, {signal}); signal.throwIfAborted();
                if (revision === images?.getRevision?.()) return ref;
            } catch (error) {signal.throwIfAborted(); if (revision === images?.getRevision?.()) throw error;}
        }
    }
    private renderAttachments(): void {
        this.attachmentList.update(this.draft.attachments.length + this.uploads.size, this.uploads.size > 0, this.imageFailure || [...this.uploads.values()].some(upload => !!upload.error));
        this.attachments.replaceChildren();
        for (const item of this.draft.attachments) this.attachment(item);
        for (const [id, upload] of this.uploads) {
            const row = element('div', undefined, `${upload.file.name}: ${upload.error ?? this.t('upload')}`);
            row.dataset.uploadId = id;
            row.append(button(this.t('remove'), () => { upload.abort.abort(); this.uploads.delete(id); this.renderAttachments(); this.changed(this.draft); }));
            if (upload.error) row.append(button(this.t('retry'), () => { void this.upload(id, upload.file); }));
            this.attachments.append(row);
        }
    }
    private attachment(item: DraftAttachment): void {
        const row = element('div', undefined, item.file.name); row.dataset.attachmentId = item.id;
        if (this.options.imageEditing && item.file.mimeType?.startsWith('image/')) row.append(button(this.t('edit'), () => {void this.editImages(item.id);}));
        row.append(button(this.t('remove'), () => {
            this.publish({ ...this.draft, attachments: this.draft.attachments.filter(value => value.id !== item.id) });
            this.renderAttachments();
        }));
        for (const action of this.options.attachmentActions?.(item) ?? []) {
            const control = button(action.label, () => {void Promise.resolve().then(() => action.run()).catch(error => {if (!this.closed) this.feedback.textContent = errorText(error);});});
            control.dataset.chatAction = action.id; control.disabled = !!action.disabled; row.append(control);
        }
        this.attachments.append(row);
    }
    removeAttachment(target: {id: string; fileId: string; revision: number}): boolean {
        if (this.closed || !this.draft.attachments.some(item => item.id === target.id && item.file.id === target.fileId && (item.revision ?? 0) === target.revision)) return false;
        this.publish({...this.draft, attachments: this.draft.attachments.filter(item => item.id !== target.id)}); this.renderAttachments(); return true;
    }
    private async editImages(activeId: string): Promise<void> {
        if (this.closed || this.imageEdit || !this.options.imageEditing) return;
        const operation = this.imageEdit = new AbortController(); this.changed(this.draft);
        const items = this.draft.attachments.filter(item => item.file.mimeType?.startsWith('image/'));
        try {
            const changes = await this.options.imageEditing.edit(items, activeId, {signal: operation.signal});
            if (this.closed || operation.signal.aborted || !changes?.length) return;
            this.replaceImages(changes);
        } catch (error) {if (!this.closed && !operation.signal.aborted) this.feedback.textContent = errorText(error);}
        finally {if (this.imageEdit === operation) this.imageEdit = undefined; if (!this.closed) {this.refreshImages(); this.changed(this.draft);}}
    }
    private replaceImages(changes: NonNullable<Awaited<ReturnType<NonNullable<ChatOptions['imageEditing']>['edit']>>>): void {
        if (new Set(changes.map(change => change.id)).size !== changes.length || changes.some(change =>
            !this.draft.attachments.some(item => item.id === change.id && item.file.id === change.expectedFileId
                && (item.revision ?? 0) === change.expectedRevision))) throw new Error(this.t('commandUnavailable'));
        if (!changes.length) return;
        const attachments = this.draft.attachments.map(item => {const change = changes.find(value => value.id === item.id);
            return change ? {...item, file: change.file, revision: (item.revision ?? 0) + 1} : item;});
        this.imageSignature = JSON.stringify([this.options.imageEditing?.getRevision?.(), attachments.filter(item => item.file.mimeType?.startsWith('image/'))]);
        this.publish({...this.draft, attachments}); this.renderAttachments();
    }
    private refreshImages(): void {
        const port = this.options.imageEditing;
        if (this.closed || !this.active || this.imageEdit || !port?.refresh) return;
        const items = this.draft.attachments.filter(item => item.file.mimeType?.startsWith('image/'));
        if (!items.length) {this.imageRefresh?.abort(); this.imageRefresh = undefined; this.imageFailure = false; this.imageSignature = undefined; return;}
        let revision: string | undefined;
        try {revision = port.getRevision?.();} catch (error) {
            const failed = JSON.stringify(['invalid-policy', items, errorText(error)]);
            if (this.imageSignature !== failed) {this.imageSignature = failed; this.imageFailure = true;
                this.feedback.textContent = errorText(error); this.changed(this.draft);}
            return;
        }
        const signature = JSON.stringify([revision, items]);
        if (signature === this.imageSignature) return;
        this.imageSignature = signature; this.imageRefresh?.abort(); this.imageFailure = false;
        const operation = this.imageRefresh = new AbortController(); this.changed(this.draft);
        void port.refresh(items, {signal: operation.signal}).then(changes => {
            if (revision !== port.getRevision?.()) {this.imageSignature = undefined; return;}
            if (!this.closed && !operation.signal.aborted && changes) this.replaceImages(changes);
        }).catch(error => {
            if (!this.closed && !operation.signal.aborted) {this.imageFailure = true; this.feedback.textContent = errorText(error);
                this.feedback.append(button(this.t('retry'), () => {this.imageSignature = undefined; this.refreshImages();}));}
        }).finally(() => {
            if (this.imageRefresh !== operation) return;
            this.imageRefresh = undefined;
            if (!this.closed) {this.refreshImages(); this.changed(this.draft);}
        });
    }
    update(snapshot: ConversationSnapshot, canSend: boolean): void {
        if (this.closed) return;
        if (!this.observingResize) {
            globalThis.addEventListener('resize', this.resizeInput); this.observingResize = true; this.resizeInput();
        }
        this.refreshImages();
        this.indicators.update(snapshot.composerIndicators);
        this.snapshot = snapshot; this.commands.update(snapshot.commands ?? []);
        const action = this.options.resolveSubmissionMode?.(this.draft, snapshot) ?? snapshot.submissionMode ?? 'send';
        if (this.send.dataset.chatAction !== action) {
            this.send.textContent = this.t(action); presentButton(this.send, action, this.options.presentButton);
        }
        this.targets.update(snapshot.callTargets, this.draft.target);
        this.arguments.update(this.targets.enabled ? this.targets.contract : snapshot.inputContract, this.draft.input, this.options.inputPresentation);
        this.renderSelectors();
        const valid = this.validInput;
        this.send.disabled = !canSend || this.uploading || !valid;
        this.attachmentList.update(this.draft.attachments.length + this.uploads.size, this.uploads.size > 0, this.imageFailure || [...this.uploads.values()].some(upload => !!upload.error));
    }
    private renderSelectors(): void {
        const selectors = this.snapshot?.selectors ?? [];
        this.selection.update(selectors);
        const signature = JSON.stringify([selectors, this.selection.snapshot()]);
        if (signature === this.selectorSignature) return;
        const focused = this.pickers.find(picker => picker.ownsFocus)?.trigger.dataset.selectorTrigger;
        this.pickers.forEach(picker => picker.destroy()); this.pickers = [];
        this.selectorSignature = signature; this.selectors.replaceChildren(); this.advanced.replaceChildren(); this.trailing.replaceChildren();
        this.more.hidden = !this.options.mountComposerMenu && !selectors.some(selector => selector.placement === 'more');
        const combined = new Set(selectors.flatMap(parent => selectors.some(child => child.id === parent.combineWith && child.variants?.selectorId === parent.id) ? [parent.combineWith] : []));
        for (const selector of selectors) {
            if (combined.has(selector.id)) continue;
            const label = selectorControl(selector, selectors, this.selection, () => {
                this.renderSelectors(); this.publish({...this.draft, selection: this.selection.snapshot()});
            });
            (selector.placement === 'more' ? this.advanced : selector.placement === 'end' ? this.trailing : this.selectors).append(label);
            if (selector.placement !== 'more') {
                const picker = new SelectPicker(label.querySelector('select')!, selector.label, this.options);
                label.append(picker.trigger); this.pickers.push(picker);
            }
        }
        if (focused && this.active) this.pickers.find(picker => picker.trigger.dataset.selectorTrigger === focused)?.trigger.focus();
    }
    private async findResources(): Promise<void> {
        this.search?.abort(); this.candidates.replaceChildren();
        const match = this.textarea.value.slice(0, this.textarea.selectionStart).match(/@([^\s@]*)$/);
        if (!match || !this.options.searchResources) return;
        const search = this.search = new AbortController(), text = this.draft.text, cursor = this.textarea.selectionStart;
        try {
            const candidates = await this.options.searchResources(match[1], { signal: search.signal });
            if (search.signal.aborted || this.closed || this.draft.text !== text) return;
            for (const item of candidates) this.candidates.append(button(item.label, () => {
                this.setText(text.slice(0, cursor - match[0].length) + item.insertText + text.slice(cursor));
                this.candidates.replaceChildren(); this.textarea.focus();
            }));
        } catch (error) { if (!search.signal.aborted) this.options.onError?.(error); }
    }
    destroy(): void {
        this.attachmentList.destroy(); this.indicators.destroy(); this.stopMenuDismiss?.(); this.stopMenuDismiss = undefined;
        this.targets.destroy(); this.attachmentPopup?.destroy(); this.pickers.forEach(picker => picker.destroy()); this.pickers = [];
        globalThis.removeEventListener('resize', this.resizeInput); delete this.element.dataset.editorComposing;
        this.imageEdit?.abort();
        this.imageRefresh?.abort(); this.releaseImages?.();
        this.closed = true; this.commands.setActive(false); this.search?.abort();
        for (const upload of this.uploads.values()) upload.abort.abort();
        this.uploads.clear();
        try {this.plugins.destroy();} finally {this.commands.destroy();}
    }
}
