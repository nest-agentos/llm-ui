/** Shared submission gesture; IME confirmation and touch Return keep editing. */
export function shouldSubmitMessage(event: KeyboardEvent): boolean {
    if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.key !== 'Enter' || event.shiftKey) return false;
    return event.ctrlKey || event.metaKey || !globalThis.matchMedia?.('(pointer: coarse)').matches;
}

/** Keep the CSS size limits authoritative across browser and WebView engines. */
export function resizeMessageInput(textarea: HTMLTextAreaElement): void {
    textarea.style.height = 'auto';
    const style = getComputedStyle(textarea), lineHeight = parseFloat(style.lineHeight) || 24;
    const minHeight = parseFloat(style.minHeight) || lineHeight * 2 + 8;
    const maxHeight = parseFloat(style.maxHeight) || 200;
    textarea.style.height = `${Math.max(minHeight, Math.min(textarea.scrollHeight, maxHeight))}px`;
}
