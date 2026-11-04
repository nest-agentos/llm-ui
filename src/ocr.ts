import type {AttachmentRef, ChatOptions, ChatView, DraftAttachment, MessageAction} from './contracts';
import {OcrReviewPanel} from './ocr-panel';
import {downscaleImageForOcr} from './image-downscale';
import {randomUUID} from './random';
import {translator} from './i18n';

export interface OcrDiagnostic {
    operation: 'chat.ocr'; operationId: string; stage: 'asset-read' | 'preprocess' | 'recognize' | 'apply';
    result: 'success' | 'failure' | 'cancelled'; code?: string; durationMs: number;
}
export interface OcrPort {
    recognize(image: Blob, signal: AbortSignal): Promise<string>;
    read?(attachment: AttachmentRef, signal: AbortSignal): Promise<Blob>;
    prepare?(image: Blob, signal: AbortSignal): Promise<Blob>;
    onDiagnostic?(event: OcrDiagnostic): void;
}
/** Optional chat feature owns review and cancellation, never host configuration or execution. */
export class ChatOcr {
    private panel?: OcrReviewPanel;
    private operation?: AbortController;
    private active = true;
    private closed = false;
    private readonly t;
    constructor(private readonly view: ChatView, private readonly options: ChatOptions) {this.t = translator(options.locale, options.translate);}
    actions(item: DraftAttachment): MessageAction[] {
        return this.options.ocr && item.file.mimeType?.startsWith('image/')
            ? [{id: 'ocr', label: this.t('ocr'), run: () => this.recognize(item)}] : [];
    }
    assertRecoverable(): void {
        if (this.panel?.visible) throw Object.assign(new Error(this.t('ocrFinishReview')), {code: 'RECOVERY_BUSY'});
    }
    private current(item: DraftAttachment): void {
        if (this.closed || !this.active || !this.view.getDraft().attachments.some(current => current.id === item.id
            && current.file.id === item.file.id && (current.revision ?? 0) === (item.revision ?? 0)))
            throw Object.assign(new Error(this.t('ocrAttachmentChanged')), {code: 'OCR_ATTACHMENT_CHANGED'});
    }
    private async read(item: DraftAttachment, signal: AbortSignal): Promise<Blob> {
        if (this.options.ocr?.read) return this.options.ocr.read(item.file, signal);
        if (!this.options.assets) throw Object.assign(new Error(this.t('ocrUnavailable')), {code: 'OCR_ASSET_UNAVAILABLE'});
        const bytes = await this.options.assets.read(item.file.id); signal.throwIfAborted();
        if (!bytes) throw Object.assign(new Error(this.t('ocrUnavailable')), {code: 'OCR_ASSET_UNAVAILABLE'});
        return new Blob([bytes], {type: item.file.mimeType});
    }
    private async recognize(item: DraftAttachment): Promise<void> {
        this.current(item); this.operation?.abort(); const operation = this.operation = new AbortController();
        const panel = this.panel ??= new OcrReviewPanel(this.view.inputContext().container, this.options);
        const operationId = randomUUID(), started = Date.now(); let stage: OcrDiagnostic['stage'] = 'asset-read';
        panel.showProcessing(item.file.name, () => this.cancel());
        try {
            const image = await this.read(item, operation.signal); operation.signal.throwIfAborted(); stage = 'preprocess';
            const prepared = await (this.options.ocr!.prepare?.(image, operation.signal) ?? downscaleImageForOcr(image));
            operation.signal.throwIfAborted(); stage = 'recognize';
            const text = (await this.options.ocr!.recognize(prepared, operation.signal)).trim();
            operation.signal.throwIfAborted(); this.current(item);
            if (!text) throw Object.assign(new Error(this.t('ocrEmpty')), {code: 'OCR_EMPTY'});
            panel.showReview(image, text, {onConfirm: value => this.apply(item, value, true), onConfirmKeep: value => this.apply(item, value, false),
                onRetry: () => {void this.recognize(item).catch(error => this.error(error));}, onCancel: () => this.cancel()});
            this.report({operationId, stage, result: 'success', durationMs: Date.now() - started});
        } catch (error) {
            this.report({operationId, stage, result: operation.signal.aborted ? 'cancelled' : 'failure',
                code: safeCode(error), durationMs: Date.now() - started});
            if (operation.signal.aborted || this.closed) return;
            panel.showError(error instanceof Error ? error.message : this.t('ocrFailed'),
                () => {void this.recognize(item).catch(error => this.error(error));}, () => this.cancel()); this.error(error);
        }
    }
    private apply(item: DraftAttachment, text: string, remove: boolean): void {
        const operationId = randomUUID(), started = Date.now();
        try {
            this.current(item);
            if (remove && !this.view.removeAttachment({id: item.id, fileId: item.file.id, revision: item.revision ?? 0}))
                throw Object.assign(new Error(this.t('ocrAttachmentChanged')), {code: 'OCR_ATTACHMENT_CHANGED'});
            this.view.inputContext().insertAtCursor(text); this.cancel(); this.view.focus();
            this.report({operationId, stage: 'apply', result: 'success', durationMs: Date.now() - started});
        } catch (error) {this.report({operationId, stage: 'apply', result: 'failure', code: safeCode(error), durationMs: Date.now() - started}); this.error(error);}
    }
    private report(event: Omit<OcrDiagnostic, 'operation'>): void {
        try {this.options.ocr?.onDiagnostic?.({...event, operation: 'chat.ocr'});} catch { /* Diagnostics cannot change review state. */ }
    }
    private error(error: unknown): void {try {this.options.onError?.(error);} catch { /* Host errors cannot consume input. */ }}
    private cancel(): void {this.operation?.abort(); this.panel?.hide();}
    setActive(active: boolean): void {this.active = active; if (!active) this.cancel();}
    destroy(): void {if (this.closed) return; this.closed = true; this.cancel(); this.panel?.destroy();}
}
function safeCode(error: unknown): string {
    const code = (error as {code?: unknown})?.code;
    return typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(code) ? code : 'OCR_FAILED';
}
