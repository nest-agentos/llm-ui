import {ContentView} from '@nestos/mdxeditor';
import {MessageTiming} from './message-timing';
import {ToolOutputGroups} from './tool-groups';
import type {DisclosureEntry, DisclosureController} from './disclosure';
import type { ChatMessage, ChatOptions, ConversationSnapshot, MessageTarget } from './contracts';
import { button, presentButton, disposeAll, element, errorText } from './dom';
import type { Translate } from './i18n';
import { PartView } from './parts';

export interface MessageCommands {
    edit(target: MessageTarget, text: string): Promise<void>;
    retry(target: MessageTarget): Promise<void>;
}
export class MessageView {
    readonly content: ContentView;
    readonly element: HTMLElement;
    private readonly body: HTMLElement;
    private readonly actions: HTMLElement;
    private readonly more: HTMLDetailsElement;
    private readonly moreBody: HTMLElement;
    private readonly toggle: HTMLButtonElement;
    private readonly timing: MessageTiming;
    private disclosureEntry?: DisclosureEntry;
    private stopDisclosure?: () => void;
    private readonly toolGroups: ToolOutputGroups;
    private readonly feedback = element('p', 'llm-chat__error');
    private readonly parts = new Map<string, PartView>();
    private readonly retired: Promise<void>[] = [];
    private editor?: HTMLTextAreaElement;
    private busy = false;
    private closed = false;
    constructor(private readonly options: ChatOptions, private readonly t: Translate,
        private readonly commands: MessageCommands, private readonly rendered: () => void, private readonly disclosure: DisclosureController) {
        this.content = new ContentView({labels: {expand: t('toggleMessage'), collapse: t('toggleMessage'), details: t('timeDetails'), copy: t('copy'), more: t('more')},
            onToggle: expanded => {if (this.disclosureEntry) this.disclosure.toggle(this.disclosureEntry, !expanded);}});
        this.element = this.content.element; this.element.classList.add('llm-chat__message');
        this.body = this.content.body; this.body.classList.add('llm-chat__body');
        this.actions = this.content.actions; this.actions.classList.add('llm-chat__message-actions');
        this.content.header.dataset.searchExclude = '';
        this.actions.dataset.searchExclude = '';
        this.toggle = this.content.toggle;
        this.timing = new MessageTiming(this.content, t, options.locale);
        this.toolGroups = new ToolOutputGroups(this.body, this.t, this.disclosure);
        this.more = this.content.more; this.more.classList.add('llm-chat__message-more');
        this.moreBody = this.content.moreBody; this.moreBody.classList.add('llm-chat__message-menu');
        presentButton(this.content.moreButton, 'more', options.presentButton);
        this.element.append(this.feedback);
    }
    update(message: ChatMessage, snapshot: ConversationSnapshot): void {
        this.element.dataset.messageId = message.id;
        if (!this.disclosureEntry) {
            this.disclosureEntry = {id: JSON.stringify([snapshot.conversationId, message.id, 'message']), element: this.element,
                trigger: this.toggle, present: collapsed => this.content.setExpanded(!collapsed)}; this.stopDisclosure = this.disclosure.register(this.disclosureEntry);
        }
        this.content.update({title: this.t(message.role), preview: message.parts.flatMap(part => 'text' in part ? [part.text] : part.kind === 'tool' ? [part.summary] : []).join(' ').replace(/\s+/g, ' ').slice(0, 160)});
        this.element.dataset.role = message.role;
        this.element.dataset.state = message.state;
        const keys = new Set<string>();
        for (const part of message.parts) {
            const key = `${part.id}:${part.kind}:${part.kind === 'extension' ? part.type : ''}`; keys.add(key);
            let view = this.parts.get(key);
            if (!view) { view = new PartView(this.options, this.t, this.rendered, this.disclosure); this.parts.set(key, view); }
            view.update(part, { message, snapshot });
        }
        for (const [key, view] of this.parts) if (!keys.has(key)) {
            view.element.remove(); this.retire(view.destroy()); this.parts.delete(key);
        }
        this.toolGroups.sync(message.parts.map(part => ({id: part.id,
            element: this.parts.get(`${part.id}:${part.kind}:${part.kind === 'extension' ? part.type : ''}`)!.element,
            tools: message.role !== 'tool' && part.kind === 'tool' && !message.parts.every(part => part.kind === 'tool') ? [part] : undefined,
            continuation: message.role === 'assistant' && part.kind === 'reasoning'})), JSON.stringify([snapshot.conversationId, message.id]));
        this.renderActions(message, snapshot);
    }
    private iconButton(action: 'copy' | 'edit' | 'retry', run: () => void): HTMLButtonElement {
        return presentButton(button(this.t(action), run), action, this.options.presentButton);
    }
    renderActions(message: ChatMessage, snapshot: ConversationSnapshot): void {
        this.actions.replaceChildren(); this.moreBody.replaceChildren();
        this.timing.update(message);
        const text = () => message.parts.flatMap(part => 'text' in part ? [part.text] : part.kind === 'json' ? [JSON.stringify(part.value, null, 2)] : []).join('\n\n');
        this.content.setCopySource(text, this.t('copy'), error => this.options.onError?.(error));
        presentButton(this.content.copyButton, 'copy', this.options.presentButton);
        const target = { messageId: message.id, expectedRevision: message.revision };
        if (this.options.actions.retry && message.allowed?.includes('retry') && snapshot.allowed.includes('retry'))
            this.actions.append(this.iconButton('retry', () => { void this.run(() => this.commands.retry(target)); }));

        if (this.options.actions.edit && message.allowed?.includes('edit') && snapshot.allowed.includes('edit'))
            (message.role === 'user' ? this.actions : this.moreBody).append(this.iconButton('edit', () => this.openEditor(target, text())));
        for (const action of this.options.messageActions?.({message, snapshot}) ?? []) {
            const control = presentButton(button(action.label, () => {void this.run(async () => {await action.run();});}), action.id, this.options.presentButton);
            control.disabled = !!action.disabled; control.dataset.hostDisabled = String(!!action.disabled);
            (action.placement === 'more' ? this.moreBody : this.actions).append(control);
        }
        this.more.hidden = !this.moreBody.childElementCount; this.actions.append(this.more);
        if (this.busy) this.actions.querySelectorAll('button').forEach(node => {node.disabled = true;});
    }
    private openEditor(target: MessageTarget, text: string): void {
        if (this.closed || this.editor) return;
        const form = element('form', 'llm-chat__edit');
        const editor = this.editor = element('textarea'); editor.value = text;
        const save = element('button', undefined, this.t('save')); save.type = 'submit';
        const close = () => { form.remove(); this.editor = undefined; };
        form.append(editor, save, button(this.t('close'), close)); this.element.append(form);
        form.addEventListener('submit', event => {
            event.preventDefault(); void this.run(async () => { await this.commands.edit(target, editor.value); close(); });
        });
        editor.focus();
    }
    private async run(work: () => Promise<void>): Promise<void> {
        if (this.closed || this.busy) return;
        this.busy = true; this.feedback.textContent = '';
        this.element.querySelectorAll('button').forEach(node => { node.disabled = true; });
        try { await work(); }
        catch (error) { this.feedback.textContent = errorText(error); }
        finally { this.busy = false; this.element.querySelectorAll('button').forEach(node => {node.disabled = node.dataset.hostDisabled === 'true';}); }
    }
    private retire(disposal: Promise<void>): void { void disposal.catch(() => {}); this.retired.push(disposal); }
    setActive(active: boolean): void {this.timing.setActive(active);}
    reveal(): void {
        for (let parent = this.element.parentElement; parent; parent = parent.parentElement)
            if (parent instanceof HTMLDetailsElement) parent.open = true;
        if (this.disclosureEntry) this.disclosure.toggle(this.disclosureEntry, false);
    }
    destroy(): Promise<void> {
        this.closed = true; this.timing.destroy(); this.content.destroy(); this.toolGroups.destroy(); this.stopDisclosure?.();
        return disposeAll([...this.parts.values()].map(part => () => part.destroy()).concat(this.retired.map(task => () => task)));
    }
}
