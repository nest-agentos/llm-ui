import type { SettingsRuntime } from '../runtime';
import type { LLMModel } from '../contracts/domain';
// @file: llm-ui/utils/modelBadges.ts
// 模型能力 / 用途分类 badge 渲染辅助。
// Provider / Connection / Agent 三处 editor 共用，避免重复渲染逻辑。
// 图标与颜色统一来自 @nestos/common 的 MODEL_CAPABILITY_META / MODEL_CATEGORY_META。
/** 能力键 → LLMModel 字段映射（固定渲染顺序） */
const CAPABILITY_FIELDS: ReadonlyArray<[
    string,
    keyof LLMModel
]> = [
    ['vision', 'supportsVision'],
    ['thinking', 'supportsThinking'],
    ['tools', 'supportsTools'],
    ['audio', 'supportsAudio'],
    ['video', 'supportsVideo'],
    ['structuredOutput', 'supportsStructuredOutput'],
];
/** 生成单个 badge 的内联样式（颜色透明度叠加，复用 settings-badge 圆角尺寸） */
function badgeStyle(color: string): string {
    return `display:inline-flex;align-items:center;gap:2px;background:${color}20;color:${color};`
        + `border:1px solid ${color}40;font-size:11px;line-height:1;padding:2px 5px;border-radius:4px;`;
}
/** Describe declared capabilities, with a category fallback when no details are available. */
function capabilityBadges(runtime: SettingsRuntime, model: LLMModel) {
    const badges = CAPABILITY_FIELDS
        .filter(([, field]) => model[field] === true)
        .map(([cap]) => {
        const meta = dependencies(runtime).MODEL_CAPABILITY_META[cap];
        const label = dependencies(runtime).t(`model.capability.${cap}` as Parameters<SettingsRuntime['presentation']['t']>[0]);
        return { ...meta, key: cap, label };
    });
    const operations = (['image.generate', 'speech.synthesize'] as const).filter(operation => model.operations?.[operation] || model.supportedOperations?.includes(operation));
    badges.push(...operations.map(operation => {
        const meta = dependencies(runtime).MODEL_CATEGORY_META[operation === 'image.generate' ? 'image' : 'audio'];
        const label = dependencies(runtime).t(operation === 'image.generate' ? 'model.capability.imageGeneration' : 'model.capability.speechSynthesis');
        return { ...meta, key: operation, label };
    }));
    if (!badges.length && model.category && dependencies(runtime).MODEL_CATEGORY_META[model.category] && model.capabilitiesKnown !== false) {
        const meta = dependencies(runtime).MODEL_CATEGORY_META[model.category], label = dependencies(runtime).t(`model.category.${model.category}` as Parameters<SettingsRuntime['presentation']['t']>[0]);
        badges.push({ ...meta, key: `category.${model.category}`, label });
    }
    return badges;
}
/** Share the same capability descriptions between native options and HTML badges. */
export function modelCapabilityIndicators(runtime: SettingsRuntime, model: LLMModel) {
    const unique = new Map<string, {
        color: string;
        keys: Set<string>;
        labels: Set<string>;
    }>();
    for (const badge of capabilityBadges(runtime, model)) {
        const entry = unique.get(badge.icon) ?? { color: badge.color, keys: new Set<string>(), labels: new Set<string>() };
        entry.keys.add(badge.key);
        entry.labels.add(badge.label);
        unique.set(badge.icon, entry);
    }
    return [...unique].map(([icon, entry]) => ({ icon, color: entry.color, keys: [...entry.keys], label: [...entry.labels].join(' / ') }));
}
/** One visual badge can describe several capabilities that share the same icon. */
export function renderModelCapabilityBadges(runtime: SettingsRuntime, model: LLMModel): string {
    return modelCapabilityIndicators(runtime, model).map(({ icon, color, keys, label: text }) => {
        const label = dependencies(runtime).escapeAttr(text);
        return `<span class="model-cap-badge" data-capability="${dependencies(runtime).escapeAttr(keys[0])}" data-capabilities="${dependencies(runtime).escapeAttr(keys.join(' '))}" role="img" aria-label="${label}" style="${badgeStyle(color)}" title="${label}">${icon}</span>`;
    }).join('') || (model.capabilitiesKnown === true ? '' : `<span class="model-cap-badge" role="img" aria-label="${dependencies(runtime).escapeAttr(dependencies(runtime).t('model.capability.unknown'))}" title="${dependencies(runtime).escapeAttr(dependencies(runtime).t('model.capability.unknown'))}">?</span>`);
}
/**
 * 渲染模型用途分类 badge（inline HTML）。
 * category 未设置时默认渲染 'chat'。
 */
export function renderModelCategoryBadge(runtime: SettingsRuntime, model: LLMModel): string {
    const cat = model.category ?? 'chat';
    const meta = dependencies(runtime).MODEL_CATEGORY_META[cat] ?? dependencies(runtime).MODEL_CATEGORY_META.chat;
    const label = dependencies(runtime).t(`model.category.${cat}` as Parameters<SettingsRuntime['presentation']['t']>[0]);
    return `<span class="model-category-badge" style="${badgeStyle(meta.color)}" title="${label}">${meta.icon} ${label}</span>`;
}
function createDependencies(runtime: SettingsRuntime) { return { t: runtime.presentation.t, escapeAttr: runtime.presentation.escapeAttr, MODEL_CAPABILITY_META: runtime.presentation.MODEL_CAPABILITY_META, MODEL_CATEGORY_META: runtime.presentation.MODEL_CATEGORY_META }; }
export function bind(runtime: SettingsRuntime) { return { modelCapabilityIndicators: modelCapabilityIndicators.bind(null, runtime), renderModelCapabilityBadges: renderModelCapabilityBadges.bind(null, runtime), renderModelCategoryBadge: renderModelCategoryBadge.bind(null, runtime) }; }

const dependencyCache = new WeakMap<SettingsRuntime, ReturnType<typeof createDependencies>>();
function dependencies(runtime: SettingsRuntime) {
    let value = dependencyCache.get(runtime);
    if (!value) { value = createDependencies(runtime); dependencyCache.set(runtime, value); }
    return value;
}
