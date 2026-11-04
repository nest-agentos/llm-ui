/** Escape text and quoted attribute values before inserting trusted UI templates. */
export function escapeHTML(value: string): string {
    return value.replace(/[&<>"']/g, character => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[character]!));
}
