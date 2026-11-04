import { TimerManager } from './timers';

export class ContentResizeTracker {
    private resizeObserver?: ResizeObserver;
    private pendingCallback = false;
    private lastNotifiedHeight = 0;
    private timers = new TimerManager();
    private rafId: number | null = null;
    private isSuspended = false;
    private destroyed = false;

    constructor(
        private container: HTMLElement,
        private onResize: (newHeight: number, oldHeight: number) => void
    ) {
        this.lastNotifiedHeight = container.scrollHeight;
        if (typeof ResizeObserver !== 'undefined') {
            this.resizeObserver = new ResizeObserver(this.handleObserverEntry);
            this.resizeObserver.observe(container);
        }
    }

    suspend(): void {
        this.isSuspended = true;
        if (this.rafId !== null) this.timers.cancelAnimationFrame(this.rafId);
        this.rafId = null; this.pendingCallback = false;
    }

    resume(): void {
        if (this.destroyed) return;
        this.isSuspended = false;
        this.lastNotifiedHeight = this.container.scrollHeight;
    }

    private handleObserverEntry = (): void => {
        if (this.destroyed || this.isSuspended) return;
        if (this.pendingCallback) return;

        this.pendingCallback = true;
        this.scheduleCheck();
    };

    private scheduleCheck(): void {
        if (this.rafId !== null) return;

        this.rafId = this.timers.requestAnimationFrame(() => {
            this.rafId = null;
            this.pendingCallback = false;
            this.checkHeight();
        });
    }

    private checkHeight(): void {
        if (this.isSuspended) return;
        const currentHeight = this.container.scrollHeight;
        if (currentHeight !== this.lastNotifiedHeight) {
            const oldHeight = this.lastNotifiedHeight;
            this.lastNotifiedHeight = currentHeight;
            this.onResize(currentHeight, oldHeight);
        }
    }

    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        this.suspend();
        this.resizeObserver?.disconnect();
        this.timers.destroy();
    }
}
