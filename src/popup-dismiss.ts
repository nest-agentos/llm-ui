/** Capture dismissal without consuming outside actions or closing portaled child menus. */
export function observePopupDismiss(roots: readonly HTMLElement[], close: () => void): () => void {
    const owner = roots[0].ownerDocument;
    const outside = (event: Event) => {if (!roots.some(root => ownsEvent(root, event))) close();};
    const escape = (event: KeyboardEvent) => {if (event.key === 'Escape' && !event.isComposing) close();};
    owner.addEventListener('pointerdown', outside, true);
    owner.addEventListener('click', outside, true);
    owner.addEventListener('keydown', escape, true);
    return () => {
        owner.removeEventListener('pointerdown', outside, true);
        owner.removeEventListener('click', outside, true);
        owner.removeEventListener('keydown', escape, true);
    };
}
function ownsEvent(root: HTMLElement, event: Event): boolean {
    const path = event.composedPath();
    const contains = (node: HTMLElement) => path.includes(node) || event.target instanceof Node && node.contains(event.target);
    if (contains(root)) return true;
    const controls = [root, ...root.querySelectorAll<HTMLElement>('[aria-controls]')];
    return controls.some(control => (control.getAttribute('aria-controls') ?? '').split(/\s+/u).some(id => {
        const controlled = root.ownerDocument.getElementById(id);
        return controlled !== null && contains(controlled.closest<HTMLElement>('.llm-popup') ?? controlled);
    }));
}
