import type { SettingsRuntime } from '../runtime';
import type { ImageProcessingPreference } from '../contracts/domain';
export function renderAgentImageSettings(runtime: SettingsRuntime, value?: ImageProcessingPreference): string {
    const mode = value?.resize?.mode ?? 'inherit';
    return `<div class="agent-form-row agent-image-settings"><div class="agent-form-grid">
        <label class="agent-form-field"><span class="agent-form-label">${dependencies(runtime).t('agent.inputImage.title')}</span>
        <select class="agent-form-input" name="imageResizeMode" aria-label="${dependencies(runtime).t('agent.inputImage.title')}">
            <option value="inherit" ${mode === 'inherit' ? 'selected' : ''}>${dependencies(runtime).t('image.agentDefault')}</option>
            <option value="original" ${mode === 'original' ? 'selected' : ''}>${dependencies(runtime).t('image.original')}</option>
            <option value="max-edge" ${mode === 'max-edge' ? 'selected' : ''}>${dependencies(runtime).t('image.custom')}</option>
        </select></label>
        <label class="agent-form-field"><span class="agent-form-label">${dependencies(runtime).t('image.maxEdge')}</span>
        <input class="agent-form-input" name="imageMaxEdge" type="number" min="1" max="32768" step="1"
            ${mode === 'max-edge' ? '' : 'disabled'}
            aria-label="${dependencies(runtime).t('image.maxEdge')}" value="${dependencies(runtime).escapeHTML(String(value?.resize?.mode === 'max-edge' ? value.resize.maxEdge : 1024))}"></label></div>
        <p class="agent-form-help">${dependencies(runtime).t('agent.inputImage.hint')}</p></div>`;
}
export function bindAgentImageSettings(container: HTMLElement): void {
    const mode = container.querySelector<HTMLSelectElement>('[name="imageResizeMode"]');
    const edge = container.querySelector<HTMLInputElement>('[name="imageMaxEdge"]');
    mode?.addEventListener('change', () => {
        if (edge)
            edge.disabled = mode.value !== 'max-edge';
    });
}
export function readAgentImageSettings(runtime: SettingsRuntime, container: HTMLElement): ImageProcessingPreference | undefined {
    const mode = container.querySelector<HTMLSelectElement>('[name=imageResizeMode]')?.value;
    if (!mode)
        return undefined;
    if (mode === 'inherit')
        return undefined;
    const resize = mode === 'original' ? { mode: 'original' as const }
        : { mode: 'max-edge' as const, maxEdge: Number(container.querySelector<HTMLInputElement>('[name=imageMaxEdge]')?.value) };
    if (!dependencies(runtime).isImageResizePolicy(resize))
        throw new (dependencies(runtime).SettingsValidationError)(dependencies(runtime).t('image.invalid'));
    return { resize };
}
function createDependencies(runtime: SettingsRuntime) { return { escapeHTML: runtime.presentation.escapeHTML, t: runtime.presentation.t, isImageResizePolicy: runtime.rules.isImageResizePolicy, SettingsValidationError: runtime.widgets.SettingsValidationError }; }
export function bind(runtime: SettingsRuntime) { return { renderAgentImageSettings: renderAgentImageSettings.bind(null, runtime), bindAgentImageSettings: bindAgentImageSettings.bind(null), readAgentImageSettings: readAgentImageSettings.bind(null, runtime) }; }

const dependencyCache = new WeakMap<SettingsRuntime, ReturnType<typeof createDependencies>>();
function dependencies(runtime: SettingsRuntime) {
    let value = dependencyCache.get(runtime);
    if (!value) { value = createDependencies(runtime); dependencyCache.set(runtime, value); }
    return value;
}
