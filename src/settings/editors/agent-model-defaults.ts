import type { SettingsRuntime } from '../runtime';
import { randomUUID as randomUUID } from '../identity';
import type { AgentDefinition, IAgentManagementService, ModelDefaults, ModelOperation, ConnectionMeta, LLMProvider } from '../contracts/domain';
export interface Catalog {
    connections: ConnectionMeta[];
    providers: LLMProvider[];
    defaults: ModelDefaults;
}
export async function renderAgentModelDefaults(runtime: SettingsRuntime, agent: AgentDefinition, service: IAgentManagementService): Promise<string> {
    const started = performance.now(), operationId = randomUUID();
    try {
        const [connections, defaults] = await Promise.all([service.getConnections?.() ?? [], service.getModelDefaults?.() ?? {}]);
        const catalog = { connections, defaults, providers: service.getProviders?.() ?? [] };
        return `<section class="agent-section" data-agent-model-defaults>
            <button type="button" class="agent-section__header" aria-expanded="true"><span class="agent-section__icon">${dependencies(runtime).ENTITY_ICONS.llm}</span>
                <span class="agent-section__title">${dependencies(runtime).t('agent.models.title')}</span><span class="agent-section__toggle">${dependencies(runtime).FILE_BROWSER_ICONS.chevron}</span></button>
            <div class="agent-section__body"><p class="agent-form-help">${dependencies(runtime).t('agent.models.hint')}</p>
                <div class="agent-form-grid">${dependencies(runtime).MODEL_OPERATIONS.map(operation => modelRow(runtime, operation, agent.modelDefaults?.[operation], catalog)).join('')}</div>
            </div></section>`;
    }
    catch (error) {
        console.error('agent.models.read.failed', { operation: 'agent.models.read', operationId, stage: 'catalog', result: 'failure', code: 'AGENT_MODEL_CATALOG_READ_FAILED', durationMs: Math.round(performance.now() - started) });
        return `<section class="agent-section" data-agent-model-defaults><div class="agent-section__body"><p class="agent-form-help" role="alert">${dependencies(runtime).escapeHTML(dependencies(runtime).t('agent.models.loadFailed', { reason: error instanceof Error ? error.message : dependencies(runtime).t('agent.execution.unavailable') }))}</p></div></section>`;
    }
}
function modelRow(runtime: SettingsRuntime, operation: ModelOperation, selected: string | undefined, catalog: Catalog): string {
    const candidates = catalog.connections.filter(connection => dependencies(runtime).modelForOperation(connection, provider(catalog, connection), operation));
    const inherited = catalog.connections.find(item => item.id === catalog.defaults[operation]);
    const inheritedLabel = inherited ? connectionLabel(runtime, inherited, operation, catalog) : dependencies(runtime).t('agent.models.systemUnset');
    const missing = selected && !candidates.some(item => item.id === selected)
        ? `<option value="${dependencies(runtime).escapeHTML(selected)}" selected data-unavailable="true">${dependencies(runtime).escapeHTML(dependencies(runtime).t('connection.unavailable', { id: selected }))}</option>` : '';
    return `<label class="agent-form-field"><span class="agent-form-label">${dependencies(runtime).t(`modelDefaults.purpose.${operation}`)}</span>
        <select class="agent-form-select" name="agentModelDefault:${operation}" data-agent-model-operation="${operation}">
            <option value="">${dependencies(runtime).escapeHTML(dependencies(runtime).t('agent.models.inherit', { name: inheritedLabel }))}</option>${missing}
            ${candidates.map(connection => `<option value="${dependencies(runtime).escapeHTML(connection.id)}" ${connection.id === selected ? 'selected' : ''}
                ${connection.enabled === false || provider(catalog, connection)?.enabled === false ? 'disabled data-unavailable="true"' : ''}>${dependencies(runtime).escapeHTML(connectionLabel(runtime, connection, operation, catalog))}</option>`).join('')}
        </select></label>`;
}
function provider(catalog: Catalog, connection: ConnectionMeta): LLMProvider | undefined {
    return catalog.providers.find(item => item.id === connection.providerId);
}
function connectionLabel(runtime: SettingsRuntime, connection: ConnectionMeta, operation: ModelOperation, catalog: Catalog): string {
    const model = dependencies(runtime).modelForOperation(connection, provider(catalog, connection), operation);
    return [connection.name, model?.name || model?.id].filter(Boolean).join(' · ');
}
export function readAgentModelDefaults(runtime: SettingsRuntime, root: HTMLElement, previous?: ModelDefaults): ModelDefaults | undefined {
    const fields = [...root.querySelectorAll<HTMLSelectElement>('[data-agent-model-operation]')];
    if (!fields.length)
        return previous;
    const defaults: ModelDefaults = {};
    for (const field of fields) {
        const operation = field.dataset.agentModelOperation as ModelOperation;
        const unavailable = field.selectedOptions[0]?.dataset.unavailable === 'true';
        field.setCustomValidity(unavailable ? dependencies(runtime).t('agent.models.invalid', { name: dependencies(runtime).t(`modelDefaults.purpose.${operation}`) }) : '');
        if (unavailable)
            throw new (dependencies(runtime).SettingsValidationError)(field.validationMessage);
        if (field.value)
            defaults[operation] = field.value;
    }
    return Object.keys(defaults).length ? defaults : undefined;
}
export function bindAgentModelDefaults(root: HTMLElement): void {
    for (const select of root.querySelectorAll<HTMLSelectElement>('[data-agent-model-operation]')) {
        select.addEventListener('change', () => {
            if (select.selectedOptions[0]?.dataset.unavailable !== 'true')
                select.setCustomValidity('');
        });
    }
}
function createDependencies(runtime: SettingsRuntime) { return { ENTITY_ICONS: runtime.presentation.ENTITY_ICONS, FILE_BROWSER_ICONS: runtime.presentation.FILE_BROWSER_ICONS, escapeHTML: runtime.presentation.escapeHTML, t: runtime.presentation.t, MODEL_OPERATIONS: runtime.rules.MODEL_OPERATIONS, modelForOperation: runtime.rules.modelForOperation, SettingsValidationError: runtime.widgets.SettingsValidationError }; }
export function bind(runtime: SettingsRuntime) { return { renderAgentModelDefaults: renderAgentModelDefaults.bind(null, runtime), readAgentModelDefaults: readAgentModelDefaults.bind(null, runtime), bindAgentModelDefaults: bindAgentModelDefaults.bind(null) }; }

const dependencyCache = new WeakMap<SettingsRuntime, ReturnType<typeof createDependencies>>();
function dependencies(runtime: SettingsRuntime) {
    let value = dependencyCache.get(runtime);
    if (!value) { value = createDependencies(runtime); dependencyCache.set(runtime, value); }
    return value;
}
