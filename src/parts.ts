import type {DisclosureController} from './disclosure';
import { AssetResolverPlugin, MDxRenderer } from '@itookit/mdxeditor';
import type { ChatOptions, MessagePart, MountedRenderer, RenderContext } from './contracts';
import { element, errorText } from './dom';
import { markdownOptions } from './content-policy';
import type { Translate } from './i18n';

/** One renderer per stable part, with serialized updates and an abortable lifetime. */
export class PartView {
    readonly element = element('div', 'llm-chat__part');
    private readonly abort = new AbortController();
    private markdown?: MDxRenderer;
    private extension?: MountedRenderer;
    private tail = Promise.resolve();
    private content?: HTMLElement;
    private json?: {details: HTMLDetailsElement; summary: HTMLElement; content: HTMLElement; part: Extract<MessagePart, {kind: 'json'}>};
    private tool?: {details: HTMLDetailsElement; label: HTMLElement; state: HTMLElement; content: HTMLElement};
    private disposed?: Promise<void>;
    private stopDisclosure?: () => void;
    constructor(private readonly options: ChatOptions, private readonly t: Translate,
        private readonly rendered: () => void, private readonly disclosure: DisclosureController) {}
    update(part: MessagePart, context: RenderContext): void {
        this.tail = this.tail.catch(() => {}).then(async () => {
            if (this.abort.signal.aborted) return;
            try { await this.render(part, context); }
            catch (error) {
                if (this.abort.signal.aborted) return;
                this.element.textContent = errorText(error); this.options.onError?.(error);
            }
            if (!this.abort.signal.aborted) this.rendered();
        });
    }
    private async render(part: MessagePart, context: RenderContext): Promise<void> {
        this.element.dataset.kind = part.kind;
        if (part.kind === 'markdown' || part.kind === 'reasoning') return this.renderMarkdown(part, context);
        if (part.kind === 'extension') return this.renderExtension(part, context);
        if (part.kind === 'json') return this.renderJson(part, context);
        if (part.kind === 'tool') return this.renderTool(part, context);
        if (part.kind === 'attachment') {
            const file = element('a', undefined, part.file.name); file.href = '#';
            file.addEventListener('click', event => {
                event.preventDefault(); void this.options.onOpenResource?.(part.file.id).catch(this.options.onError ?? (() => {}));
            });
            this.element.replaceChildren(file);
        }
    }
    private renderTool(part: Extract<MessagePart, {kind: 'tool'}>, context: RenderContext): void {
        if (!this.tool) {
            const details = element('details'), summary = element('summary'), label = element('span'), state = element('span', 'llm-chat__tool-state'), content = element('pre');
            details.open = true; state.dataset.searchExclude = ''; summary.append(label, state); details.append(summary, content);
            this.tool = {details, label, state, content}; this.element.replaceChildren(details);
            this.registerDisclosure(details, part, context);
        }
        const labels = {pending: 'toolPending', running: 'toolRunning', succeeded: 'toolSucceeded', failed: 'toolFailed', cancelled: 'toolCancelled', unknown: 'toolUnknown'} as const;
        this.tool.details.dataset.state = part.state;
        this.tool.label.textContent = `${part.name}: ${part.summary}`;
        this.tool.state.textContent = this.t(labels[part.state]); this.tool.content.textContent = part.detail ?? '';
    }
    private renderJson(part: Extract<MessagePart, {kind: 'json'}>, context?: RenderContext): void {
        if (!this.json) {
            const details = element('details'), summary = element('summary'), content = element('pre');
            this.json = {details, summary, content, part}; details.append(summary, content); this.element.append(details);
            details.dataset.jsonPart = part.id;
            this.registerDisclosure(details, part, context!);
            details.addEventListener('toggle', () => {
                if (this.abort.signal.aborted || !this.json) return;
                this.renderJson(this.json.part); this.rendered();
            });
        }
        this.json.part = part; this.json.summary.textContent = part.label ?? 'JSON';
        this.json.content.textContent = this.json.details.open ? JSON.stringify(part.value, null, 2) : '';
    }
    private async renderMarkdown(part: Extract<MessagePart, { kind: 'markdown' | 'reasoning' }>, context: RenderContext): Promise<void> {
        if (!this.markdown) {
            const configured = this.options.markdown?.(context, part);
            this.markdown = new MDxRenderer({ htmlPolicy: 'literal', assets: this.options.assets, signal: this.abort.signal, documentPath: configured?.documentPath });
            this.markdown.markedExtensions.push(markdownOptions.markedOptions);
            this.markdown.usePlugin(new AssetResolverPlugin());
            for (const plugin of configured?.plugins ?? []) this.markdown.usePlugin(plugin);
            this.content = element('div');
            if (part.kind === 'reasoning') {
                const details = element('details'), summary = element('summary', undefined, this.t('reasoning'));
                summary.dataset.searchExclude = ''; details.append(summary, this.content);
                this.element.append(details);
                this.registerDisclosure(details, part, context);
            } else this.element.append(this.content);
        }
        if (context.message.state === 'streaming') await this.markdown.renderStreaming(this.content!, part.text);
        else await this.markdown.render(this.content!, part.text, markdownOptions);
    }
    private async renderExtension(part: Extract<MessagePart, { kind: 'extension' }>, context: RenderContext): Promise<void> {
        this.element.dataset.searchExclude = '';
        const factory = this.options.renderers?.[part.type];
        if (!factory) { this.element.textContent = `${this.t('unsupported')}: ${part.type}`; return; }
        if (!this.extension) this.extension = factory(this.element, part, context);
        else await this.extension.update?.(part, context);
    }
    private registerDisclosure(element: HTMLDetailsElement, part: MessagePart, context: RenderContext): void {
        const id = JSON.stringify([context.snapshot.conversationId, context.message.id, part.id, part.kind]);
        this.stopDisclosure = this.disclosure.register({id, element});
    }
    destroy(): Promise<void> {
        if (this.disposed) return this.disposed;
        this.abort.abort(); this.stopDisclosure?.();
        return this.disposed = this.tail.finally(async () => {
            try { this.markdown?.destroy(); } finally { await this.extension?.destroy(); }
        });
    }
}
