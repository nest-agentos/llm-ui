import type { SettingsRuntime } from '../runtime';
import { renderParameterFields } from '../../parameter-form';
import { readParameterFields } from '../../parameter-form';
import type { FormParameter, ParameterFormOptions } from '../../parameter-form';
import type { AgentFlowConnection, AgentFlowDefinition } from './agent-execution-options';
export interface AgentFlowFieldDefaults {
    parameters?: Record<string, unknown>;
    connectionBindings?: Record<string, string>;
}
const encoded = (runtime: SettingsRuntime, value: unknown) => dependencies(runtime).escapeHTML(JSON.stringify(value));
export function renderAgentFlowFields(runtime: SettingsRuntime, definition: AgentFlowDefinition, defaults: AgentFlowFieldDefaults, connections: Array<{
    id: string;
    name: string;
}>): string {
    const parameters = definition.parameters ?? [], slots = connectionParameters(runtime, definition.connections ?? [], connections);
    const parameterFields = renderParameterFields(parameters, fieldOptions(runtime, defaults.parameters, 'agentFlowParameter:'));
    const bindingFields = renderParameterFields(slots, {
        ...fieldOptions(runtime, defaults.connectionBindings, 'agentFlowConnection:'),
        optionLabel: value => connections.find(connection => connection.id === value)?.name ?? dependencies(runtime).t('connection.unavailable', { id: String(value) }),
    });
    return `<div data-agent-flow-fields-editor data-flow-field-defaults="${encoded(runtime, defaults)}" data-flow-field-definition="${encoded(runtime, { parameters, slots })}">
        ${renderGroup(runtime, 'parameters', parameterFields)}${renderGroup(runtime, 'connections', bindingFields)}
    </div>`;
}
function renderGroup(runtime: SettingsRuntime, kind: 'parameters' | 'connections', fields: string): string {
    const marker = kind === 'parameters' ? 'data-agent-flow-parameters' : 'data-agent-flow-bindings';
    return `<fieldset class="agent-flow-fields__group"><legend>${dependencies(runtime).t(`agent.execution.fields.${kind}`)}</legend>
        <p class="agent-form-help">${dependencies(runtime).t(`agent.execution.fields.${kind}Help`)}</p>
        <div class="agent-form-grid" ${marker}>${fields || `<p class="agent-form-help">${dependencies(runtime).t(`agent.execution.fields.${kind}Empty`)}</p>`}</div>
    </fieldset>`;
}
function fieldOptions(runtime: SettingsRuntime, values?: Record<string, unknown>, namePrefix?: string): ParameterFormOptions {
    return {
        mode: 'defaults', values, namePrefix,
        classes: { field: 'agent-form-row', label: 'agent-form-label', help: 'agent-form-help',
            input: 'agent-form-input', select: 'agent-form-select', textarea: 'agent-form-textarea', wide: 'agent-form-row--wide' },
        labels: { inherit: dependencies(runtime).t('agent.execution.fields.inherit'), on: dependencies(runtime).t('agent.execution.fields.on'), off: dependencies(runtime).t('agent.execution.fields.off'),
            required: dependencies(runtime).t('agent.execution.fields.requiredAtRun'), unavailableOption: dependencies(runtime).t('agent.execution.fields.unavailableOption'),
            defaultValue: value => dependencies(runtime).t('agent.execution.fields.flowDefault', { value }) },
        error: fieldError.bind(null, runtime),
    };
}
function fieldError(runtime: SettingsRuntime, kind: Parameters<NonNullable<ParameterFormOptions['error']>>[0], parameter: FormParameter): string {
    const name = parameter.label?.trim() || parameter.name;
    if (kind === 'json')
        return dependencies(runtime).t('agent.execution.fields.invalidJson', { name });
    if (kind === 'number')
        return dependencies(runtime).t('agent.execution.fields.invalidNumber', { name });
    if (kind !== 'range')
        return dependencies(runtime).t('agent.execution.fields.invalidValue', { name });
    const constraints = [parameter.integer ? dependencies(runtime).t('agent.execution.fields.integer') : undefined,
        parameter.minimum !== undefined ? dependencies(runtime).t('agent.execution.fields.minimum', { value: parameter.minimum }) : undefined,
        parameter.maximum !== undefined ? dependencies(runtime).t('agent.execution.fields.maximum', { value: parameter.maximum }) : undefined,
    ].filter(Boolean).join(' · ');
    return dependencies(runtime).t('agent.execution.fields.invalidRange', { name, constraints });
}
function connectionParameters(runtime: SettingsRuntime, slots: AgentFlowConnection[], connections: Array<{
    id: string;
    name: string;
}>): FormParameter[] {
    return slots.map(slot => ({
        name: slot.name, type: 'string', widget: 'select', required: slot.required !== false,
        description: [slot.description, slot.connectionId ? dependencies(runtime).t('agent.execution.fields.inheritConnection', {
                name: connections.find(connection => connection.id === slot.connectionId)?.name ?? slot.connectionId,
            }) : undefined].filter(Boolean).join(' · '),
        options: connections.map(connection => connection.id),
    }));
}
export function readAgentFlowFields(runtime: SettingsRuntime, root: HTMLElement): Required<AgentFlowFieldDefaults> {
    const editor = root.matches('[data-agent-flow-fields-editor]') ? root : root.querySelector<HTMLElement>('[data-agent-flow-fields-editor]');
    if (!editor)
        return { parameters: {}, connectionBindings: {} };
    const original = JSON.parse(editor.dataset.flowFieldDefaults ?? '{}') as AgentFlowFieldDefaults;
    const definitions = JSON.parse(editor.dataset.flowFieldDefinition!) as {
        parameters: FormParameter[];
        slots: FormParameter[];
    };
    try {
        const parameters = readParameterFields(editor.querySelector('[data-agent-flow-parameters]')!, definitions.parameters, fieldOptions(runtime));
        const bindings = readParameterFields(editor.querySelector('[data-agent-flow-bindings]')!, definitions.slots, fieldOptions(runtime));
        return { parameters: mergeFields(original.parameters, parameters, definitions.parameters),
            connectionBindings: mergeFields(original.connectionBindings, bindings, definitions.slots) as Record<string, string> };
    }
    catch (error) {
        throw new (dependencies(runtime).SettingsValidationError)(error instanceof Error ? error.message : dependencies(runtime).t('agent.execution.fields.invalidValue', { name: '' }));
    }
}
function mergeFields(original: Record<string, unknown> = {}, values: Record<string, unknown>, parameters: FormParameter[]): Record<string, unknown> {
    const result = Object.assign(Object.create(null), original) as Record<string, unknown>;
    parameters.forEach(parameter => { delete result[parameter.name]; });
    return Object.assign(result, values);
}
function createDependencies(runtime: SettingsRuntime) { return { escapeHTML: runtime.presentation.escapeHTML, t: runtime.presentation.t, SettingsValidationError: runtime.widgets.SettingsValidationError }; }
export function bind(runtime: SettingsRuntime) { return { renderAgentFlowFields: renderAgentFlowFields.bind(null, runtime), readAgentFlowFields: readAgentFlowFields.bind(null, runtime) }; }

const dependencyCache = new WeakMap<SettingsRuntime, ReturnType<typeof createDependencies>>();
function dependencies(runtime: SettingsRuntime) {
    let value = dependencyCache.get(runtime);
    if (!value) { value = createDependencies(runtime); dependencyCache.set(runtime, value); }
    return value;
}
