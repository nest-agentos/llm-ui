import type {ComposerIndicator} from './contracts';
import {element} from './dom';
import {observePopupDismiss} from './popup-dismiss';
import type {Translate} from './i18n';

/** Inline observations preserve editing space; full details open above the action row. */
export class ComposerIndicators {
    readonly element = element('details', 'llm-chat__input-status');
    private readonly summary = element('summary', 'llm-chat__input-status-summary');
    private readonly body = element('dl', 'llm-chat__input-status-details');
    private signature?: string;
    private readonly stopDismiss: () => void;
    constructor(t: Translate) {
        this.summary.setAttribute('aria-label', t('inputStatus'));
        this.element.append(this.summary, this.body); this.element.hidden = true;
        this.stopDismiss = observePopupDismiss([this.element], () => {this.element.open = false;});
    }
    update(items: readonly ComposerIndicator[] = []): void {
        const signature = JSON.stringify(items); if (signature === this.signature) return;
        this.signature = signature; this.element.hidden = !items.length;
        if (!items.length) {this.element.open = false; this.summary.replaceChildren(); this.body.replaceChildren(); return;}
        const summaries = items.map(item => {
            const node = element('span', 'llm-chat__input-status-item'); node.dataset.tone = item.tone ?? 'normal';
            node.title = `${item.label}: ${item.value}`; node.setAttribute('aria-label', node.title);
            node.append(element('span', 'llm-chat__input-status-label', item.label));
            if (item.progress !== undefined) node.append(progressMeter(item));
            else node.append(element('span', 'llm-chat__input-status-value', item.value));
            return node;
        });
        this.summary.replaceChildren(...summaries);
        this.body.replaceChildren(...items.flatMap(item => [element('dt', undefined, item.label), element('dd', undefined, item.detail ?? item.value)]));
    }
    destroy(): void {this.stopDismiss();}
    reset(): void {this.element.open = false; this.signature = undefined; this.update();}
}

function progressMeter(item: ComposerIndicator): HTMLElement {
    const meter = element('span', 'llm-chat__input-meter');
    const progress = typeof item.progress === 'number' && Number.isFinite(item.progress) ? Math.max(0, Math.min(1, item.progress)) : undefined;
    meter.dataset.unknown = String(progress === undefined);
    if (progress !== undefined) {
        meter.setAttribute('role', 'meter'); meter.setAttribute('aria-label', item.label);
        meter.setAttribute('aria-valuemin', '0'); meter.setAttribute('aria-valuemax', '100');
        meter.setAttribute('aria-valuenow', String(Number((progress * 100).toPrecision(3)))); meter.setAttribute('aria-valuetext', item.value);
    }
    for (let index = 0; index < 8; ++index) {
        const segment = element('span', 'llm-chat__input-meter-segment'); segment.setAttribute('aria-hidden', 'true');
        segment.dataset.filled = String(progress !== undefined && index < Math.ceil(progress * 8)); meter.append(segment);
    }
    return meter;
}
