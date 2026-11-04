import type { SettingsRuntime } from '../runtime';
import { randomUUID as generateUUID } from '../identity';
import type { SystemPromptDefinition, IAgentManagementService } from '../contracts/domain';
import type { SettingsNavigation } from '../contracts/editor';
/** The shared text is a preview; only its identity is stored in the Agent. */
export function renderPromptReference(runtime: SettingsRuntime, prompts: SystemPromptDefinition[], selected?: string): string {
    const missing = selected && !prompts.some(prompt => prompt.id === selected);
    return `<div class="agent-form-row"><label class="agent-form-label" for="system-prompt-preset">${dependencies(runtime).t('prompt.reference')}</label>
        <select class="agent-form-select" id="system-prompt-preset" name="systemPromptId">
            <option value="">${dependencies(runtime).t('prompt.none')}</option>
            ${missing ? `<option value="${dependencies(runtime).escapeHTML(selected)}" selected>${dependencies(runtime).escapeHTML(dependencies(runtime).t('prompt.missing', { id: selected }))}</option>` : ''}
            ${prompts.map(prompt => `<option value="${dependencies(runtime).escapeHTML(prompt.id)}" ${prompt.id === selected ? 'selected' : ''}>${dependencies(runtime).escapeHTML(prompt.name)}</option>`).join('')}
        </select>
        <p class="agent-form-help">${dependencies(runtime).t('prompt.referenceHint')}</p>
        <div class="agent-prompt-reference-actions" data-prompt-actions>
            <button type="button" class="settings-btn settings-btn--secondary settings-btn--sm" data-prompt-edit>${dependencies(runtime).t('prompt.editShared')}</button>
            <button type="button" class="settings-btn settings-btn--secondary settings-btn--sm" data-prompt-copy>${dependencies(runtime).t('prompt.copy')}</button>
        </div>
        <textarea class="agent-form-textarea agent-prompt-preview" data-prompt-preview readonly aria-label="${dependencies(runtime).t('prompt.reference')}"></textarea>
    </div>`;
}
export function bindPromptReference(runtime: SettingsRuntime, container: HTMLElement, prompts: SystemPromptDefinition[], service: IAgentManagementService, host: SettingsNavigation | undefined, changed: () => void): void {
    const select = container.querySelector<HTMLSelectElement>('[name="systemPromptId"]');
    if (!select)
        return;
    const preview = container.querySelector<HTMLTextAreaElement>('[data-prompt-preview]')!;
    const edit = container.querySelector<HTMLButtonElement>('[data-prompt-edit]')!;
    const copy = container.querySelector<HTMLButtonElement>('[data-prompt-copy]')!;
    const refresh = () => {
        const prompt = prompts.find(item => item.id === select.value);
        preview.hidden = !select.value;
        preview.value = prompt?.content.join('\n\n') ?? (select.value ? dependencies(runtime).t('prompt.missing', { id: select.value }) : '');
        edit.disabled = !prompt || !host?.open;
        copy.disabled = !prompt;
    };
    select.addEventListener('change', refresh);
    edit.addEventListener('click', () => {
        void Promise.resolve(host?.open('/prompts/' + encodeURIComponent(select.value)))
            .catch(error => dependencies(runtime).Toast.error(String(error)));
    });
    copy.addEventListener('click', () => {
        copy.disabled = true;
        void savePromptCopy(runtime, select, prompts, service, changed).catch(error => dependencies(runtime).Toast.error(String(error))).finally(refresh);
    });
    refresh();
}
async function savePromptCopy(runtime: SettingsRuntime, select: HTMLSelectElement, prompts: SystemPromptDefinition[], service: IAgentManagementService, changed: () => void): Promise<void> {
    const sourceId = select.value;
    const original = await service.getSystemPrompt(sourceId);
    if (!original)
        throw new Error(dependencies(runtime).t('prompt.missing', { id: sourceId }));
    const prompt = { ...structuredClone(original), id: generateUUID(), name: dependencies(runtime).t('prompt.copyName', { name: original.name }) };
    await service.saveSystemPrompt(prompt);
    prompts.push(prompt);
    select.add(new Option(prompt.name, prompt.id));
    if (select.value === sourceId) {
        select.value = prompt.id;
        changed();
    }
}
function createDependencies(runtime: SettingsRuntime) { return { escapeHTML: runtime.presentation.escapeHTML, t: runtime.presentation.t, Toast: runtime.widgets.Toast }; }
export function bind(runtime: SettingsRuntime) { return { renderPromptReference: renderPromptReference.bind(null, runtime), bindPromptReference: bindPromptReference.bind(null, runtime) }; }

const dependencyCache = new WeakMap<SettingsRuntime, ReturnType<typeof createDependencies>>();
function dependencies(runtime: SettingsRuntime) {
    let value = dependencyCache.get(runtime);
    if (!value) { value = createDependencies(runtime); dependencyCache.set(runtime, value); }
    return value;
}
