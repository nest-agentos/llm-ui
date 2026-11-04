import type { SettingsRuntime } from '../runtime';
import type { LLMModel } from '../contracts/domain';
export function renderReasoningDeclaration(runtime: SettingsRuntime, model: LLMModel, draft?: string, protocolsDraft?: string): string {
    return `<details class="provider-settings__reasoning"><summary>${dependencies(runtime).t('provider.reasoning.title')}</summary>
        <small class="settings-form__help">${dependencies(runtime).t('provider.reasoning.help')}</small>
        <label class="settings-form__label">${dependencies(runtime).t('provider.reasoning.levels')}</label>
        <input class="settings-form__input" data-reasoning-levels value="${dependencies(runtime).escapeAttr(model.reasoning ? model.reasoning.efforts.map(option => option.id + (option.value && option.value !== option.id ? '=' + option.value : '')).join(', ') : '')}" placeholder="low, high, max=xhigh">
        <label class="settings-form__label">${dependencies(runtime).t('provider.reasoning.default')}</label>
        <input class="settings-form__input" data-reasoning-default value="${dependencies(runtime).escapeAttr(model.reasoning && model.reasoning.defaultEffort || '')}">
        <label class="settings-form__label">${dependencies(runtime).t('provider.reasoning.canDisable')}</label>
        <select class="settings-form__select" data-reasoning-disable><option value="">${dependencies(runtime).t('connection.reasoningDefault')}</option><option value="true" ${model.reasoning && model.reasoning.canDisable === true ? 'selected' : ''}>${dependencies(runtime).t('provider.reasoning.allowed')}</option><option value="false" ${model.reasoning && model.reasoning.canDisable === false ? 'selected' : ''}>${dependencies(runtime).t('provider.reasoning.notAllowed')}</option></select>
        <details><summary>${dependencies(runtime).t('provider.form.advanced')}</summary>
        <label class="settings-form__label">${dependencies(runtime).t('provider.reasoning.declaration')}</label>
        <textarea class="settings-form__input" name="modelReasoning" rows="5">${dependencies(runtime).escapeAttr(draft ?? JSON.stringify(model.reasoning ?? null, null, 2))}</textarea>
        <label class="settings-form__label">${dependencies(runtime).t('provider.reasoning.protocols')}</label>
        <textarea class="settings-form__input" name="modelReasoningByProtocol" rows="4">${dependencies(runtime).escapeAttr(protocolsDraft ?? JSON.stringify(model.reasoningByProtocol ?? {}, null, 2))}</textarea>
        </details></details>`;
}
export function readReasoningDeclaration(runtime: SettingsRuntime, row: Element): Pick<LLMModel, 'reasoning' | 'reasoningByProtocol'> {
    const field = row.querySelector<HTMLTextAreaElement>('[name="modelReasoning"]');
    const protocols = row.querySelector<HTMLTextAreaElement>('[name="modelReasoningByProtocol"]');
    if (!field || !protocols)
        return {};
    try {
        const reasoning = JSON.parse(field.value || 'null') ?? undefined;
        const byProtocol = JSON.parse(protocols.value || '{}');
        if (!dependencies(runtime).isReasoningCapabilities(reasoning) || !byProtocol || Array.isArray(byProtocol)
            || Object.entries(byProtocol).some(([key, caps]) => !['openai-chat', 'openai-responses', 'anthropic-messages', 'gemini-generate'].includes(key) || !dependencies(runtime).isReasoningCapabilities(caps)))
            throw new Error();
        field.setCustomValidity('');
        protocols.setCustomValidity('');
        return { reasoning, reasoningByProtocol: Object.keys(byProtocol).length ? byProtocol : undefined };
    }
    catch {
        field.setCustomValidity(dependencies(runtime).t('provider.reasoning.invalid'));
        throw new (dependencies(runtime).SettingsValidationError)(dependencies(runtime).t('provider.reasoning.invalid'));
    }
}
export function bindReasoningFields(runtime: SettingsRuntime, form: HTMLFormElement): void {
    form.addEventListener('input', event => {
        const input = event.target as HTMLInputElement, row = input.closest('.settings-model-item');
        if (!row)
            return;
        if (input.matches('[data-reasoning-levels], [data-reasoning-default], [data-reasoning-disable]'))
            updateReasoningFields(row);
        if (input.matches('[data-reasoning-levels], [data-reasoning-default], [data-reasoning-disable], [name="modelReasoning"], [name="modelReasoningByProtocol"]')) {
            try {
                const { reasoning } = readReasoningDeclaration(runtime, row);
                if (input.name === 'modelReasoning') {
                    row.querySelector<HTMLInputElement>('[data-reasoning-levels]')!.value = reasoning ? reasoning.efforts.map(option => option.id + (option.value && option.value !== option.id ? '=' + option.value : '')).join(', ') : '';
                    row.querySelector<HTMLInputElement>('[data-reasoning-default]')!.value = reasoning && reasoning.defaultEffort || '';
                    row.querySelector<HTMLSelectElement>('[data-reasoning-disable]')!.value = !reasoning || reasoning.canDisable === undefined ? '' : String(reasoning.canDisable);
                }
            }
            catch { /* Keep invalid declarations editable. */ }
        }
    });
}
function updateReasoningFields(row: Element): void {
    const field = row.querySelector<HTMLTextAreaElement>('[name="modelReasoning"]')!;
    try {
        const previous = JSON.parse(field.value || 'null') || {};
        const levels = row.querySelector<HTMLInputElement>('[data-reasoning-levels]')!.value.split(',').map(value => value.trim()).filter(Boolean);
        const efforts = levels.map(level => {
            const [id, value] = level.split('=');
            return { ...previous.efforts?.find((option: {
                    id: string;
                }) => option.id === id), id, ...(value ? { value } : {}) };
        });
        const disable = row.querySelector<HTMLSelectElement>('[data-reasoning-disable]')!.value;
        field.value = JSON.stringify(efforts.length ? { ...previous, source: 'user', efforts, canDisable: disable ? disable === 'true' : undefined,
            defaultEffort: row.querySelector<HTMLInputElement>('[data-reasoning-default]')!.value.trim() || undefined } : null, null, 2);
    }
    catch { /* Raw drafts must be corrected before structured editing. */ }
}
function createDependencies(runtime: SettingsRuntime) { return { escapeAttr: runtime.presentation.escapeAttr, t: runtime.presentation.t, isReasoningCapabilities: runtime.rules.isReasoningCapabilities, SettingsValidationError: runtime.widgets.SettingsValidationError }; }
export function bind(runtime: SettingsRuntime) { return { renderReasoningDeclaration: renderReasoningDeclaration.bind(null, runtime), readReasoningDeclaration: readReasoningDeclaration.bind(null, runtime), bindReasoningFields: bindReasoningFields.bind(null, runtime) }; }

const dependencyCache = new WeakMap<SettingsRuntime, ReturnType<typeof createDependencies>>();
function dependencies(runtime: SettingsRuntime) {
    let value = dependencyCache.get(runtime);
    if (!value) { value = createDependencies(runtime); dependencyCache.set(runtime, value); }
    return value;
}
