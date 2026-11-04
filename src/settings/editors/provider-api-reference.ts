import type { SettingsRuntime } from '../runtime';
import type { ProviderApiReference, ApiSupport } from '../contracts/domain';
/** Documentation stays read-only and cannot enable unimplemented request fields. */
export function renderProviderApiReference(runtime: SettingsRuntime, reference?: ProviderApiReference): string {
    if (!reference)
        return '';
    const entry = (name: string, id: string, support: ApiSupport, notes = '') => `<li>${dependencies(runtime).escapeHTML(name)} · <code>${dependencies(runtime).escapeHTML(id)}</code> · ${dependencies(runtime).t(`provider.reference.${support}`)} ${dependencies(runtime).escapeHTML(notes)}</li>`;
    return `<details class="settings-form__group" data-provider-reference><summary>${dependencies(runtime).t('provider.reference.title')}</summary>
        <p>${dependencies(runtime).t('provider.reference.version', { version: reference.version, date: reference.reviewedAt })}</p>
        <p>${dependencies(runtime).escapeHTML(reference.scope)}</p>
        <ul>${reference.sources.filter(source => /^https:\/\//.test(source.url)).map(source => `<li><a href="${dependencies(runtime).escapeAttr(source.url)}" target="_blank" rel="noopener noreferrer">${dependencies(runtime).escapeHTML(source.title)}</a></li>`).join('')}</ul>
        <h4>${dependencies(runtime).t('provider.reference.models')}</h4><ul>${reference.models.map(model => entry(model.name, model.id, model.support, model.notes)).join('')}</ul>
        <h4>${dependencies(runtime).t('provider.reference.formats')}</h4><ul>${reference.formats.map(format => entry(format.name, format.wireValue, format.support, `${format.sampleRates.join(', ')} Hz; ${dependencies(runtime).t('provider.reference.default')}: ${format.defaultSampleRate} Hz; ${format.notes ?? ''}`)).join('')}</ul>
        <h4>${dependencies(runtime).t('provider.reference.parameters')}</h4><ul>${reference.parameters.map(parameter => entry(parameter.name, parameter.path, parameter.support, `${parameter.type}; ${dependencies(runtime).t(parameter.required ? 'provider.reference.required' : 'provider.reference.optional')}; ${parameter.default === undefined ? '' : `${dependencies(runtime).t('provider.reference.default')}: ${parameter.default}; `}${parameter.min === undefined ? '' : `[${parameter.min}, ${parameter.max}]; `}${parameter.notes ?? ''}`)).join('')}</ul>
        <details><summary>${dependencies(runtime).t('provider.reference.voices', { count: reference.voices.length })}</summary><ul>${reference.voices.map(voice => `<li>${dependencies(runtime).escapeHTML(voice.name)} · <code>${dependencies(runtime).escapeHTML(voice.id)}</code> · ${dependencies(runtime).escapeHTML(voice.languages.join(', '))} ${dependencies(runtime).escapeHTML(voice.notes ?? '')}</li>`).join('')}</ul></details>
        <p>${dependencies(runtime).escapeHTML(reference.discovery.models)}</p><p>${dependencies(runtime).escapeHTML(reference.discovery.voices)}</p>
        <ul>${reference.notes.map(note => `<li>${dependencies(runtime).escapeHTML(note)}</li>`).join('')}</ul></details>`;
}
function createDependencies(runtime: SettingsRuntime) { return { escapeAttr: runtime.presentation.escapeAttr, escapeHTML: runtime.presentation.escapeHTML, t: runtime.presentation.t }; }
export function bind(runtime: SettingsRuntime) { return { renderProviderApiReference: renderProviderApiReference.bind(null, runtime) }; }

const dependencyCache = new WeakMap<SettingsRuntime, ReturnType<typeof createDependencies>>();
function dependencies(runtime: SettingsRuntime) {
    let value = dependencyCache.get(runtime);
    if (!value) { value = createDependencies(runtime); dependencyCache.set(runtime, value); }
    return value;
}
