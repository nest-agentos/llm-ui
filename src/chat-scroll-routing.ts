/** Route wheel and page keys to history when the pointer/focus is over non-scrolling chat chrome. */
export function bindChatScrollRouting(root: HTMLElement, history: HTMLElement, enabled: () => boolean, pause: () => void): () => void {
    history.tabIndex = 0;
    const wheel = (event: WheelEvent) => {
        if (!enabled() || event.defaultPrevented || event.ctrlKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
        const target = event.target instanceof Element ? event.target : undefined;
        if (!target || history.contains(target) || target.closest('dialog,[role="dialog"],.llm-chat__input-menu-body')) return;
        const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? history.clientHeight : 1);
        if (!delta || nestedScroll(target, root, delta)) return;
        const previous = history.scrollTop;
        if (delta < 0 && previous <= 0 || delta > 0 && previous >= history.scrollHeight - history.clientHeight) return;
        event.preventDefault(); pause(); history.scrollTop += delta;
    };
    const key = (event: KeyboardEvent) => {
        if (!enabled() || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.isComposing || !['PageUp', 'PageDown'].includes(event.key)) return;
        const target = event.target instanceof Element ? event.target : undefined;
        if (!target || target.closest('input,textarea,select,[contenteditable="true"],dialog,[role="dialog"]')) return;
        event.preventDefault(); pause(); history.scrollTop += history.clientHeight * .9 * (event.key === 'PageUp' ? -1 : 1);
    };
    root.addEventListener('wheel', wheel, {passive: false}); root.addEventListener('keydown', key);
    return () => {root.removeEventListener('wheel', wheel); root.removeEventListener('keydown', key);};
}
function nestedScroll(target: Element, root: HTMLElement, delta: number): boolean {
    for (let current: Element | null = target; current && current !== root; current = current.parentElement) {
        if (!(current instanceof HTMLElement) || !/(auto|scroll)/.test(getComputedStyle(current).overflowY)) continue;
        if (delta < 0 && current.scrollTop > 0 || delta > 0 && current.scrollTop + current.clientHeight < current.scrollHeight) return true;
    }
    return false;
}
