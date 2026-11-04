import type { SettingsRuntime } from '../runtime';
import { shortUUID as generateShortUUID } from '../identity';
import { randomUUID as randomUUID } from '../identity';
import { bind as bind2 } from './mcp-resource-preview';
import type { MCPDiscovery, MCPServer, IAgentManagementService } from '../contracts/domain';
export function renderMCPPrompts(runtime: SettingsRuntime, server: MCPServer): string {
    return `<div class="settings-section"><h3 class="settings-section__title">Prompts</h3>${((server.prompts ?? []) as MCPDiscovery['prompts']).map((prompt, index) => `
        <div class="settings-card"><strong>${dependencies(runtime).escapeHTML(prompt.name)}</strong><p>${dependencies(runtime).escapeHTML(prompt.description)}</p>
        <button class="settings-btn" data-action="preview-prompt" data-index="${index}">${dependencies(runtime).t('mcp.preview')}</button></div>`).join('')}</div>`;
}
export function bindMCPContent(runtime: SettingsRuntime, container: HTMLElement, server: MCPServer, service: IAgentManagementService): void {
    container.querySelectorAll<HTMLButtonElement>('[data-action="preview-resource"], [data-action="preview-prompt"]').forEach(button => {
        button.addEventListener('click', async () => {
            const index = Number(button.dataset.index);
            if (button.dataset.action === 'preview-prompt') {
                const prompt = (server.prompts as MCPDiscovery['prompts'])?.[index];
                if (prompt)
                    previewPrompt(runtime, server.id, prompt, service);
                return;
            }
            const resource = (server.resources as MCPDiscovery['resources'])?.[index];
            if (!resource)
                return;
            button.disabled = true;
            try {
                await previewResource(runtime, server.id, resource, service);
            }
            finally {
                button.disabled = false;
            }
        });
    });
}
async function previewResource(runtime: SettingsRuntime, server: string, resource: MCPDiscovery['resources'][number], service: IAgentManagementService): Promise<void> {
    const operationId = randomUUID(), started = performance.now();
    let stage = 'read';
    try {
        const result = await service.readMCPResource(server, resource.uri);
        stage = 'render';
        new (dependencies(runtime).Modal)(dependencies(runtime).t('mcp.preview'), dependencies(runtime).renderMCPResourcePreview(result, resource.mimeType, operationId), { width: '800px' }).show();
        console.info('mcp.resource.preview.completed', { operation: 'mcp.resource.preview', operationId,
            stage, result: 'success', durationMs: performance.now() - started });
    }
    catch (error) {
        console.error('mcp.resource.preview.failed', { operation: 'mcp.resource.preview', operationId,
            stage, result: 'failure', code: stage === 'read' ? 'RESOURCE_READ_FAILED' : 'RESOURCE_RENDER_FAILED',
            durationMs: performance.now() - started });
        dependencies(runtime).Toast.error((error as Error).message);
    }
}
function previewPrompt(runtime: SettingsRuntime, server: string, prompt: MCPDiscovery['prompts'][number], service: IAgentManagementService): void {
    const id = `mcp-prompt-${generateShortUUID()}`;
    const fields = prompt.arguments ?? [];
    const body = `<div id="${id}">${fields.map((arg, index) => `<label>${dependencies(runtime).escapeHTML(arg.name)}${arg.required ? ' *' : ''}
        <input class="settings-input" data-argument="${index}" placeholder="${dependencies(runtime).escapeHTML(arg.description)}"></label>`).join('')}</div>`;
    new (dependencies(runtime).Modal)(dependencies(runtime).escapeHTML(prompt.name), body, { onConfirm: async () => {
            const args: Record<string, string> = Object.create(null);
            for (const [index, arg] of fields.entries()) {
                const value = document.querySelector<HTMLInputElement>(`#${id} [data-argument="${index}"]`)!.value;
                if (arg.required && !value) {
                    dependencies(runtime).Toast.error(dependencies(runtime).t('mcp.argumentRequired', { name: arg.name }));
                    return false;
                }
                if (value)
                    args[arg.name] = value;
            }
            try {
                showResult(runtime, await service.getMCPPrompt(server, prompt.name, args));
            }
            catch (error) {
                dependencies(runtime).Toast.error((error as Error).message);
                return false;
            }
        } }).show();
}
function showResult(runtime: SettingsRuntime, result: unknown): void {
    const text = JSON.stringify(result, null, 2);
    new (dependencies(runtime).Modal)(dependencies(runtime).t('mcp.preview'), `<pre style="white-space:pre-wrap;max-height:60vh;overflow:auto">${dependencies(runtime).escapeHTML(text.slice(0, 100000))}${text.length > 100000 ? '\n[truncated]' : ''}</pre>`, { width: '800px' }).show();
}
export function parseMCPStringMap(runtime: SettingsRuntime, value: string): Record<string, string> | undefined {
    if (!value.trim())
        return undefined;
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.values(parsed).some(value => typeof value !== 'string'))
        throw new Error(dependencies(runtime).t('mcp.invalidMap'));
    return parsed as Record<string, string>;
}
function createDependencies(runtime: SettingsRuntime) { return { escapeHTML: runtime.presentation.escapeHTML, t: runtime.presentation.t, Modal: runtime.widgets.Modal, Toast: runtime.widgets.Toast, renderMCPResourcePreview: bind2(runtime).renderMCPResourcePreview }; }
export function bind(runtime: SettingsRuntime) { return { renderMCPPrompts: renderMCPPrompts.bind(null, runtime), bindMCPContent: bindMCPContent.bind(null, runtime), parseMCPStringMap: parseMCPStringMap.bind(null, runtime) }; }

const dependencyCache = new WeakMap<SettingsRuntime, ReturnType<typeof createDependencies>>();
function dependencies(runtime: SettingsRuntime) {
    let value = dependencyCache.get(runtime);
    if (!value) { value = createDependencies(runtime); dependencyCache.set(runtime, value); }
    return value;
}
