import type {ConversationSnapshot} from './contracts';
import type {Translate} from './i18n';

/** Update only the status text; this clock never polls or rerenders chat history. */
export class ExecutionStatus {
    private snapshot?: ConversationSnapshot;
    private active = true;
    private timer?: ReturnType<typeof setTimeout>;
    private readonly visibility = () => this.render();
    constructor(private readonly element: HTMLElement, private readonly t: Translate) {
        element.ownerDocument.addEventListener('visibilitychange', this.visibility);
    }
    update(snapshot: ConversationSnapshot, active: boolean): void {
        this.snapshot = snapshot; this.active = active; this.render();
    }
    private render(): void {
        clearTimeout(this.timer); this.timer = undefined;
        const state = this.snapshot;
        if (!state) return;
        const running = !state.error && !state.loading && state.execution === 'running';
        const activity = running ? state.executionActivity : undefined;
        this.element.dataset.executionActivity = String(running);
        let text = state.error?.message ?? this.t(state.loading ? 'loading' : state.connection);
        if (running) text += ` · ${activity?.label ?? this.t('executionRunning')}`;
        else if (!state.error && !state.loading && state.execution === 'waiting-input') text += ` · ${this.t('executionWaiting')}`;
        const at = activity?.updatedAt;
        if (Number.isFinite(at) && at! > 0) text += ` · ${this.t('executionLastActivity', {seconds: Math.max(0, Math.floor((Date.now() - at!) / 1000))})}`;
        this.element.textContent = text;
        if (this.active && !this.element.ownerDocument.hidden && running && Number.isFinite(at) && at! > 0)
            this.timer = setTimeout(() => this.render(), 1_000);
    }
    destroy(): void {
        clearTimeout(this.timer); this.timer = undefined;
        this.element.ownerDocument.removeEventListener('visibilitychange', this.visibility); this.snapshot = undefined;
    }
}
