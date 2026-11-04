import {afterEach, expect, it, vi} from 'vitest';
import {resizeMessageInput, shouldSubmitMessage} from '../src';

afterEach(() => {vi.unstubAllGlobals(); document.body.replaceChildren();});
it('shares desktop, touch, modified Return and IME submission rules', () => {
    vi.stubGlobal('matchMedia', () => ({matches: false}));
    expect(shouldSubmitMessage(new KeyboardEvent('keydown', {key: 'Enter'}))).toBe(true);
    expect(shouldSubmitMessage(new KeyboardEvent('keydown', {key: 'Enter', shiftKey: true}))).toBe(false);
    expect(shouldSubmitMessage(new KeyboardEvent('keydown', {key: 'Enter', isComposing: true}))).toBe(false);
    expect(shouldSubmitMessage(new KeyboardEvent('keydown', {key: 'Enter', keyCode: 229}))).toBe(false);
    vi.stubGlobal('matchMedia', () => ({matches: true}));
    expect(shouldSubmitMessage(new KeyboardEvent('keydown', {key: 'Enter'}))).toBe(false);
    expect(shouldSubmitMessage(new KeyboardEvent('keydown', {key: 'Enter', ctrlKey: true}))).toBe(true);
    expect(shouldSubmitMessage(new KeyboardEvent('keydown', {key: 'Enter', metaKey: true}))).toBe(true);
    const handled = new KeyboardEvent('keydown', {key: 'Enter', ctrlKey: true, cancelable: true}); handled.preventDefault();
    expect(shouldSubmitMessage(handled)).toBe(false);
});
it('grows and shrinks the writing area within the host CSS limits', () => {
    const textarea = document.createElement('textarea'); document.body.append(textarea);
    textarea.style.minHeight = '32px'; textarea.style.maxHeight = '160px'; let contentHeight = 300;
    Object.defineProperty(textarea, 'scrollHeight', {get: () => contentHeight});
    resizeMessageInput(textarea); expect(textarea.style.height).toBe('160px');
    contentHeight = 20; resizeMessageInput(textarea); expect(textarea.style.height).toBe('32px');
});
