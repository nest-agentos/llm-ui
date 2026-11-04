import {button, element, presentButton} from './dom';
import type {Translate} from './i18n';

/** Attachment actions remain in the disclosure; compact mode exposes only its count and state. */
export class ComposerAttachments {
    readonly element = element('details', 'llm-chat__attachment-list');
    private readonly summary = element('summary');
    private readonly count = element('span', 'llm-chat__attachment-count');
    private readonly control: HTMLButtonElement;
    private listening = false;
    private readonly media = typeof matchMedia === 'function' ? matchMedia('(max-width: 768px)') : undefined;
    private readonly resize = () => {this.element.open = !this.media?.matches;};
    constructor(list: HTMLElement, private readonly t: Translate, present?: (button: HTMLButtonElement, action: string) => void) {
        this.control = presentButton(button(t('attachments'), () => {}), 'attachments', present);
        this.control.append(this.count); this.summary.append(this.control); this.element.append(this.summary, list);
        this.control.onclick = event => {event.preventDefault(); this.element.open = !this.element.open;};
        this.element.ontoggle = () => this.control.setAttribute('aria-expanded', String(this.element.open));
        this.resize(); this.update(0, false, false);
    }
    update(count: number, uploading: boolean, failed: boolean): void {
        if (count && !this.listening) {this.media?.addEventListener('change', this.resize); this.listening = true;}
        this.element.hidden = count === 0; this.count.textContent = `${count}${failed ? '!' : uploading ? '…' : ''}`;
        this.element.dataset.state = failed ? 'failed' : uploading ? 'uploading' : 'ready';
        const label = `${this.t('attachments')} (${count})${failed ? ` · ${this.t('failed')}` : uploading ? ` · ${this.t('upload')}` : ''}`;
        this.control.title = label; this.control.setAttribute('aria-label', label); this.control.setAttribute('aria-expanded', String(this.element.open));
    }
    destroy(): void {this.media?.removeEventListener('change', this.resize); this.element.remove();}
}
