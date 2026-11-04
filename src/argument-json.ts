import type {JsonValue} from './contracts';

export function parseArgumentJson(text: string): Record<string, JsonValue> {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value) || !finiteJson(value)) throw new Error('Invalid JSON object');
    return value as Record<string, JsonValue>;
}
function finiteJson(value: unknown, depth = 0): boolean {
    if (depth > 64) return false;
    if (typeof value === 'number') return Number.isFinite(value);
    if (!value || typeof value !== 'object') return true;
    return Object.values(value).every(child => finiteJson(child, depth + 1));
}
