import { TimerManager } from './timers';

export interface ScrollControllerCallbacks {
    onUserScrolledUp?: () => void;
    onUserScrolledDown?: () => void;
    onScroll?: () => void;
}

export class ScrollController {
    private shouldAutoScroll = true;
    private _isStreamingMode = false;
    private _isUserScrolledUp = false;
    private lastScrollHeight = 0;
    private lastClientHeight = 0;
    private viewportObserver?: ResizeObserver;
    private scrollLockUntil = 0;

    private scrollFrameId: number | null = null;
    private timers = new TimerManager();

    private readonly threshold = 150;
    private active = true;
    private destroyed = false;

    private isProgrammaticScroll = false;
    private programmaticScrollTimer: ReturnType<typeof setTimeout> | null = null;
    private readonly PROGRAMMATIC_SCROLL_WINDOW = 300;

    private callbacks: ScrollControllerCallbacks;

    constructor(
        private container: HTMLElement,
        callbacks?: ScrollControllerCallbacks,
    ) {
        this.callbacks = callbacks || {};
        this.lastClientHeight = container.clientHeight;
        if (typeof ResizeObserver !== 'undefined') {
            this.viewportObserver = new ResizeObserver(() => this.handleViewportResize());
            this.viewportObserver.observe(container);
        }
        this.container.addEventListener('scroll', this.handleScroll, { passive: true });
        for (const type of ['wheel', 'touchstart', 'pointerdown'])
            this.container.addEventListener(type, this.beginUserScroll, {passive: true});
    }

    get isStreamingMode(): boolean {
        return this._isStreamingMode;
    }

    get isUserScrolledUp(): boolean {
        return this._isUserScrolledUp;
    }

    private handleScroll = (): void => {
        if (!this.active || this.destroyed) return;
        if (this.container.clientHeight !== this.lastClientHeight) { this.handleViewportResize(); return; }

        if (this.isProgrammaticScroll) return;

        const { scrollTop, scrollHeight, clientHeight } = this.container;
        const distanceFromBottom = scrollHeight - scrollTop - clientHeight;

        const wasScrolledUp = this._isUserScrolledUp;
        const isNearBottom = distanceFromBottom < this.threshold;

        this._isUserScrolledUp = !isNearBottom;

        this.notifyTransition(wasScrolledUp);

        if (this._isStreamingMode) {
            this.shouldAutoScroll = !this._isUserScrolledUp;
        } else {
            if (Date.now() < this.scrollLockUntil) return;
            this.shouldAutoScroll = isNearBottom;
        }

        this.callbacks.onScroll?.();
    };

    private notifyTransition(wasScrolledUp: boolean): void {
        if (!wasScrolledUp && this._isUserScrolledUp) this.callbacks.onUserScrolledUp?.();
        else if (wasScrolledUp && !this._isUserScrolledUp) this.callbacks.onUserScrolledDown?.();
    }

    private beginUserScroll = (): void => {this.isProgrammaticScroll = false; this.scrollLockUntil = 0;};

    private handleViewportResize(): void {
        if (!this.active || this.destroyed) return;
        const height = this.container.clientHeight;
        if (height === this.lastClientHeight) return;
        this.lastClientHeight = height;
        if (!height || !this.shouldAutoScroll) return;
        this.markProgrammaticScroll();
        this.container.scrollTop = this.container.scrollHeight - height;
    }

    handleContentResize(): void {
        if (!this.active || this.destroyed || !this.shouldAutoScroll) return;

        const scrollHeight = this.container.scrollHeight;
        const clientHeight = this.container.clientHeight;
        const targetTop = scrollHeight - clientHeight;

        if (scrollHeight === this.lastScrollHeight) return;
        this.lastScrollHeight = scrollHeight;

        if (Math.abs(this.container.scrollTop - targetTop) < 2) return;

        this.markProgrammaticScroll();
        this.container.scrollTop = targetTop;
    }

    pauseAutoScroll(): void {
        this.shouldAutoScroll = false;
        this._isUserScrolledUp = true;
        this.isProgrammaticScroll = false;
        this.scrollLockUntil = 0;
        this.cancelScrollFrame();
    }

    forceScrollToTop(): void {
        if (this.destroyed) return;
        this.shouldAutoScroll = false; this._isUserScrolledUp = false;
        this.queueScroll(true);
    }

    scrollToBottom(force = false): void {
        if (!force && !this.shouldAutoScroll) return;
        if (force && this._isStreamingMode && this._isUserScrolledUp) return;
        this.queueScroll(false);
    }

    forceScrollToBottom(): void {
        if (this.destroyed) return;
        this.shouldAutoScroll = true; this._isUserScrolledUp = false;
        this.queueScroll(false);
    }

    private queueScroll(top: boolean): void {
        if (!this.active || this.destroyed) return;
        this.cancelScrollFrame(); this.markProgrammaticScroll();
        this.scrollFrameId = this.timers.requestAnimationFrame(() => {
            this.scrollFrameId = null;
            this.container.scrollTop = top ? 0 : this.container.scrollHeight;
            this.lastScrollHeight = this.container.scrollHeight;
            this.scrollLockUntil = Date.now() + 100;
        });
    }

    private cancelScrollFrame(): void {
        if (this.scrollFrameId === null) return;
        this.timers.cancelAnimationFrame(this.scrollFrameId); this.scrollFrameId = null;
    }

    private markProgrammaticScroll(): void {
        this.isProgrammaticScroll = true;

        if (this.programmaticScrollTimer !== null) {
            this.timers.clearTimeout(this.programmaticScrollTimer);
        }

        this.programmaticScrollTimer = this.timers.setTimeout(() => {
            this.isProgrammaticScroll = false;
            this.programmaticScrollTimer = null;
        }, this.PROGRAMMATIC_SCROLL_WINDOW);
    }

    enterStreamingMode(): void {
        if (this.destroyed || this._isStreamingMode) return;

        if (this.scrollFrameId !== null) {
            this.cancelScrollFrame();
            this.container.scrollTop = this.container.scrollHeight;
            this.lastScrollHeight = this.container.scrollHeight;
        }

        this._isStreamingMode = true;

        const { scrollTop, scrollHeight, clientHeight } = this.container;
        const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
        const isNearBottom = distanceFromBottom < this.threshold;

        this.shouldAutoScroll = isNearBottom;
        this._isUserScrolledUp = !isNearBottom;
        this.lastScrollHeight = this.container.scrollHeight;
    }

    exitStreamingMode(): void {
        if (!this._isStreamingMode) return;
        this._isStreamingMode = false;
    }

    setActive(active: boolean): void {
        if (this.destroyed) return;
        this.active = active;
        if (!active && this.scrollFrameId !== null) {
            this.cancelScrollFrame();
        }
        if (active) {this.handleViewportResize(); this.handleContentResize();}
    }

    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        this.viewportObserver?.disconnect();
        this.container.removeEventListener('scroll', this.handleScroll);
        for (const type of ['wheel', 'touchstart', 'pointerdown'])
            this.container.removeEventListener(type, this.beginUserScroll);

        if (this.scrollFrameId !== null) {
            this.cancelScrollFrame();
        }

        this.timers.destroy();
    }
}
