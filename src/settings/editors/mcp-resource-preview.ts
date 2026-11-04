import type { SettingsRuntime } from '../runtime';
const PREVIEW_LIMIT = 100000;
export type RecordValue = Record<string, unknown>;
function record(value: unknown): value is RecordValue {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function renderMCPPreviewText(runtime: SettingsRuntime, text: string): string {
    const suffix = text.length > PREVIEW_LIMIT ? `\n${dependencies(runtime).t('mcp.previewTruncated')}` : '';
    return `<pre style="white-space:pre-wrap;overflow-wrap:anywhere">${dependencies(runtime).escapeHTML(text.slice(0, PREVIEW_LIMIT) + suffix)}</pre>`;
}
function resourceBody(runtime: SettingsRuntime, content: RecordValue, fallbackMime: string, operationId: string): string {
    if (typeof content.text !== 'string')
        return `<p>${dependencies(runtime).t('mcp.binaryResource')}</p>`;
    const text = content.text;
    const mime = (typeof content.mimeType === 'string' ? content.mimeType : fallbackMime).split(';')[0].trim().toLowerCase();
    const declaredJson = mime === 'application/json' || mime.endsWith('+json');
    if (!declaredJson && !/^[\s]*[\[{]/.test(text))
        return renderMCPPreviewText(runtime, text);
    const started = performance.now();
    try {
        return renderMCPPreviewText(runtime, JSON.stringify(JSON.parse(text), null, 2));
    }
    catch {
        if (!declaredJson)
            return renderMCPPreviewText(runtime, text);
        console.warn('mcp.resource.preview.invalid-json', { operation: 'mcp.resource.preview', operationId,
            stage: 'format', result: 'failure', code: 'INVALID_RESOURCE_JSON', durationMs: performance.now() - started });
        return `<p role="status">${dependencies(runtime).t('mcp.invalidResourceJson')}</p>${renderMCPPreviewText(runtime, text)}`;
    }
}
export function renderMCPResourcePreview(runtime: SettingsRuntime, result: unknown, fallbackMime = '', operationId = ''): string {
    const raw = renderMCPPreviewText(runtime, JSON.stringify(result, null, 2) ?? '');
    if (!record(result) || !Array.isArray(result.contents) || !result.contents.length)
        return raw;
    const contents = result.contents.map(content => {
        if (!record(content) || (typeof content.text !== 'string' && typeof content.blob !== 'string')) {
            return renderMCPPreviewText(runtime, JSON.stringify(content, null, 2) ?? '');
        }
        const uri = typeof content.uri === 'string' ? content.uri : '';
        const mime = typeof content.mimeType === 'string' ? content.mimeType : fallbackMime;
        return `<section><strong>${dependencies(runtime).escapeHTML(uri)}</strong><p>${dependencies(runtime).escapeHTML(mime)}</p>${resourceBody(runtime, content, fallbackMime, operationId)}</section>`;
    }).join('');
    return `<div style="max-height:60vh;overflow:auto">${contents}<details><summary>${dependencies(runtime).t('mcp.rawResponse')}</summary>${raw}</details></div>`;
}
function createDependencies(runtime: SettingsRuntime) { return { escapeHTML: runtime.presentation.escapeHTML, t: runtime.presentation.t }; }
export function bind(runtime: SettingsRuntime) { return { renderMCPPreviewText: renderMCPPreviewText.bind(null, runtime), renderMCPResourcePreview: renderMCPResourcePreview.bind(null, runtime) }; }

const dependencyCache = new WeakMap<SettingsRuntime, ReturnType<typeof createDependencies>>();
function dependencies(runtime: SettingsRuntime) {
    let value = dependencyCache.get(runtime);
    if (!value) { value = createDependencies(runtime); dependencyCache.set(runtime, value); }
    return value;
}
