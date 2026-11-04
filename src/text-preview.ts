/** A compact Markdown preview for navigation; the full source remains searchable. */
export function getPreviewText(content: string, maxLen = 60): string {
    const plain = content.replace(/[\r\n]+/g, ' ').replace(/[*#`_~[\]()]/g, '').trim();
    return plain.length > maxLen ? plain.slice(0, maxLen) + '...' : plain;
}
