import type { SettingsRuntime } from '../runtime';
import { bind as bind0 } from './provider-media-form';
import type { ApiProtocol, LLMProvider } from '../contracts/domain';
export const PROTOCOL_LABELS: Record<ApiProtocol, string> = {
    'openai-chat': 'OpenAI Chat Completions', 'openai-responses': 'OpenAI Responses',
    'anthropic-messages': 'Anthropic Messages', 'gemini-generate': 'Gemini Generate',
};
const PATH_FIELDS: Record<ApiProtocol, string> = {
    'openai-chat': 'chatPath', 'openai-responses': 'responsesPath',
    'anthropic-messages': 'anthropicPath', 'gemini-generate': 'geminiPath',
};
const DEFAULT_PATHS: Record<ApiProtocol, string> = {
    'openai-chat': '/v1/chat/completions', 'openai-responses': '/responses',
    'anthropic-messages': '/v1/messages', 'gemini-generate': '/v1beta/models',
};
export function renderProtocolOptions(runtime: SettingsRuntime, provider: LLMProvider, selected = ''): string {
    const supported = dependencies(runtime).getProviderProtocols(provider);
    const automatic = `<option value="">${dependencies(runtime).t('provider.protocol.automatic', { protocol: PROTOCOL_LABELS[dependencies(runtime).getProviderDefaultProtocol(provider)] })}</option>`;
    const legacy = selected && !supported.includes(selected as ApiProtocol)
        ? `<option value="${dependencies(runtime).escapeAttr(selected)}" selected disabled>${dependencies(runtime).escapeAttr(selected)} — ${dependencies(runtime).t('provider.protocol.unavailable')}</option>` : '';
    return automatic + legacy + supported.map(protocol => `<option value="${protocol}" ${selected === protocol ? 'selected' : ''}>${PROTOCOL_LABELS[protocol]}</option>`).join('');
}
function renderProtocolRow(runtime: SettingsRuntime, provider: LLMProvider, protocol: ApiProtocol): string {
    const field = PATH_FIELDS[protocol];
    const enabled = dependencies(runtime).getProviderProtocols(provider).includes(protocol);
    const value = provider[field as keyof LLMProvider]
        ?? (protocol === dependencies(runtime).getPrimaryProtocol(provider) ? provider.defaultPath : '') ?? '';
    return `<div data-protocol="${protocol}" ${enabled ? '' : 'hidden'}>
        <label><input type="checkbox" name="supportedProtocols" value="${protocol}" ${enabled ? 'checked' : ''}>${PROTOCOL_LABELS[protocol]}</label>
        <input class="settings-form__input" name="${field}" value="${dependencies(runtime).escapeAttr(String(value))}" placeholder="${DEFAULT_PATHS[protocol]}">
        <button type="button" class="settings-btn settings-btn--xs" data-test-protocol="${protocol}">${dependencies(runtime).t('provider.protocol.test')}</button>
        <small data-protocol-result="${protocol}">${dependencies(runtime).t('provider.protocol.unverified')}</small>
    </div>`;
}
export function renderProviderAdvanced(runtime: SettingsRuntime, provider: LLMProvider): string {
    const protocols = dependencies(runtime).getProviderProtocols(provider);
    const text = provider.models.some(model => (model.category ?? 'chat') === 'chat');
    return `<details class="settings-form__group" data-provider-advanced><summary>${dependencies(runtime).t('provider.form.advanced')}</summary>
        <div data-provider-chat-settings ${text ? '' : 'hidden'}><label class="settings-form__label">${dependencies(runtime).t('provider.protocol.default')}</label>
        <select class="settings-form__select" name="defaultProtocol">${protocols.map(protocol => `<option value="${protocol}" ${dependencies(runtime).getProviderDefaultProtocol(provider) === protocol ? 'selected' : ''}>${PROTOCOL_LABELS[protocol]}</option>`).join('')}</select>
        <label class="settings-form__label">${dependencies(runtime).t('provider.protocol.available')}</label>
        <div id="provider-protocols">${dependencies(runtime).API_PROTOCOLS.map(protocol => renderProtocolRow(runtime, provider, protocol)).join('')}</div>
        <select class="settings-form__select" id="provider-add-protocol"><option value="">${dependencies(runtime).t('provider.protocol.add')}</option>${dependencies(runtime).API_PROTOCOLS.map(protocol => `<option value="${protocol}" ${protocols.includes(protocol) ? 'hidden' : ''}>${PROTOCOL_LABELS[protocol]}</option>`).join('')}</select>
        <label class="settings-form__label">${dependencies(runtime).t('provider.form.temperature')}</label>
        <input type="number" class="settings-form__input" name="defaultTemperature" value="${provider.defaultTemperature ?? ''}" min="0" max="2" step="0.1">
        </div><label class="settings-form__label">${dependencies(runtime).t('provider.models.endpoint')}</label>
        <input class="settings-form__input" name="modelsPath" value="${dependencies(runtime).escapeAttr(provider.modelsPath || '')}" placeholder="${dependencies(runtime).t(provider.modelsPath === false ? 'provider.models.unavailable' : 'provider.models.endpointDefault')}">
        ${dependencies(runtime).renderMediaDeclaration(provider.media)}
    </details>`;
}
export function readProviderForm(runtime: SettingsRuntime, form: HTMLFormElement, previous: LLMProvider): LLMProvider {
    const data = Object.fromEntries(new FormData(form)) as Record<string, string>;
    const supportedProtocols = [...form.querySelectorAll<HTMLInputElement>('[name="supportedProtocols"]:checked')]
        .map(input => input.value as ApiProtocol);
    const implementation = (data.implementation || previous.implementation) as LLMProvider['implementation'];
    if (implementation === 'chatgpt')
        return { ...previous, implementation, baseURL: 'https://api.openai.com/v1', apiKey: undefined,
            supportedProtocols: ['openai-responses'], defaultProtocol: 'openai-responses', defaultPath: '/responses',
            responsesPath: '/responses', chatPath: undefined, anthropicPath: undefined, geminiPath: undefined, modelsPath: undefined };
    const paths = Object.fromEntries(Object.values(PATH_FIELDS).map(field => [field, data[field]?.trim() || undefined]));
    const primary = dependencies(runtime).getPrimaryProtocol({ implementation });
    return { ...previous, ...paths, implementation, baseURL: data.baseURL.trim(),
        apiKey: data.apiKey.trim() || previous.apiKey, connectionTestModel: data.connectionTestModel || previous.connectionTestModel, supportedProtocols,
        defaultProtocol: form.querySelector<HTMLSelectElement>('[name="defaultProtocol"]')?.value as ApiProtocol,
        defaultPath: paths[PATH_FIELDS[primary]], modelsPath: data.modelsPath?.trim() || (previous.modelsPath === false ? false : undefined) };
}
export function syncProtocolControls(form: HTMLFormElement): void {
    const checked = [...form.querySelectorAll<HTMLInputElement>('[name="supportedProtocols"]:checked')].map(input => input.value as ApiProtocol);
    const select = form.querySelector<HTMLSelectElement>('[name="defaultProtocol"]')!;
    const previous = select.value;
    select.innerHTML = checked.map(protocol => `<option value="${protocol}">${PROTOCOL_LABELS[protocol]}</option>`).join('');
    if (checked.includes(previous as ApiProtocol))
        select.value = previous;
    form.querySelectorAll<HTMLElement>('[data-protocol]').forEach(row => {
        row.hidden = !checked.includes(row.dataset.protocol as ApiProtocol);
    });
    form.querySelectorAll<HTMLOptionElement>('#provider-add-protocol option').forEach(option => {
        option.hidden = checked.includes(option.value as ApiProtocol);
    });
}
function createDependencies(runtime: SettingsRuntime) { return { renderMediaDeclaration: bind0(runtime).renderMediaDeclaration, escapeAttr: runtime.presentation.escapeAttr, t: runtime.presentation.t, API_PROTOCOLS: runtime.rules.API_PROTOCOLS, getPrimaryProtocol: runtime.rules.getPrimaryProtocol, getProviderProtocols: runtime.rules.getProviderProtocols, getProviderDefaultProtocol: runtime.rules.getProviderDefaultProtocol }; }
export function bind(runtime: SettingsRuntime) { return { PROTOCOL_LABELS, renderProtocolOptions: renderProtocolOptions.bind(null, runtime), renderProviderAdvanced: renderProviderAdvanced.bind(null, runtime), readProviderForm: readProviderForm.bind(null, runtime), syncProtocolControls: syncProtocolControls.bind(null) }; }

const dependencyCache = new WeakMap<SettingsRuntime, ReturnType<typeof createDependencies>>();
function dependencies(runtime: SettingsRuntime) {
    let value = dependencyCache.get(runtime);
    if (!value) { value = createDependencies(runtime); dependencyCache.set(runtime, value); }
    return value;
}
