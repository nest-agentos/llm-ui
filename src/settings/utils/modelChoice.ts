export { modelPriceLabel } from './modelPrice';
import type { SettingsRuntime } from '../runtime';
import { bind as bind0 } from './modelBadges';
import { bind as bind1 } from './modelPrice';
import type { LLMModel, ModelPricingConfig } from '../contracts/domain';
export function modelCapabilityLabels(runtime: SettingsRuntime, model: LLMModel): string[] {
    const labels = [dependencies(runtime).t(`model.category.${model.category ?? 'chat'}`)];
    const fields = [['supportsVision', 'vision'], ['supportsThinking', 'thinking'], ['supportsTools', 'tools'],
        ['supportsAudio', 'audio'], ['supportsVideo', 'video'], ['supportsStructuredOutput', 'structuredOutput']] as const;
    for (const [field, key] of fields)
        if (model[field] === true)
            labels.push(dependencies(runtime).t(`model.capability.${key}`));
    if (model.operations?.['image.generate'] || model.supportedOperations?.includes('image.generate'))
        labels.push(dependencies(runtime).t('model.capability.imageGeneration'));
    if (model.operations?.['speech.synthesize'] || model.supportedOperations?.includes('speech.synthesize'))
        labels.push(dependencies(runtime).t('model.capability.speechSynthesis'));
    if (labels.length === 1 && model.capabilitiesKnown !== true)
        labels.push(dependencies(runtime).t('connection.modelCapabilitiesUnknown'));
    return labels;
}
export function modelChoiceLabel(runtime: SettingsRuntime, model: LLMModel, providerId: string, pricing?: ModelPricingConfig): string {
    const name = model.name && model.name !== model.id ? `${model.name} (${model.id})` : model.id;
    const indicators = dependencies(runtime).modelCapabilityIndicators(model).map(item => `${item.icon} ${item.label}`).join(' / ');
    return `${name} · ${indicators || modelCapabilityLabels(runtime, model).join(' / ')} · ${dependencies(runtime).modelPriceLabel(model, providerId, pricing)}`;
}
/** Every search term must match the model identity or an explicitly declared capability. */
export function matchesModelQuery(runtime: SettingsRuntime, model: LLMModel, query: string): boolean {
    const flags = Object.keys(model).filter(key => key.startsWith('supports') && model[key as keyof LLMModel] === true);
    const corpus = [model.id, model.name, model.category, ...flags, ...Object.keys(model.operations ?? {}),
        ...(model.supportedOperations ?? []), ...modelCapabilityLabels(runtime, model)].join(' ').toLowerCase();
    return query.toLowerCase().split(/[\s,，]+/u).filter(Boolean).every(term => corpus.includes(term));
}
function createDependencies(runtime: SettingsRuntime) { return { t: runtime.presentation.t, modelCapabilityIndicators: bind0(runtime).modelCapabilityIndicators, modelPriceLabel: bind1(runtime).modelPriceLabel }; }
export function bind(runtime: SettingsRuntime) { return { modelPriceLabel: dependencies(runtime).modelPriceLabel, modelCapabilityLabels: modelCapabilityLabels.bind(null, runtime), modelChoiceLabel: modelChoiceLabel.bind(null, runtime), matchesModelQuery: matchesModelQuery.bind(null, runtime) }; }

const dependencyCache = new WeakMap<SettingsRuntime, ReturnType<typeof createDependencies>>();
function dependencies(runtime: SettingsRuntime) {
    let value = dependencyCache.get(runtime);
    if (!value) { value = createDependencies(runtime); dependencyCache.set(runtime, value); }
    return value;
}
