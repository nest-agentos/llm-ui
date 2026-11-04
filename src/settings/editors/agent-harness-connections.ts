import type { SettingsRuntime } from '../runtime';
import { randomUUID as randomUUID } from '../identity';
import type { HarnessExecutionConnection, HarnessExecutionConnectionRecord, HarnessExecutionConnectionTarget } from '../contracts/domain';
import type { HarnessConnectionManagement } from './agent-execution-options';
export type Choice = {
    nodeConnectionId: string;
    projectId: string;
    profileId: string;
    label: string;
};
/** Credentials and endpoints stay behind the management port. */
export async function editHarnessConnection(runtime: SettingsRuntime, port: HarnessConnectionManagement, id: string | undefined, saved: (id: string) => void, active: () => boolean = () => true): Promise<void> {
    const [record, targets] = await Promise.all([id ? port.get(id) : undefined, port.targets()]);
    if (!active())
        return;
    if (id && !record?.connection)
        throw new Error('HARNESS_CONNECTION_MISSING');
    const draft = record?.connection ?? { id: randomUUID(), name: '', kind: 'harness' as const,
        nodeConnectionId: '', projectId: '', profileId: '', enabled: true };
    const choices = targetChoices(targets);
    new (dependencies(runtime).Modal)(dependencies(runtime).t(id ? 'agent.execution.harnessEdit' : 'agent.execution.harnessCreate'), render(runtime, draft, choices), {
        confirmText: dependencies(runtime).t('action.save'), cancelText: dependencies(runtime).t('action.cancel'),
        onConfirm: element => active() ? save(runtime, port, element, draft, record, choices, saved) : true,
    }).show();
}
function targetChoices(targets: HarnessExecutionConnectionTarget[]): Choice[] {
    return targets.filter(target => target.available).flatMap(target => target.profiles.map(profile => ({
        nodeConnectionId: target.nodeConnectionId, projectId: target.projectId, profileId: profile.id,
        label: `${target.projectName} / ${profile.name || profile.id}`,
    })));
}
function render(runtime: SettingsRuntime, draft: HarnessExecutionConnection, choices: Choice[]): string {
    const current = choices.findIndex(choice => choice.nodeConnectionId === draft.nodeConnectionId
        && choice.projectId === draft.projectId && choice.profileId === draft.profileId);
    return `<label class="agent-form-field">${dependencies(runtime).t('agent.execution.harnessName')}<input class="agent-form-input" name="harnessName" value="${dependencies(runtime).escapeHTML(draft.name)}" required></label>
        <label class="agent-form-field">${dependencies(runtime).t('agent.execution.harnessTarget')}<select class="agent-form-select" name="harnessTarget" required>
        <option value="" ${current < 0 ? 'selected' : ''}>${dependencies(runtime).t('agent.execution.harnessTargetRequired')}</option>
        ${choices.map((choice, index) => `<option value="${index}" ${index === current ? 'selected' : ''}>${dependencies(runtime).escapeHTML(choice.label)}</option>`).join('')}</select></label>
        <label class="agent-form-field"><input type="checkbox" name="harnessEnabled" ${draft.enabled !== false ? 'checked' : ''}>${dependencies(runtime).t('agent.execution.harnessEnabled')}</label>
        <p class="agent-form-help">${dependencies(runtime).t('agent.execution.harnessTargetHint')}</p><p class="agent-form-help" data-harness-save-status role="alert"></p>`;
}
async function save(runtime: SettingsRuntime, port: HarnessConnectionManagement, element: HTMLElement, draft: HarnessExecutionConnection, record: HarnessExecutionConnectionRecord | undefined, choices: Choice[], saved: (id: string) => void): Promise<boolean> {
    const status = element.querySelector<HTMLElement>('[data-harness-save-status]')!;
    const name = element.querySelector<HTMLInputElement>('[name=harnessName]')!.value.trim();
    const raw = element.querySelector<HTMLSelectElement>('[name=harnessTarget]')!.value;
    const choice = raw === '' ? undefined : choices[Number(raw)];
    if (!name || !choice) {
        status.textContent = dependencies(runtime).t('agent.execution.harnessFieldsRequired');
        return false;
    }
    const operationId = randomUUID(), started = performance.now();
    try {
        await port.save({ ...draft, name, nodeConnectionId: choice.nodeConnectionId, projectId: choice.projectId,
            profileId: choice.profileId, enabled: element.querySelector<HTMLInputElement>('[name=harnessEnabled]')!.checked }, record?.revision ?? 0);
        console.info('agent.harness.connection.saved', { operation: 'harness.connection.save', operationId,
            stage: 'persist', result: 'success', connectionId: draft.id, durationMs: Math.round(performance.now() - started) });
        saved(draft.id);
        return true;
    }
    catch {
        status.textContent = dependencies(runtime).t('agent.execution.harnessSaveFailed');
        console.error('agent.harness.connection.failed', { operation: 'harness.connection.save', operationId,
            stage: 'persist', result: 'failure', code: 'HARNESS_CONNECTION_SAVE_FAILED', durationMs: Math.round(performance.now() - started) });
        return false;
    }
}
function createDependencies(runtime: SettingsRuntime) { return { escapeHTML: runtime.presentation.escapeHTML, t: runtime.presentation.t, Modal: runtime.widgets.Modal }; }
export function bind(runtime: SettingsRuntime) { return { editHarnessConnection: editHarnessConnection.bind(null, runtime) }; }

const dependencyCache = new WeakMap<SettingsRuntime, ReturnType<typeof createDependencies>>();
function dependencies(runtime: SettingsRuntime) {
    let value = dependencyCache.get(runtime);
    if (!value) { value = createDependencies(runtime); dependencyCache.set(runtime, value); }
    return value;
}
