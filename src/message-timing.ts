import type {ContentTime, ContentView} from '@nestos/mdxeditor';
import type {ChatMessage} from './contracts';
import type {Translate} from './i18n';
interface Timing {primary?: ContentTime; details: ContentTime[]; started?: number; ended?: number}
/** Render execution facts; this display clock never manufactures a completion timestamp. */
export class MessageTiming {
    private timer?: ReturnType<typeof setTimeout>;
    private message?: ChatMessage;
    private active = true;
    private readonly visibility = () => this.render();
    constructor(private readonly view: ContentView, private readonly t: Translate, private readonly locale?: string) {
        view.element.ownerDocument.addEventListener('visibilitychange', this.visibility);
    }
    update(message: ChatMessage): void {this.message = message; this.render();}
    setActive(active: boolean): void {this.active = active; this.render();}
    private render(): void {
        clearTimeout(this.timer); const message = this.message; if (!message) return;
        const timing = messageTimes(message, this.t);
        this.view.setTimes(timing.primary, timing.details, this.locale);
        this.view.status.textContent = messageStatus(message, timing, this.t);
        if (message.state === 'streaming' && knownTime(timing.started) && this.active && !this.view.element.ownerDocument.hidden)
            this.timer = setTimeout(() => this.render(), 1000);
    }
    destroy(): void {clearTimeout(this.timer); this.message = undefined; this.view.element.ownerDocument.removeEventListener('visibilitychange', this.visibility);}
}
function messageTimes(message: ChatMessage, t: Translate): Timing {
    const times = message.timing, details: ContentTime[] = [];
    const submitted = times?.submittedAt ?? (message.role === 'user' ? message.timestamp : undefined), started = times?.startedAt;
    if (knownTime(submitted)) details.push({label: t('sentAt'), value: submitted});
    if (knownTime(started)) details.push({label: t('startedAt'), value: started});
    const ended = message.state === 'complete' ? times?.completedAt : times?.endedAt;
    const label = message.state === 'failed' ? 'failedAt' : message.state === 'cancelled' ? 'stoppedAt' : 'completedAt';
    let primary = details[0];
    if (message.role !== 'user' && knownTime(ended)) primary = {label: t(label), value: ended};
    if (!primary && knownTime(message.timestamp)) primary = {label: t('recordedAt'), value: message.timestamp};
    return {primary, details: details.filter(item => item !== primary), started, ended};
}
function messageStatus(message: ChatMessage, timing: Timing, t: Translate): string {
    const states = {streaming: 'generating', pending: 'pending', complete: undefined, failed: 'toolFailed', cancelled: 'toolCancelled'} as const;
    const label = states[message.state], status = message.statusLabel ?? (label ? t(label) : '');
    if (!knownTime(timing.started)) return status;
    const ended = message.state === 'streaming' ? Date.now() : timing.ended;
    if (!knownTime(ended) || ended < timing.started) return status;
    const seconds = Math.floor((ended - timing.started) / 1000);
    const duration = t(message.timing?.scope === 'turn' ? 'turnDuration' : 'responseDuration', {seconds});
    return status ? `${status} · ${duration}` : duration;
}
function knownTime(value: number | undefined): value is number {return value !== undefined && Number.isFinite(value) && value > 0;}
