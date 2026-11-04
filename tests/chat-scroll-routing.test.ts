import {afterEach, expect, it} from 'vitest';
import {bindChatScrollRouting} from '../src/chat-scroll-routing';
const cleanups: (() => void)[] = [];
afterEach(() => {cleanups.splice(0).forEach(close => close()); document.body.replaceChildren();});
function fixture() {
    const root = document.createElement('section'), history = document.createElement('div'), input = document.createElement('textarea'), button = document.createElement('button');
    root.append(history, input, button); document.body.append(root);
    Object.defineProperties(history, {clientHeight: {value: 400}, scrollHeight: {value: 2000}});
    let paused = 0;
    cleanups.push(bindChatScrollRouting(root, history, () => true, () => paused++));
    return {root, history, input, button, paused: () => paused};
}
it('scrolls history when the pointer is over the composer, while preserving textarea scrolling', () => {
    const f = fixture(); f.input.dispatchEvent(new WheelEvent('wheel', {deltaY: 120, bubbles: true, cancelable: true}));
    expect(f.history.scrollTop).toBe(120); expect(f.paused()).toBe(1);
    f.input.style.overflowY = 'auto'; Object.defineProperties(f.input, {scrollHeight: {value: 500}, clientHeight: {value: 100}});
    f.input.dispatchEvent(new WheelEvent('wheel', {deltaY: 120, bubbles: true, cancelable: true}));
    expect(f.history.scrollTop).toBe(120);
    f.history.dispatchEvent(new WheelEvent('wheel', {deltaY: 120, bubbles: true, cancelable: true}));
    expect(f.paused()).toBe(1);
});
it('supports PageDown and PageUp from chat controls without taking editor or dialog keys', () => {
    const f = fixture();
    f.button.dispatchEvent(new KeyboardEvent('keydown', {key: 'PageDown', bubbles: true, cancelable: true})); expect(f.history.scrollTop).toBe(360);
    f.input.dispatchEvent(new KeyboardEvent('keydown', {key: 'PageDown', bubbles: true, cancelable: true})); expect(f.history.scrollTop).toBe(360);
    f.button.dispatchEvent(new KeyboardEvent('keydown', {key: 'PageUp', bubbles: true, cancelable: true})); expect(f.history.scrollTop).toBe(0);
    cleanups.splice(0).forEach(close => close());
    f.button.dispatchEvent(new KeyboardEvent('keydown', {key: 'PageDown', bubbles: true, cancelable: true})); expect(f.history.scrollTop).toBe(0);
});
