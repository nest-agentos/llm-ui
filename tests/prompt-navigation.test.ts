import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {PromptNavigator} from '../src';

const views: PromptNavigator[] = [];
beforeEach(() => {
    vi.stubGlobal('matchMedia', () => ({matches: false}));
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0));
    vi.stubGlobal('cancelAnimationFrame', clearTimeout);
});
afterEach(() => {
    views.splice(0).forEach(view => view.destroy()); document.body.replaceChildren();
    vi.restoreAllMocks(); vi.unstubAllGlobals();
});
function fixture(count = 120, translate?: import('../src').Translation) {
    const root = document.createElement('section'), history = document.createElement('div'), trigger = document.createElement('button');
    root.append(trigger, history); document.body.append(root);
    const items = Array.from({length: count}, (_, i) => ({id: `question-${i}`, text: `Question ${i}`}));
    const rows = items.map(item => {const element = document.createElement('article'); history.append(element); return {id: item.id, element};});
    history.scrollTo = vi.fn();
    const earlier = vi.fn(), reveal = vi.fn(id => rows.find(row => row.id === id)?.element ?? null);
    const view = new PromptNavigator({root, history, trigger, getRows: () => rows, reveal, earlier, locale: 'en', translate});
    views.push(view); view.update(items);
    const button = (selector: string) => root.querySelector<HTMLButtonElement>(selector)!;
    return {root, history, trigger, items, view, earlier, reveal, button};
}
it('uses the product navigation behavior with host-owned identities and rows', () => {
    const f = fixture(); f.trigger.click();
    expect(f.root.querySelectorAll('[data-prompt-id]')).toHaveLength(100);
    expect(f.root.querySelector<HTMLElement>('[data-prompt-id]')!.dataset.promptId).toBe('question-119');
    f.button('[data-jump="first"]').click();
    expect(document.activeElement?.getAttribute('data-prompt-id')).toBe('question-0');
    (document.activeElement as HTMLButtonElement).click();
    expect(f.reveal).toHaveBeenCalledWith('question-0'); expect(f.history.scrollTo).toHaveBeenCalledOnce();
    f.view.destroy(); f.trigger.click(); expect(f.root.querySelector('.llm-prompt-nav')).toBeNull();
});
it('passes named values to host translations without imposing placeholder syntax or word order', () => {
    const translate = vi.fn((key, parameters) => key === 'promptCount' ? `Total ${parameters.total}; visible ${parameters.count}` : undefined);
    const f = fixture(120, translate); f.trigger.click();
    expect(f.root.querySelector('.llm-prompt-nav__range')!.textContent).toBe('Total 120; visible 100');
    expect(translate).toHaveBeenCalledWith('promptCount', {count: 100, total: 120});
});
it('searches full text, escapes untrusted identifiers and keeps paging explicit', () => {
    const f = fixture(1), id = '\"><img src=x onerror=alert(1)>';
    f.view.update([{id, text: '<script>untrusted</script> ' + 'long '.repeat(100) + 'needle'}]);
    f.view.setEarlier(true, false, 'PAGE_UNAVAILABLE'); f.trigger.click();
    expect(f.earlier).not.toHaveBeenCalled(); expect(f.root.querySelector('script, img')).toBeNull();
    const input = f.root.querySelector<HTMLInputElement>('input')!; input.value = 'needle'; input.dispatchEvent(new Event('input'));
    expect(f.button('[data-prompt-id]').dataset.promptId).toBe(id);
    expect(f.root.querySelector('.llm-prompt-nav__scope')!.textContent).toContain('PAGE_UNAVAILABLE');
    f.view.setEarlier(true, true, ''); f.button('[data-action="earlier"]').click(); expect(f.earlier).not.toHaveBeenCalled();
    f.view.setEarlier(true, false, ''); f.button('[data-action="earlier"]').click(); expect(f.earlier).toHaveBeenCalledOnce();
});
it.each(['missing', 'throwing'])('isolates panel identities when native UUID is %s', mode => {
    vi.spyOn(crypto, 'randomUUID').mockImplementation(mode === 'missing' ? undefined! : () => {throw new Error('Unavailable');});
    if (mode === 'missing') Object.defineProperty(crypto, 'randomUUID', {configurable: true, value: undefined});
    const first = fixture(1), second = fixture(1);
    expect(first.trigger.getAttribute('aria-controls')).not.toBe(second.trigger.getAttribute('aria-controls'));
    first.trigger.click(); second.trigger.click(); first.view.close(false);
    expect(first.view.isVisible).toBe(false); expect(second.view.isVisible).toBe(true);
    first.view.destroy(); expect(second.view.isVisible).toBe(true);
});
