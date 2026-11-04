import type { SettingsRuntime } from '../runtime';
import { bind as bind0 } from './media-fields';
import type { LLMModel, LLMProvider } from '../contracts/domain';
export function renderMediaDeclaration(runtime: SettingsRuntime, value: unknown, model = false, draft?: string): string {
    return `<div data-media-declaration><label class="settings-form__label">${dependencies(runtime).t(model ? 'provider.media.operations' : 'provider.media.endpoints')}</label>
        ${dependencies(runtime).renderMediaFields(value, model)}
        <details><summary>${dependencies(runtime).t('provider.media.raw')}</summary><textarea class="settings-form__input" rows="5" name="${model ? 'modelOperations' : 'mediaEndpoints'}">${dependencies(runtime).escapeAttr(draft ?? JSON.stringify(value ?? {}, null, 2))}</textarea>
        <small class="settings-form__help">${dependencies(runtime).t('provider.media.help')}</small></details></div>`;
}
export function readMediaEndpoints(runtime: SettingsRuntime, form: HTMLFormElement, previous: LLMProvider): LLMProvider['media'] {
    const field = form.querySelector<HTMLTextAreaElement>('[name="mediaEndpoints"]');
    return field && !field.disabled ? readDeclaration(runtime, field, false) as LLMProvider['media'] ?? (previous.media ? {} : undefined) : previous.media;
}
export function readModelOperations(runtime: SettingsRuntime, row: Element, previous: LLMModel): LLMModel['operations'] {
    const field = row.querySelector<HTMLTextAreaElement>('[name="modelOperations"]');
    return field && !field.disabled ? readDeclaration(runtime, field, true) as LLMModel['operations'] ?? (previous.operations ? {} : undefined) : previous.operations;
}
function readDeclaration(runtime: SettingsRuntime, field: HTMLTextAreaElement, model: boolean): unknown {
    try {
        const value: unknown = JSON.parse(field.value || '{}');
        if (!dependencies(runtime).isMediaCatalog(model ? undefined : value, model ? value : undefined))
            throw new Error('Invalid declaration');
        field.setCustomValidity('');
        return Object.keys(value as Record<string, unknown>).length ? value : undefined;
    }
    catch {
        const message = dependencies(runtime).t('provider.media.invalid');
        field.setCustomValidity(message);
        throw new (dependencies(runtime).SettingsValidationError)(message);
    }
}
function validateDraft(runtime: SettingsRuntime, field: HTMLTextAreaElement): void {
    if (field.disabled)
        return;
    try {
        readDeclaration(runtime, field, field.name === 'modelOperations');
    }
    catch { /* Keep the invalid draft editable. */ }
}
export function syncMediaDeclarations(runtime: SettingsRuntime, form: HTMLFormElement): void {
    const disabled = form.querySelector<HTMLSelectElement>('[name="implementation"]')?.value === 'chatgpt';
    form.querySelectorAll<HTMLElement>('[data-media-declaration]').forEach(group => {
        group.hidden = disabled;
        const field = group.querySelector<HTMLTextAreaElement>('textarea')!;
        field.disabled = disabled;
        validateDraft(runtime, field);
    });
}
/** Keep invalid JSON editable while blocking automatic persistence. */
export function bindMediaDeclarations(runtime: SettingsRuntime, form: HTMLFormElement): void {
    dependencies(runtime).bindMediaFields(form);
    form.addEventListener('input', event => {
        const field = event.target;
        if (!(field instanceof HTMLTextAreaElement) || !['modelOperations', 'mediaEndpoints'].includes(field.name))
            return;
        validateDraft(runtime, field);
        if (field.validity.valid && !(event instanceof CustomEvent && event.detail?.structured)) {
            const guided = field.closest('[data-media-declaration]')?.querySelector('[data-media-fields]');
            if (guided)
                guided.outerHTML = dependencies(runtime).renderMediaFields(JSON.parse(field.value || '{}'), field.name === 'modelOperations');
        }
    });
}
function createDependencies(runtime: SettingsRuntime) { return { escapeAttr: runtime.presentation.escapeAttr, t: runtime.presentation.t, SettingsValidationError: runtime.widgets.SettingsValidationError, isMediaCatalog: runtime.rules.isMediaCatalog, bindMediaFields: bind0(runtime).bindMediaFields, renderMediaFields: bind0(runtime).renderMediaFields }; }
export function bind(runtime: SettingsRuntime) { return { renderMediaDeclaration: renderMediaDeclaration.bind(null, runtime), readMediaEndpoints: readMediaEndpoints.bind(null, runtime), readModelOperations: readModelOperations.bind(null, runtime), syncMediaDeclarations: syncMediaDeclarations.bind(null, runtime), bindMediaDeclarations: bindMediaDeclarations.bind(null, runtime) }; }

const dependencyCache = new WeakMap<SettingsRuntime, ReturnType<typeof createDependencies>>();
function dependencies(runtime: SettingsRuntime) {
    let value = dependencyCache.get(runtime);
    if (!value) { value = createDependencies(runtime); dependencyCache.set(runtime, value); }
    return value;
}
