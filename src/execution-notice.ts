import {element} from './dom';

/** Prominent host-supplied progress; its clock is never execution evidence. */
export class ExecutionNotice {
    readonly element = element('section', 'llm-execution-notice');
    private readonly message = element('span', 'llm-execution-notice__message');
    private readonly elapsed = element('span', 'llm-execution-notice__elapsed');
    private content?: {message: string; updatedAt?: number};
    private active = true;
    private timer?: ReturnType<typeof setTimeout>;
    private readonly visibility = () => this.render();
    constructor(private readonly formatElapsed: (seconds: number) => string) {
        this.message.setAttribute('role', 'status'); this.message.setAttribute('aria-live', 'polite');
        this.elapsed.setAttribute('aria-live', 'off');
        this.element.append(this.message, this.elapsed); this.element.hidden = true;
        this.element.ownerDocument.addEventListener('visibilitychange', this.visibility);
    }
    update(content?: {message: string; updatedAt?: number}, active = true): void {
        this.content = content; this.active = active; this.render();
    }
    private render(): void {
        clearTimeout(this.timer); this.timer = undefined;
        this.element.hidden = !this.content || !this.active;
        if (!this.content) return;
        if (this.message.textContent !== this.content.message) this.message.textContent = this.content.message;
        const at = this.content.updatedAt, timed = Number.isFinite(at) && at! > 0;
        this.elapsed.textContent = timed ? this.formatElapsed(Math.max(0, Math.floor((Date.now() - at!) / 1000))) : '';
        if (timed && this.active && !this.element.ownerDocument.hidden) this.timer = setTimeout(() => this.render(), 1_000);
    }
    destroy(): void {
        clearTimeout(this.timer); this.timer = undefined; this.content = undefined;
        this.element.ownerDocument.removeEventListener('visibilitychange', this.visibility); this.element.remove();
    }
}
