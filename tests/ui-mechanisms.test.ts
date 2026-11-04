import {afterEach, expect, it, vi} from 'vitest';
import {DisclosureController, DOMCache, PopupPanel, TtyPanel} from '../src';
const cleanup: (() => void)[] = [];
afterEach(() => {for (const stop of cleanup.splice(0).reverse()) stop(); document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals();});
it('scopes cached identities to a retained root, even when another view owns the same ID', () => {
    const a = document.createElement('section'), b = document.createElement('section'); a.innerHTML = b.innerHTML = '<p id="same"></p>';
    const cache = new DOMCache(a), node = a.firstElementChild; expect(cache.byId('same')).toBe(node);
    b.append(node!); expect(cache.byId('same')).toBeNull(); a.innerHTML = '<p id="same"></p>'; expect(cache.byId('same')).toBe(a.firstElementChild);
    a.firstElementChild!.id = 'quoted"id'; expect(cache.byId('same')).toBeNull(); expect(cache.byId('quoted"id')).toBe(a.firstElementChild);
});
it('restores disclosure identities, batches changes and ignores retired details events', async () => {
    const root = document.createElement('section'), changed = vi.fn(), controller = new DisclosureController(root, {onChange: changed}); cleanup.push(() => controller.destroy());
    const first = document.createElement('details'), second = document.createElement('details'); root.append(first, second);
    const stop = controller.register({id: 'a', element: first}); controller.setAllCollapsed(false); expect(first.open).toBe(true);
    controller.register({id: 'a', element: second}); stop(); expect(second.open).toBe(true);
    first.open = false; first.dispatchEvent(new Event('toggle')); expect(controller.getState('a')).toBe(false);
    controller.setAllCollapsed(true); expect(second.open).toBe(false); expect(changed).toHaveBeenCalledTimes(2);
});
it('filters shared candidates, skips disabled entries and fires selection before close', () => {
    vi.stubGlobal('requestAnimationFrame', () => 1); vi.stubGlobal('cancelAnimationFrame', () => {});
    const input = document.createElement('textarea'), events: string[] = [], panel = new PopupPanel(input, {locale: 'en', groupFilterLabel: 'All'}); cleanup.push(() => panel.destroy());
    panel.show([{id: 'disabled', label: 'A', disabled: true}, {id: 'b', label: '<script>candidate</script>', group: 'Tools', searchText: 'extra'}],
        {onSelect: item => events.push(item.id), onClose: () => events.push('close')});
    expect(panel.element.querySelector('script')).toBeNull(); panel.filter('candidate extra');
    expect(panel.element.querySelectorAll('[role=option]')).toHaveLength(1);
    expect(panel.handleKeyDown(new KeyboardEvent('keydown', {key: 'Enter', isComposing: true}))).toBe(false);
    panel.handleKeyDown(new KeyboardEvent('keydown', {key: 'Enter'})); expect(events).toEqual(['b', 'close']);
});
it('keeps terminal output bounded in one text node and preserves unknown exit facts', () => {
    const root = document.createElement('div'), terminal = new TtyPanel(root, 't', '<script>unsafe</script>', undefined, {locale: 'en'}); cleanup.push(() => terminal.destroy());
    terminal.appendOutput('🙂' + 'x'.repeat(99999)); const output = root.querySelector('.llm-ui-tty-panel__output')!;
    expect(output.textContent).toHaveLength(99999); expect(output.childNodes).toHaveLength(1); expect(root.querySelector('script')).toBeNull();
    terminal.finalize(null); terminal.appendOutput('late'); terminal.finalize(0);
    expect(root.querySelector('.llm-ui-tty-panel__exit-info')!.textContent).toContain('unknown'); expect(output.textContent).not.toContain('late');
});
it('dismisses a popup before the next animation frame and ignores stopped bubbling', () => {
    vi.stubGlobal('requestAnimationFrame', () => 1);
    const anchor = document.createElement('button'), outside = document.createElement('button'); document.body.append(anchor, outside);
    const panel = new PopupPanel(anchor), closed = vi.fn(); cleanup.push(() => panel.destroy());
    panel.show([{id: 'a', label: 'A'}], {onSelect: vi.fn(), onClose: closed});
    outside.addEventListener('click', event => event.stopPropagation()); outside.click();
    expect(panel.isVisible).toBe(false); expect(closed).toHaveBeenCalledOnce();
    panel.show([{id: 'a', label: 'A'}], {onSelect: vi.fn(), onClose: closed});
    panel.element.dispatchEvent(new Event('pointerdown', {bubbles: true})); expect(panel.isVisible).toBe(true);
    outside.dispatchEvent(new Event('pointerdown', {bubbles: true})); expect(panel.isVisible).toBe(false);
    panel.destroy(); outside.click(); expect(closed).toHaveBeenCalledTimes(2);
});

it('keeps touch search opt-in and fits the popup after keyboard resize and viewport scrolling', () => {
    vi.stubGlobal('matchMedia', () => ({matches: true}));
    const viewport = Object.assign(new EventTarget(), {width: 375, height: 700, offsetTop: 0, offsetLeft: 0});
    vi.stubGlobal('visualViewport', viewport);
    const anchor = document.createElement('button'); document.body.append(anchor); anchor.focus();
    vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue({top: 600, bottom: 644, left: 300, width: 44} as DOMRect);
    const panel = new PopupPanel(anchor, {showSearch: true, minWidth: 360}); cleanup.push(() => panel.destroy());
    panel.show([{id: 'model', label: 'Model'}], {onSelect: vi.fn()});
    expect(document.activeElement).toBe(anchor);
    expect(panel.element.style.width).toBe('359px'); expect(panel.element.style.left).toBe('8px');
    viewport.height = 300; viewport.offsetTop = 100; viewport.dispatchEvent(new Event('resize'));
    expect(panel.element.style.maxHeight).toBe('284px'); expect(panel.element.style.top).toBe('392px');
    viewport.offsetTop = 140; viewport.dispatchEvent(new Event('scroll'));
    expect(panel.element.style.top).toBe('432px');
    panel.element.querySelector<HTMLInputElement>('input')!.focus();
    expect(document.activeElement).toBe(panel.element.querySelector('input'));
    panel.destroy(); const style = panel.element.style.cssText;
    viewport.height = 100; viewport.dispatchEvent(new Event('resize'));
    expect(panel.element.style.cssText).toBe(style);
});

it('still focuses popup search for desktop keyboard filtering', () => {
    vi.stubGlobal('matchMedia', () => ({matches: false}));
    const anchor = document.createElement('button'), panel = new PopupPanel(anchor, {showSearch: true});
    document.body.append(anchor); cleanup.push(() => panel.destroy());
    panel.show([{id: 'agent', label: 'Agent'}], {onSelect: vi.fn()});
    expect(document.activeElement).toBe(panel.element.querySelector('input'));
});
