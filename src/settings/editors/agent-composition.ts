import type { SettingsRuntime } from '../runtime';
import type { AgentDefinition } from '../contracts/domain';
export type Composition = NonNullable<AgentDefinition['composition']>;
export function renderAgentComposition(runtime: SettingsRuntime, agent: AgentDefinition, agents: AgentDefinition[]): string {
    const config = agent.composition;
    const candidates = agents.filter(item => item.id !== agent.id && !item.composition && item.execution?.kind !== 'flow');
    const selected = new Set(config?.memberAgentIds ?? []);
    for (const id of [config?.coordinatorAgentId, ...selected]) {
        if (id && !candidates.some(item => item.id === id))
            candidates.push({ id, name: dependencies(runtime).t('agent.composition.missing', { id }) } as AgentDefinition);
    }
    return `<fieldset class="agent-flow-fields__group" data-agent-composition ${config ? '' : 'hidden disabled'}>
        <label class="agent-form-field"><span class="agent-form-label">${dependencies(runtime).t('agent.composition.coordinator')}</span>
            <select class="agent-form-select" name="compositionCoordinator" required><option value="">${dependencies(runtime).t('agent.composition.chooseCoordinator')}</option>
                ${candidates.map(item => `<option value="${dependencies(runtime).escapeHTML(item.id)}" ${config?.coordinatorAgentId === item.id ? 'selected' : ''} ${item.execution?.kind === 'harness' ? 'disabled' : ''}>${dependencies(runtime).escapeHTML(item.name)}</option>`).join('')}</select></label>
        <div class="agent-capability-group"><span class="agent-form-label">${dependencies(runtime).t('agent.composition.members')}</span>
            <p class="agent-form-help">${dependencies(runtime).t('agent.composition.membersHint')}</p><div class="agent-mcp-list">
                ${candidates.map(item => `<label class="agent-mcp-item"><input type="checkbox" name="compositionMember" value="${dependencies(runtime).escapeHTML(item.id)}" ${selected.has(item.id) ? 'checked' : ''}>
                    <span class="agent-mcp-item__info"><span class="agent-mcp-item__name">${dependencies(runtime).escapeHTML(item.name)}</span><small class="agent-mcp-item__desc">${dependencies(runtime).escapeHTML(item.description ?? '')}</small></span></label>`).join('')}
                ${candidates.length ? '' : `<p class="agent-form-help">${dependencies(runtime).t('agent.composition.noAgents')}</p>`}</div></div>
        <div class="agent-form-grid"><label class="agent-form-field"><span class="agent-form-label">${dependencies(runtime).t('agent.composition.maxDelegations')}</span>
            <input class="agent-form-input" type="number" name="compositionMaxDelegations" min="1" step="1" value="${config?.maxDelegations ?? ''}" placeholder="${dependencies(runtime).t('flow.settings.runtimeDefault')}"></label>
            <label class="agent-form-field"><span class="agent-form-label">${dependencies(runtime).t('agent.composition.maxConcurrency')}</span>
            <input class="agent-form-input" type="number" name="compositionMaxConcurrency" min="1" step="1" value="${config?.maxConcurrency ?? ''}" placeholder="${dependencies(runtime).t('flow.settings.runtimeDefault')}"></label></div>
        <p class="agent-form-help" data-agent-composition-status role="status"></p>
    </fieldset>`;
}
export function readAgentComposition(runtime: SettingsRuntime, root: HTMLElement): Composition | undefined {
    if (root.querySelector<HTMLSelectElement>('[name="executionKind"]')?.value !== 'composite')
        return undefined;
    const coordinatorAgentId = root.querySelector<HTMLSelectElement>('[name="compositionCoordinator"]')?.value ?? '';
    const memberAgentIds = [...root.querySelectorAll<HTMLInputElement>('[name="compositionMember"]:checked')].map(item => item.value);
    if (!coordinatorAgentId || root.querySelector<HTMLSelectElement>('[name=compositionCoordinator]')?.selectedOptions[0]?.disabled)
        throw new (dependencies(runtime).SettingsValidationError)(dependencies(runtime).t('agent.composition.chooseCoordinator'));
    if (!memberAgentIds.length)
        throw new (dependencies(runtime).SettingsValidationError)(dependencies(runtime).t('agent.composition.membersRequired'));
    if (memberAgentIds.includes(coordinatorAgentId))
        throw new (dependencies(runtime).SettingsValidationError)(dependencies(runtime).t('agent.composition.coordinatorInMembers'));
    const result: Composition = { coordinatorAgentId, memberAgentIds };
    for (const [key, name] of [['maxDelegations', 'compositionMaxDelegations'], ['maxConcurrency', 'compositionMaxConcurrency']] as const) {
        const raw = root.querySelector<HTMLInputElement>(`[name="${name}"]`)?.value.trim();
        if (!raw)
            continue;
        const value = Number(raw);
        if (!Number.isSafeInteger(value) || value < 1)
            throw new (dependencies(runtime).SettingsValidationError)(dependencies(runtime).t('agent.composition.invalidLimit'));
        result[key] = value;
    }
    return result;
}
export function bindAgentComposition(root: HTMLElement): void {
    const select = root.querySelector<HTMLSelectElement>('[name="compositionCoordinator"]');
    const update = () => {
        for (const member of root.querySelectorAll<HTMLInputElement>('[name="compositionMember"]')) {
            const coordinator = member.value === select?.value;
            if (coordinator)
                member.checked = false;
            member.disabled = coordinator;
        }
    };
    select?.addEventListener('change', update);
    update();
}
function createDependencies(runtime: SettingsRuntime) { return { escapeHTML: runtime.presentation.escapeHTML, t: runtime.presentation.t, SettingsValidationError: runtime.widgets.SettingsValidationError }; }
export function bind(runtime: SettingsRuntime) { return { renderAgentComposition: renderAgentComposition.bind(null, runtime), readAgentComposition: readAgentComposition.bind(null, runtime), bindAgentComposition: bindAgentComposition.bind(null) }; }

const dependencyCache = new WeakMap<SettingsRuntime, ReturnType<typeof createDependencies>>();
function dependencies(runtime: SettingsRuntime) {
    let value = dependencyCache.get(runtime);
    if (!value) { value = createDependencies(runtime); dependencyCache.set(runtime, value); }
    return value;
}
