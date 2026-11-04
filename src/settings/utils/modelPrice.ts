import type { SettingsRuntime } from '../runtime';
import type { LLMModel, ModelPricingConfig, ModelReferencePrice } from '../contracts/domain';
function priceRange(values: Array<number | undefined>, currency: string): string | undefined {
    const known = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0);
    if (!known.length)
        return;
    const min = Math.min(...known), max = Math.max(...known), sign = currency === 'CNY' ? '¥' : '$';
    return min === max ? `${sign}${min}` : `${sign}${min}–${sign}${max}`;
}
function referenceLabel(runtime: SettingsRuntime, reference: ModelReferencePrice): string {
    const today = new Date().toISOString().slice(0, 10);
    const rates = reference.rates.filter(rate => !rate.conditions?.validUntil || rate.conditions.validUntil >= today);
    const input = priceRange(rates.map(rate => rate.input), reference.currency), output = priceRange(rates.map(rate => rate.output), reference.currency);
    if (!input && !output)
        return dependencies(runtime).t('connection.modelPriceUnverified');
    const unit = reference.unit === 'million-tokens' ? dependencies(runtime).t(`connection.priceUnit.million-${reference.tokenModality ?? 'text'}-tokens`)
        : dependencies(runtime).t(`connection.priceUnit.${reference.unit}`), currency = reference.currency;
    const price = input && output ? dependencies(runtime).t('connection.modelPriceQuote', { input, output, unit, currency })
        : input ? dependencies(runtime).t('connection.modelPriceInput', { input, unit, currency }) : dependencies(runtime).t('connection.modelPriceOutput', { output: output!, unit, currency });
    return dependencies(runtime).t('connection.modelReferencePrice', { price });
}
export function modelPriceLabel(runtime: SettingsRuntime, model: LLMModel, providerId: string, pricing?: ModelPricingConfig): string {
    const provider = dependencies(runtime).getProviderPriceCatalog(pricing?.reference_catalog, providerId);
    if (provider?.status === 'account')
        return dependencies(runtime).t('connection.modelPriceAccount');
    if (provider?.status === 'subscription')
        return dependencies(runtime).t('connection.modelPriceSubscription');
    const reference = dependencies(runtime).resolveModelReferencePrice(pricing?.reference_catalog, providerId, model.id);
    if (reference?.status === 'variable')
        return dependencies(runtime).t('connection.modelPriceVariable');
    if (reference)
        return referenceLabel(runtime, reference);
    if (provider?.status === 'published')
        return dependencies(runtime).t('connection.modelPriceUnverified');
    const quote = pricing && dependencies(runtime).resolvePricingEntry(pricing, providerId, model.id);
    if (quote && quote.basis !== 'model')
        return dependencies(runtime).t('connection.modelPriceUnknown');
    const exact = quote?.entry.price;
    const input = exact?.[0] ?? model.inputPricePerMillion, output = exact?.[1] ?? model.outputPricePerMillion;
    if (input === undefined && output === undefined)
        return dependencies(runtime).t('connection.modelPriceUnknown');
    const price = dependencies(runtime).t('connection.modelPrice', { input: priceRange([input], 'USD') ?? dependencies(runtime).t('connection.modelPriceUnknown'),
        output: priceRange([output], 'USD') ?? dependencies(runtime).t('connection.modelPriceUnknown') });
    return dependencies(runtime).t('connection.modelConfiguredPrice', { price });
}
export function modelPriceSource(runtime: SettingsRuntime, providerId: string, pricing?: ModelPricingConfig, modelId?: string): {
    url: string;
    reviewedAt: string;
} | undefined {
    const provider = dependencies(runtime).getProviderPriceCatalog(pricing?.reference_catalog, providerId);
    const reference = modelId && dependencies(runtime).resolveModelReferencePrice(pricing?.reference_catalog, providerId, modelId);
    const sourceUrl = reference && reference.sourceUrl || provider?.sourceUrl;
    if (!sourceUrl || !provider)
        return;
    try {
        const url = new URL(sourceUrl);
        if (url.protocol === 'https:' || url.protocol === 'http:')
            return { url: url.href, reviewedAt: provider.reviewedAt };
    }
    catch { /* Invalid catalog links must not become executable markup. */ }
}
function createDependencies(runtime: SettingsRuntime) { return { getProviderPriceCatalog: runtime.rules.getProviderPriceCatalog, resolveModelReferencePrice: runtime.rules.resolveModelReferencePrice, resolvePricingEntry: runtime.rules.resolvePricingEntry, t: runtime.presentation.t }; }
export function bind(runtime: SettingsRuntime) { return { modelPriceLabel: modelPriceLabel.bind(null, runtime), modelPriceSource: modelPriceSource.bind(null, runtime) }; }

const dependencyCache = new WeakMap<SettingsRuntime, ReturnType<typeof createDependencies>>();
function dependencies(runtime: SettingsRuntime) {
    let value = dependencyCache.get(runtime);
    if (!value) { value = createDependencies(runtime); dependencyCache.set(runtime, value); }
    return value;
}
