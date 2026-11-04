import {button, element} from './dom';
import {translator} from './i18n';
import type {Translation} from './contracts';

export interface OcrReviewCallbacks {
    onConfirm(text: string): void;
    onConfirmKeep(text: string): void;
    onRetry(): void;
    onCancel(): void;
}
/** View-only OCR review. Recognition and persistent assets remain host-owned. */
export class OcrReviewPanel {
    private readonly root = element('section', 'llm-ocr');
    private url?: string;
    private readonly t: ReturnType<typeof translator>;
    constructor(private readonly container: HTMLElement, options: {locale?: 'zh-CN' | 'en'; translate?: Translation} = {}) {
        this.t = translator(options.locale, options.translate); this.root.hidden = true; this.root.setAttribute('aria-live', 'polite');
    }
    get visible(): boolean {return !this.root.hidden;}
    private reset(title: string, cancel: () => void): HTMLElement {
        this.hide(); if (!this.root.isConnected) this.container.prepend(this.root);
        const header = element('div', 'llm-ocr__header'), close = button(this.t('close'), cancel);
        close.className = 'llm-ocr__close'; header.append(element('strong', '', title), close);
        this.root.replaceChildren(header); this.root.hidden = false; return this.root;
    }
    showProcessing(filename: string, cancel: () => void): void {
        this.reset(filename, cancel).append(element('p', 'llm-ocr__status', this.t('ocrProcessing')));
    }
    showReview(image: Blob, text: string, callbacks: OcrReviewCallbacks): void {
        const root = this.reset(this.t('ocrReview'), callbacks.onCancel), body = element('div', 'llm-ocr__review');
        const preview = element('img', 'llm-ocr__image'), input = element('textarea', 'llm-ocr__text');
        this.url = URL.createObjectURL(image); preview.src = this.url; preview.alt = this.t('ocrSource');
        input.value = text; input.spellcheck = false; input.setAttribute('aria-label', this.t('ocrReview'));
        body.append(preview, input); root.append(body);
        this.actions([[this.t('ocrInsertRemove'), () => callbacks.onConfirm(input.value)],
            [this.t('ocrInsertKeep'), () => callbacks.onConfirmKeep(input.value)],
            [this.t('ocrRetry'), callbacks.onRetry], [this.t('close'), callbacks.onCancel]]);
        input.focus();
    }
    showError(message: string, retry: () => void, cancel: () => void): void {
        this.reset(this.t('ocrFailed'), cancel).append(element('p', 'llm-ocr__error', message));
        this.actions([[this.t('ocrRetry'), retry], [this.t('close'), cancel]]);
    }
    private actions(items: Array<[string, () => void]>): void {
        const actions = element('div', 'llm-ocr__actions');
        for (const [label, run] of items) actions.append(button(label, run));
        this.root.append(actions);
    }
    hide(): void {
        if (this.url) URL.revokeObjectURL(this.url); this.url = undefined;
        this.root.hidden = true; this.root.replaceChildren();
    }
    destroy(): void {this.hide(); this.root.remove();}
}
