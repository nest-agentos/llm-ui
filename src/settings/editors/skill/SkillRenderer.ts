import type { SettingsRuntime } from '../../runtime';
import type { LLMSkill, SkillType, MCPServer } from '../../contracts/domain';
// @file llm-ui/editors/skill/SkillRenderer.ts
// Rendering helpers for SkillSettingsEditor — extracted for independent UI iteration.
// Frequently modified: each new field or type changes the rendered template.
const escapeSupportValue = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// ─── Badge helpers (top-level, shared) ────────────────────────────────────
export function typeBadge(runtime: SettingsRuntime, type: SkillType) {
    const m = dependencies(runtime).SKILL_TYPE_META[type] ?? dependencies(runtime).SKILL_TYPE_META.custom;
    const label = dependencies(runtime).t(`skillType.${type}` as Parameters<SettingsRuntime['presentation']['t']>[0]);
    return `<span class="settings-badge" style="background:${m.color}15;color:${m.color};
                border:1px solid ${m.color}30;font-size:.75rem">
                ${m.icon} ${label}
            </span>`;
}
export function enabledBadge(runtime: SettingsRuntime, enabled: boolean) {
    return enabled
        ? `<span class="settings-badge settings-badge--success">${dependencies(runtime).t('status.enabled')}</span>`
        : `<span class="settings-badge" style="color:var(--st-text-tertiary)">${dependencies(runtime).t('status.disabled')}</span>`;
}
// ─── Render helpers ───────────────────────────────────────────────────────
export function renderEmptyList(runtime: SettingsRuntime): string {
    return `
        <div class="settings-empty settings-empty--mini">
            <div class="settings-empty__icon" style="font-size:2rem">${dependencies(runtime).ENTITY_ICONS.skill}</div>
            <p style="margin:.5rem 0">${dependencies(runtime).t('skill.empty.text')}</p>
            <div style="display:flex;gap:.5rem;flex-wrap:wrap;justify-content:center">
                <button class="settings-btn settings-btn--primary settings-btn--sm" data-action="add">
                    <i class="fas fa-plus"></i> ${dependencies(runtime).t('skill.empty.action')}
                </button>
                <button class="settings-btn settings-btn--secondary settings-btn--sm" data-action="import">
                    <i class="fas fa-folder-open"></i> ${dependencies(runtime).t('skill.import.fileLabel')}
                </button>
            </div>
        </div>`;
}
export function renderListItem(runtime: SettingsRuntime, skill: LLMSkill, selectedId: string | null, checkedIds: Set<string>): string {
    const isSelected = skill.id === selectedId;
    const isChecked = checkedIds.has(skill.id);
    const meta = dependencies(runtime).SKILL_TYPE_META[skill.type] ?? dependencies(runtime).SKILL_TYPE_META.custom;
    const typeLabel = dependencies(runtime).t(`skillType.${skill.type}` as Parameters<SettingsRuntime['presentation']['t']>[0]);
    return `
        <div class="settings-list-item ${isSelected ? 'selected' : ''}" data-id="${skill.id}" style="cursor:pointer">
            <input type="checkbox" class="settings-list-item__check" data-check-id="${skill.id}"
                   ${isChecked ? 'checked' : ''}
                   style="flex-shrink:0;margin:0;cursor:pointer;accent-color:var(--st-color-primary,#6366f1)"
                   title="Select for batch action"
                   onclick="event.stopPropagation()">
            <span class="settings-list-item__icon" style="font-size:1.25rem">${skill.icon || meta.icon}</span>
            <div class="settings-list-item__info" style="min-width:0">
                <div class="settings-list-item__title" data-name-for="${skill.id}"
                     title="${dependencies(runtime).t('tooltip.dblClickRename')}" style="cursor:text">${skill.name}</div>
                <div class="settings-list-item__desc">${typeLabel}${skill.endpoint ? ' · ' + shortUrl(skill.endpoint) : ''}</div>
                <div style="font-family:monospace;font-size:.7rem;opacity:.5;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${skill.id}</div>
            </div>
            ${enabledBadge(runtime, skill.enabled)}
        </div>`;
}
export function renderEmptyState(runtime: SettingsRuntime): string {
    return `
        <div class="settings-empty" style="height:100%;justify-content:center">
            <div class="settings-empty__icon">${dependencies(runtime).ENTITY_ICONS.skill}</div>
            <div class="settings-empty__title">${dependencies(runtime).t('skill.select.title')}</div>
            <p style="color:var(--st-text-tertiary);font-size:.875rem;text-align:center;max-width:280px">
                ${dependencies(runtime).t('skill.select.desc')}
            </p>
            <div style="display:flex;gap:.5rem;flex-wrap:wrap;justify-content:center">
                <button class="settings-btn settings-btn--primary" data-action="add">
                    <i class="fas fa-plus"></i> ${dependencies(runtime).t('skill.select.action')}
                </button>
                <button class="settings-btn settings-btn--secondary" data-action="import">
                    <i class="fas fa-folder-open"></i> ${dependencies(runtime).t('skill.import.fileLabel')}
                </button>
            </div>
        </div>`;
}
export function renderMcpToolOptions(runtime: SettingsRuntime, serverId: string | undefined, selectedTool: string | undefined, mcpServers: MCPServer[]): string {
    if (!serverId)
        return '';
    const server = mcpServers.find(s => s.id === serverId);
    const tools = (server?.tools as any[] | undefined) ?? [];
    if (tools.length === 0) {
        return `<option value="" disabled>${dependencies(runtime).t('skill.hint.noMcpTools')}</option>`;
    }
    return tools.map((t: any) => `<option value="${t.name}" ${selectedTool === t.name ? 'selected' : ''}>${t.name}${t.description ? ' — ' + t.description : ''}</option>`).join('');
}
export function headersWithoutAuth(headers?: Record<string, string>): string {
    if (!headers)
        return '';
    const { Authorization, ...rest } = headers;
    return Object.keys(rest).length ? JSON.stringify(rest, null, 2) : '';
}
export function shortUrl(url: string): string {
    try {
        return new URL(url).hostname;
    }
    catch {
        return url.slice(0, 20);
    }
}
// ─── Detail panel render ──────────────────────────────────────────────────
// Type of the entity header renderer provided by BaseSettingsEditor
export type EntityHeaderParams = {
    icon: string;
    fallbackIcon: string;
    editableIcon: boolean;
    name: string;
    namePlaceholder: string;
    badges: string;
    subtitle: string;
    actions: string;
};
export function renderDetail(runtime: SettingsRuntime, skill: LLMSkill, mcpServers: MCPServer[], renderEntityHeader: (params: EntityHeaderParams) => string): string {
    const meta = dependencies(runtime).SKILL_TYPE_META[skill.type] ?? dependencies(runtime).SKILL_TYPE_META.custom;
    const isHTTP = skill.type === 'http';
    const isShell = skill.type === 'shell';
    const isPrompt = skill.type === 'prompt';
    const isMCP = skill.type === 'mcp';
    const params = skill.parameters ? JSON.stringify(skill.parameters, null, 2) : '';
    return `
        <!-- ── Header ── -->
        ${renderEntityHeader({
        icon: skill.icon || '',
        fallbackIcon: meta.icon,
        editableIcon: true,
        name: skill.name,
        namePlaceholder: dependencies(runtime).t('skill.placeholder.name'),
        badges: `${typeBadge(runtime, skill.type)} ${enabledBadge(runtime, skill.enabled)}`,
        subtitle: skill.description || dependencies(runtime).t('status.noDesc'),
        actions: `
                ${isHTTP ? `
                <button class="settings-btn settings-btn--secondary" data-action="test" title="${dependencies(runtime).t('tooltip.testConnection')}">
                    <i class="fas fa-vial"></i> ${dependencies(runtime).t('action.test')}
                </button>` : ''}

                <button class="settings-btn settings-btn--danger" data-action="delete" title="${dependencies(runtime).t('action.delete')}">
                    <i class="fas fa-trash"></i>
                </button>`,
    })}

        <!-- ── Scrollable body ── -->
        <div style="overflow-y:auto;padding:1.25rem 1.75rem 2rem">

            <!-- Basic Info -->
            <div class="settings-section">
                <h3 class="settings-section__title">${dependencies(runtime).t('skill.section.basic')}</h3>
                <div class="settings-form-group">
                    <label>ID <span style="color:var(--st-text-tertiary);font-size:.8em">lowercase letters, numbers, hyphens</span></label>
                    <input class="settings-input" name="id" data-autosave-defer value="${skill.id}"
                           placeholder="my-skill-id"
                           style="font-family:monospace;font-size:.875rem"
                           pattern="[a-z0-9][a-z0-9_-]*" title="Lowercase letters, numbers, hyphens">
                </div>
                <div class="settings-form-group">
                    <label>${dependencies(runtime).t('form.description')}</label>
                    <textarea class="settings-textarea" name="description" rows="2"
                        placeholder="${dependencies(runtime).t('skill.placeholder.desc')}">${skill.description || ''}</textarea>
                </div>
                <div style="display:grid;grid-template-columns:1fr auto;gap:.75rem;align-items:end">
                    <div class="settings-form-group" style="margin-bottom:0">
                        <label>${dependencies(runtime).t('form.type')}</label>
                        <select class="settings-select" name="type">
                            <option value="prompt"  ${skill.type === 'prompt' ? 'selected' : ''}>${dependencies(runtime).SKILL_TYPE_META.prompt.icon} Prompt — ${dependencies(runtime).t('skillType.prompt.desc')}</option>
                            <option value="shell"   ${skill.type === 'shell' ? 'selected' : ''}>${dependencies(runtime).SKILL_TYPE_META.shell.icon} Shell — ${dependencies(runtime).t('skillType.shell.desc')}</option>
                            <option value="mcp"     ${skill.type === 'mcp' ? 'selected' : ''}>${dependencies(runtime).SKILL_TYPE_META.mcp.icon} MCP — ${dependencies(runtime).t('skillType.mcp.desc')}</option>
                            <option value="http"    ${skill.type === 'http' ? 'selected' : ''}>${dependencies(runtime).SKILL_TYPE_META.http.icon} HTTP — ${dependencies(runtime).t('skillType.http.desc')}</option>
                            <option value="builtin" ${skill.type === 'builtin' ? 'selected' : ''}>${dependencies(runtime).SKILL_TYPE_META.builtin.icon} Builtin — ${dependencies(runtime).t('skillType.builtin.desc')}</option>
                            <option value="custom"  ${skill.type === 'custom' ? 'selected' : ''}>${dependencies(runtime).SKILL_TYPE_META.custom.icon} Custom — ${dependencies(runtime).t('skillType.custom.desc')}</option>
                        </select>
                    </div>
                    <div class="settings-checkbox-row" style="padding-bottom:.5rem;white-space:nowrap">
                        <input type="checkbox" id="skill-enabled" name="enabled" ${skill.enabled ? 'checked' : ''}>
                        <label for="skill-enabled">${dependencies(runtime).t('skill.enabled.label')}</label>
                    </div>
                </div>
            </div>

            <!-- Trigger & Auto-load -->
            <div class="settings-section">
                <h3 class="settings-section__title">${dependencies(runtime).t('skill.section.trigger')}</h3>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:.75rem">
                    <div class="settings-form-group" style="margin-bottom:0">
                        <label>${dependencies(runtime).t('skill.trigger.strategyLabel')}</label>
                        <select class="settings-select" name="triggerStrategy" id="trigger-strategy-select">
                            <option value="reference" ${(skill.triggerStrategy ?? 'reference') === 'reference' ? 'selected' : ''}>
                                📖 Reference — ${dependencies(runtime).t('skill.trigger.reference.desc')}
                            </option>
                            <option value="action" ${skill.triggerStrategy === 'action' ? 'selected' : ''}>
                                ⚡ Action — ${dependencies(runtime).t('skill.trigger.action.desc')}
                            </option>
                        </select>
                    </div>
                    <div class="settings-form-group" style="margin-bottom:0">
                        <label>${dependencies(runtime).t('skill.trigger.priorityLabel')}
                            <span style="color:var(--st-text-tertiary);font-size:.8em">${dependencies(runtime).t('skill.trigger.priorityHint')}</span>
                        </label>
                        <input class="settings-input" type="number" name="priority"
                               value="${skill.priority ?? 50}" min="0" max="100" step="5"
                               style="font-variant-numeric:tabular-nums">
                    </div>
                </div>
                <div style="display:flex;gap:1.5rem;margin-top:.75rem;flex-wrap:wrap">
                    <div class="settings-checkbox-row">
                        <input type="checkbox" id="skill-autoload" name="autoLoad"
                               ${skill.autoLoad ? 'checked' : ''}>
                        <label for="skill-autoload">${dependencies(runtime).t('skill.trigger.autoLoadLabel')}</label>
                    </div>
                    <div class="settings-checkbox-row" id="disable-invocation-row"
                         style="${skill.triggerStrategy === 'action' ? '' : 'display:none'}">
                        <input type="checkbox" id="skill-disable-model" name="disableModelInvocation"
                               ${skill.disableModelInvocation ? 'checked' : ''}>
                        <label for="skill-disable-model">${dependencies(runtime).t('skill.trigger.disableModelLabel')}</label>
                    </div>
                </div>
                <div class="settings-form-group" style="margin-top:.75rem">
                    <label>${dependencies(runtime).t('skill.trigger.globsLabel')}
                        <span style="color:var(--st-text-tertiary);font-size:.8em">${dependencies(runtime).t('skill.trigger.globsHint')}</span>
                    </label>
                    <textarea class="settings-textarea" name="globs" rows="2"
                        style="font-family:monospace;font-size:.8125rem"
                        placeholder="src/controllers/*.ts&#10;src/**/*.handler.ts"
                        >${(skill.globs ?? []).join('\n')}</textarea>
                </div>
                <div class="settings-form-group">
                    <label>${dependencies(runtime).t('skill.trigger.correctionLogLabel')}
                        <span style="color:var(--st-text-tertiary);font-size:.8em">${dependencies(runtime).t('skill.trigger.correctionLogHint')}</span>
                    </label>
                    <input class="settings-input" name="correctionLog"
                           value="${escapeSupportValue(skill.correctionLog?.path ?? '')}"
                           placeholder="docs/agent-corrections.md"
                           style="font-family:monospace;font-size:.875rem">
                    <label><input type="checkbox" name="correctionEnabled" ${skill.correctionLog?.enabled ? 'checked' : ''}> ${dependencies(runtime).t('skill.support.correctionEnabled')}</label>
                    <label>${dependencies(runtime).t('skill.support.correctionRoot')}</label>
                    <input class="settings-input" name="correctionRoot" value="${escapeSupportValue(skill.correctionLog?.root ?? '')}" placeholder="/workspace">
                </div>
                <div class="settings-form-group">
                    <label>${dependencies(runtime).t('skill.support.root')}</label>
                    <input class="settings-input" name="fsRoot" value="${escapeSupportValue(skill.fsRoot ?? '')}" placeholder="/workspace/_agent/skills/review">
                    <p>${dependencies(runtime).t('skill.support.hint')}</p>
                    <label>${dependencies(runtime).t('skill.support.references')}</label>
                    <textarea class="settings-textarea" name="referencePaths" rows="3">${escapeSupportValue((skill.referencePaths ?? []).join('\n'))}</textarea>
                    <label>${dependencies(runtime).t('skill.support.template')}</label>
                    <input class="settings-input" name="templatePath" value="${escapeSupportValue(skill.templatePath ?? '')}" placeholder="template.md">
                </div>
            </div>

            <!-- Prompt Instructions (type=prompt) -->
            <div class="settings-section" id="prompt-section" style="${isPrompt ? '' : 'display:none'}">
                <h3 class="settings-section__title">${dependencies(runtime).t('skill.section.prompt')}</h3>
                <p style="font-size:.8125rem;color:var(--st-text-secondary);margin:0 0 .75rem">
                    ${dependencies(runtime).t('skill.hint.prompt')}</p>
                <textarea class="settings-textarea" name="instructions" rows="14"
                    style="font-family:monospace;font-size:.8125rem;resize:vertical"
                    placeholder="${dependencies(runtime).t('skill.placeholder.instructions').replace(/\\n/g, '&#10;')}"
                    >${skill.instructions || ''}</textarea>
            </div>

            <!-- MCP Config (type=mcp) -->
            <div class="settings-section" id="mcp-section" style="${isMCP ? '' : 'display:none'}">
                <h3 class="settings-section__title">${dependencies(runtime).t('skill.section.mcp')}</h3>
                <p style="font-size:.8125rem;color:var(--st-text-secondary);margin:0 0 .75rem">
                    ${dependencies(runtime).t('skill.hint.mcpDesc')}</p>
                <div class="settings-form-group">
                    <label>${dependencies(runtime).t('skill.mcp.serverLabel')}</label>
                    <select class="settings-select" name="mcpServerId" id="mcp-server-select">
                        <option value="">${dependencies(runtime).t('skill.mcp.serverEmpty')}</option>
                        ${mcpServers.map(s => `
                            <option value="${s.id}" ${skill.mcpServerId === s.id ? 'selected' : ''}>
                                ${s.icon || '🔌'} ${s.name}
                            </option>`).join('')}
                    </select>
                    ${mcpServers.length === 0 ? `
                        <p style="font-size:.75rem;color:var(--st-color-warning,#f59e0b);margin:.375rem 0 0">
                            <i class="fas fa-exclamation-triangle"></i>
                            ${dependencies(runtime).t('skill.hint.noMcpServer')}
                        </p>` : ''}
                </div>
                <div class="settings-form-group" id="mcp-tool-group"
                     style="${skill.mcpServerId ? '' : 'display:none'}">
                    <label>${dependencies(runtime).t('skill.mcp.toolLabel')}</label>
                    <select class="settings-select" name="mcpToolName" id="mcp-tool-select">
                        <option value="">${dependencies(runtime).t('skill.mcp.toolEmpty')}</option>
                        ${renderMcpToolOptions(runtime, skill.mcpServerId, skill.mcpToolName, mcpServers)}
                    </select>
                </div>
                ${skill.mcpServerId && skill.mcpToolName ? `
                    <div style="padding:.625rem .875rem;background:var(--st-surface-secondary,#f9fafb);
                                border-radius:6px;font-size:.8125rem;color:var(--st-text-secondary)">
                        <i class="fas fa-info-circle"></i>
                        ${dependencies(runtime).t('skill.hint.mcpAutoParams')}
                    </div>` : ''}
            </div>

            <!-- Shell Config (type=shell) -->
            <div class="settings-section" id="shell-section" style="${isShell ? '' : 'display:none'}">
                <h3 class="settings-section__title">${dependencies(runtime).t('skill.section.shell')}</h3>
                <div class="settings-form-group">
                    <label>
                        ${dependencies(runtime).t('skill.shell.commandLabel')}
                        <span style="color:var(--st-text-tertiary);font-size:.8em">${dependencies(runtime).t('skill.shell.commandHint')}</span>
                    </label>
                    <input class="settings-input" name="command" style="font-family:monospace"
                        value="${skill.command || ''}"
                        placeholder="${dependencies(runtime).t('skill.shell.placeholder')}">
                </div>
                <p style="font-size:.75rem;color:var(--st-text-tertiary);margin:.25rem 0 0">
                    ${dependencies(runtime).t('skill.hint.shell')}</p>
            </div>

            <!-- HTTP Config (type=http) -->
            <div class="settings-section" id="http-section" style="${isHTTP ? '' : 'display:none'}">
                <h3 class="settings-section__title">${dependencies(runtime).t('skill.section.http')}</h3>
                <div class="settings-form-group">
                    <label>${dependencies(runtime).t('form.endpoint')}</label>
                    <input class="settings-input" type="url" name="endpoint"
                        value="${skill.endpoint || ''}" placeholder="https://api.example.com/skill">
                </div>
                <div style="display:grid;grid-template-columns:120px 1fr;gap:.75rem">
                    <div class="settings-form-group" style="margin-bottom:0">
                        <label>${dependencies(runtime).t('form.method')}</label>
                        <select class="settings-select" name="method">
                            <option value="POST" ${(skill.method ?? 'POST') === 'POST' ? 'selected' : ''}>POST</option>
                            <option value="GET"  ${skill.method === 'GET' ? 'selected' : ''}>GET</option>
                            <option value="PUT"  ${skill.method === 'PUT' ? 'selected' : ''}>PUT</option>
                        </select>
                    </div>
                    <div class="settings-form-group" style="margin-bottom:0">
                        <label>${dependencies(runtime).t('form.auth')} <span style="color:var(--st-text-tertiary);font-size:.8em">可选</span></label>
                        <input class="settings-input" type="password" name="auth-header"
                            value="${skill.headers?.Authorization || ''}" placeholder="Bearer sk-...">
                    </div>
                </div>
                <div class="settings-form-group">
                    <label>
                        ${dependencies(runtime).t('form.headers')}
                        <span style="color:var(--st-text-tertiary);font-size:.8em">${dependencies(runtime).t('form.headersHint')}</span>
                    </label>
                    <textarea class="settings-textarea" name="headers" rows="3"
                        style="font-family:monospace;font-size:.8125rem"
                        placeholder='{"X-Custom-Header": "value"}'>${headersWithoutAuth(skill.headers)}</textarea>
                </div>
            </div>

            <!-- Parameters Schema -->
            <div class="settings-section" id="params-section" style="${isPrompt || isMCP ? 'display:none' : ''};margin-bottom:0">
                <h3 class="settings-section__title" style="display:flex;align-items:center;gap:.5rem">
                    ${dependencies(runtime).t('skill.section.params')}
                    <span style="font-size:.75rem;font-weight:400;color:var(--st-text-tertiary)">
                        JSON Schema
                    </span>
                </h3>
                <textarea class="settings-textarea" name="parameters" rows="10"
                    style="font-family:monospace;font-size:.8125rem;resize:vertical"
                    placeholder="${dependencies(runtime).t('skill.param.placeholder')}">${params}</textarea>
                <p style="font-size:.75rem;color:var(--st-text-tertiary);margin:.375rem 0 0">
                    ${dependencies(runtime).t('skill.hint.params')}</p>
            </div>
        </div>`;
}
function createDependencies(runtime: SettingsRuntime) { return { t: runtime.presentation.t, SKILL_TYPE_META: runtime.presentation.SKILL_TYPE_META, ENTITY_ICONS: runtime.presentation.ENTITY_ICONS }; }
export function bind(runtime: SettingsRuntime) { return { typeBadge: typeBadge.bind(null, runtime), enabledBadge: enabledBadge.bind(null, runtime), renderEmptyList: renderEmptyList.bind(null, runtime), renderListItem: renderListItem.bind(null, runtime), renderEmptyState: renderEmptyState.bind(null, runtime), renderMcpToolOptions: renderMcpToolOptions.bind(null, runtime), headersWithoutAuth: headersWithoutAuth.bind(null), shortUrl: shortUrl.bind(null), renderDetail: renderDetail.bind(null, runtime) }; }

const dependencyCache = new WeakMap<SettingsRuntime, ReturnType<typeof createDependencies>>();
function dependencies(runtime: SettingsRuntime) {
    let value = dependencyCache.get(runtime);
    if (!value) { value = createDependencies(runtime); dependencyCache.set(runtime, value); }
    return value;
}
