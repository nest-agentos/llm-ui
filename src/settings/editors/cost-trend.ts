import type { SettingsRuntime } from '../runtime';
import type { CostRecord } from '../contracts/domain';
export type CostTrendPeriod = 'day' | 'month';
export interface Range {
    dateFrom: string;
    dateTo: string;
}
export interface Bucket {
    date: string;
    cost: number;
    tokens: number;
    requests: number;
}
/** Match the UTC dates persisted by CostStore. */
export function costTrendRange(period: CostTrendPeriod, now = new Date()): Range {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (period === 'month' ? 11 : 0), 1));
    return { dateFrom: start.toISOString().slice(0, 10), dateTo: now.toISOString().slice(0, 10) };
}
export function costTrendBuckets(records: CostRecord[], period: CostTrendPeriod, range: Range): Bucket[] {
    const buckets = new Map<string, Bucket>();
    const cursor = new Date(`${range.dateFrom}T00:00:00Z`);
    while (cursor.toISOString().slice(0, 10) <= range.dateTo) {
        const date = cursor.toISOString().slice(0, period === 'day' ? 10 : 7);
        buckets.set(date, { date, cost: 0, tokens: 0, requests: 0 });
        if (period === 'day')
            cursor.setUTCDate(cursor.getUTCDate() + 1);
        else
            cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
    for (const record of records) {
        if (record.date < range.dateFrom || record.date > range.dateTo)
            continue;
        const bucket = buckets.get(record.date.slice(0, period === 'day' ? 10 : 7));
        if (!bucket)
            continue;
        bucket.cost += record.cost;
        bucket.tokens += record.inputTokens + record.outputTokens;
        bucket.requests += record.requests;
    }
    return [...buckets.values()];
}
function chart(runtime: SettingsRuntime, buckets: Bucket[], metric: 'cost' | 'tokens'): string {
    const maximum = Math.max(0, ...buckets.map(bucket => bucket[metric]));
    const heading = dependencies(runtime).t(metric === 'cost' ? 'settings.cost.recordedCost' : 'settings.cost.tokens');
    const scale = metric === 'cost' ? `$${maximum.toFixed(4)}` : maximum.toLocaleString();
    const columns = buckets.map(bucket => {
        const value = metric === 'cost' ? `$${bucket.cost.toFixed(4)}` : bucket.tokens.toLocaleString();
        const description = `${bucket.date}: ${bucket.requests ? value : dependencies(runtime).t('settings.cost.noRecord')}`;
        const height = maximum > 0 ? bucket[metric] / maximum * 100 : 0;
        return `<div class="cost-trend__column" tabindex="0" aria-label="${dependencies(runtime).escapeHTML(description)}" title="${dependencies(runtime).escapeHTML(description)}">
            <div class="cost-trend__track"><div class="cost-trend__bar" style="height:${height.toFixed(2)}%"></div></div>
            <span>${bucket.date.slice(bucket.date.length === 7 ? 2 : 5)}</span></div>`;
    }).join('');
    return `<section class="cost-trend"><h3>${dependencies(runtime).escapeHTML(heading)} · 0 — ${scale}</h3><div class="cost-trend__columns">${columns}</div></section>`;
}
export function renderCostTrend(runtime: SettingsRuntime, records: CostRecord[], period: CostTrendPeriod, range: Range): string {
    const buckets = costTrendBuckets(records, period, range);
    if (!buckets.some(bucket => bucket.requests > 0))
        return `<p class="cost-empty">${dependencies(runtime).t('settings.cost.empty')}</p>`;
    return `<p class="cost-fold__hint">${range.dateFrom} — ${range.dateTo} · UTC</p>${chart(runtime, buckets, 'cost')}${chart(runtime, buckets, 'tokens')}`;
}
function createDependencies(runtime: SettingsRuntime) { return { escapeHTML: runtime.presentation.escapeHTML, t: runtime.presentation.t }; }
export function bind(runtime: SettingsRuntime) { return { costTrendRange: costTrendRange.bind(null), costTrendBuckets: costTrendBuckets.bind(null), renderCostTrend: renderCostTrend.bind(null, runtime) }; }

const dependencyCache = new WeakMap<SettingsRuntime, ReturnType<typeof createDependencies>>();
function dependencies(runtime: SettingsRuntime) {
    let value = dependencyCache.get(runtime);
    if (!value) { value = createDependencies(runtime); dependencyCache.set(runtime, value); }
    return value;
}
