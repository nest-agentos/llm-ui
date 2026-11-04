import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {ContentResizeTracker, ScrollController} from '../src';

const views: {destroy(): void}[] = [];
let observers: {run: () => void; disconnect: ReturnType<typeof vi.fn>}[] = [];
beforeEach(() => {
    vi.useFakeTimers(); observers = [];
    vi.stubGlobal('requestAnimationFrame', (run: FrameRequestCallback) => setTimeout(() => run(0), 16));
    vi.stubGlobal('cancelAnimationFrame', clearTimeout);
    vi.stubGlobal('ResizeObserver', class {
        disconnect = vi.fn(); observe = vi.fn();
        constructor(run: () => void) {observers.push({run, disconnect: this.disconnect});}
    });
});
afterEach(() => {views.splice(0).forEach(view => view.destroy()); vi.useRealTimers(); vi.unstubAllGlobals();});
function fixture() {
    const history = document.createElement('div'); let height = 1000, viewport = 400;
    Object.defineProperties(history, {scrollHeight: {get: () => height}, clientHeight: {get: () => viewport}});
    const scroll = new ScrollController(history); views.push(scroll);
    const resize = (next: number) => {viewport = next; observers[0].run();};
    return {history, scroll, resize, grow: () => {height += 100; scroll.handleContentResize();}};
}
it('follows viewport resizing at the bottom and preserves a reader position through new output', () => {
    const f = fixture(); f.scroll.handleContentResize(); expect(f.history.scrollTop).toBe(600);
    f.resize(300); expect(f.history.scrollTop).toBe(700);
    f.history.dispatchEvent(new Event('wheel')); f.history.scrollTop = 100; f.history.dispatchEvent(new Event('scroll'));
    f.grow(); f.resize(200); expect(f.history.scrollTop).toBe(100);
    f.history.scrollTop = 900; f.history.dispatchEvent(new Event('scroll')); f.grow(); expect(f.history.scrollTop).toBe(1000);
});
it('cancels deferred movement on navigation, hiding and disposal', () => {
    const f = fixture(); f.scroll.forceScrollToBottom(); f.scroll.pauseAutoScroll(); vi.runAllTimers();
    expect(f.history.scrollTop).toBe(0);
    f.scroll.forceScrollToBottom(); f.scroll.setActive(false); vi.runAllTimers(); expect(f.history.scrollTop).toBe(0);
    f.scroll.setActive(true); expect(f.history.scrollTop).toBe(600);
    f.scroll.forceScrollToTop(); f.scroll.destroy(); vi.runAllTimers(); expect(f.history.scrollTop).toBe(600);
    expect(observers[0].disconnect).toHaveBeenCalledOnce();
});
it('discards a queued resize while suspended and releases it on destruction', () => {
    const history = document.createElement('div'); let height = 10;
    Object.defineProperty(history, 'scrollHeight', {get: () => height});
    const changed = vi.fn(), tracker = new ContentResizeTracker(history, changed); views.push(tracker);
    height = 20; observers[0].run(); tracker.suspend(); vi.runAllTimers(); expect(changed).not.toHaveBeenCalled();
    tracker.resume(); height = 30; observers[0].run(); vi.runAllTimers(); expect(changed).toHaveBeenCalledWith(30, 20);
    height = 40; observers[0].run(); tracker.destroy(); vi.runAllTimers(); expect(changed).toHaveBeenCalledOnce();
});
