import type { SettingsRuntime } from '../runtime';
import { bindConstructor } from '../binding';
import { bind as bind0 } from './agent-image-settings';
import { bind as bind1 } from './agent-prompt-reference';
import { bind as bind2 } from './agent-execution';
import { bind as bind3 } from './agent-model-defaults';
import { bind as bind4 } from './agent-composition';
import { bind as bind5 } from './agent-header';
import { bind as bind6 } from './agent-publication';
import { randomUUID as generateUUID } from '../identity';
import { randomUUID as randomUUID } from '../identity';
import { EventBus } from '../events';
import { bind as bind10 } from './agent-capabilities';
import type { SettingsAutoSave, Heading, IEditor, EditorOptions, EditorEvent, EditorEventMap, EditorEventCallback, UnifiedSearchResult, CollapseExpandResult } from '../contracts/editor';
import type { AgentExecutionController } from './agent-execution';
import type { AgentHeaderController } from './agent-header';
import type { AgentPublicationController } from './agent-publication';
import type { AgentType, AgentDefinition, IAgentManagementService, PromptPreset, SystemPromptDefinition } from '../contracts/domain';
import type { AgentCapabilityOptions } from './agent-capabilities';
export type AgentEditorPage = 'general' | 'behavior' | 'capabilities' | 'advanced';
const agentEditorPages: readonly AgentEditorPage[] = ['general', 'behavior', 'capabilities', 'advanced'];
/**
 * Agent 配置编辑器
 * 需要完整的 CRUD 能力，因此依赖 IAgentManagementService
 */
export class AgentConfigEditor implements IEditor {
    private readonly defaultToolIds: readonly string[];
    private autoSave?: SettingsAutoSave;
    private readonly viewId = `agent-config-${randomUUID()}`;
    private activePage: AgentEditorPage = 'general';
    private validationObserver?: MutationObserver;
    private navigationEvents?: AbortController;
    private executionForm?: AgentExecutionController;
    private rendering?: Promise<void>;
    private promptLibrary: SystemPromptDefinition[] = [];
    private container!: HTMLElement;
    private content: AgentDefinition | null = null;
    private _isDirty = false;
    private editorEvents = new EventBus<EditorEventMap>();
    private originalContent: string = '';
    private currentTitle: string = '';
    private hostSettings?: Awaited<ReturnType<NonNullable<EditorOptions['mountSettings']>>>;
    private header?: AgentHeaderController;
    private publication?: AgentPublicationController;
    constructor(private readonly settingsRuntime: SettingsRuntime, _container: HTMLElement, private readonly options: EditorOptions, private service: IAgentManagementService, private readonly capabilities: AgentCapabilityOptions = {}) {
        this.defaultToolIds = [...new Set(capabilities.defaultToolIds ?? [])];
    }
    async init(container: HTMLElement, initialContent?: string) {
        this.container = container;
        this.container.classList.add('agent-config-editor');
        this.originalContent = initialContent || '{}';
        this.currentTitle = (this.options.title as string) || '';
        this.setText(this.originalContent);
        await this.rendering;
        this.emit('ready', undefined);
    }
    // --- Core IEditor Implementation ---
    getText(): string {
        if (!this.content)
            return '{}';
        this.syncModelFromUI();
        return JSON.stringify(this.content, null, 2);
    }
    setText(text: string) {
        if (this.publication?.hasPendingWrite) {
            this.publication.requireSourceReview();
            return;
        }
        if (this.autoSave?.protectsInput)
            return;
        try {
            const parsed = JSON.parse(text);
            // [核心修改] ID 生成逻辑
            // 如果 parsed.id 为空字符串 (来自模板) 或 undefined，则生成 UUID
            const agentId = (parsed.id && parsed.id.trim() !== '')
                ? parsed.id
                : generateUUID();
            // 修复：使用有效的 AgentType
            const validType = this.normalizeAgentType(parsed.type);
            this.content = {
                ...parsed,
                id: agentId,
                name: parsed.name || 'New Agent',
                type: validType,
                description: parsed.description || '',
                icon: parsed.icon || '🤖',
                config: {
                    ...parsed.config,
                    systemPrompt: parsed.config?.systemPrompt ?? '',
                    mcpServers: parsed.config?.mcpServers || [],
                    maxHistoryLength: parsed.config?.maxHistoryLength ?? -1,
                    temperature: parsed.config?.temperature
                },
                interface: parsed.interface || {
                    inputs: [],
                    outputs: []
                },
                defaultPrompts: this.normalizePrompts(parsed.defaultPrompts)
                // 注意：这里不再处理 tags
            };
            this.rendering = this.render();
        }
        catch (e) {
            this.renderError((e as Error).message);
            this.content = null;
        }
    }
    /**
     * 规范化 defaultPrompts
     * 过滤非法项，保证每项为 { name, prompt } 字符串对。
     */
    private normalizePrompts(raw: unknown): PromptPreset[] {
        if (!Array.isArray(raw))
            return [];
        return raw
            .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
            .map(p => ({
            name: typeof p.name === 'string' ? p.name : '',
            prompt: typeof p.prompt === 'string' ? p.prompt : '',
        }));
    }
    /**
     * 新增：规范化 AgentType
     * 将旧的 'orchestrator' 映射到 'composite'
     */
    private normalizeAgentType(type: string | undefined): AgentType {
        switch (type) {
            case 'agent':
                return 'agent';
            case 'composite':
            case 'orchestrator': // 兼容旧数据
                return 'composite';
            case 'tool':
                return 'tool';
            case 'workflow':
                return 'workflow';
            default:
                return 'agent';
        }
    }
    isDirty() { return (this.autoSave?.isDirty ?? this._isDirty) || !!this.hostSettings?.isDirty(); }
    setDirty(dirty: boolean) { this._isDirty = dirty; }
    // --- Rendering ---
    async render() {
        const runtime = this.settingsRuntime;
        this.publication?.assertCanClose();
        this.publication?.destroy();
        this.publication = undefined;
        await this.hostSettings?.flush();
        if (this.autoSave && !await this.autoSave.dispose())
            return;
        this.executionForm?.destroy();
        this.validationObserver?.disconnect();
        this.navigationEvents?.abort();
        await this.hostSettings?.destroy();
        this.hostSettings = undefined;
        this.header?.destroy();
        this.header = undefined;
        if (!this.content)
            return;
        const agent = this.content;
        const config = { ...agent.config, systemPrompt: agent.systemPrompt ?? agent.config.systemPrompt };
        const systemPrompts = await this.service.listSystemPrompts();
        this.promptLibrary = systemPrompts;
        const allMCPServers = [...await this.service.getMCPServers()];
        for (const id of agent.capabilityPolicy?.mcpProfileIds ?? config.mcpServers ?? []) {
            if (!allMCPServers.some(server => server.id === id))
                allMCPServers.push({ id, name: id, transport: 'http', status: 'error' });
        }
        const allSkills = await this.service.getSkills();
        this.container.innerHTML = `
            <div class="agent-editor-container">
                <div class="agent-mobile-header">
                    <div class="agent-mobile-header__navigation" data-agent-compact-navigation></div>
                    <div class="agent-mobile-header__actions" data-agent-compact-actions></div>
                </div>
                <!-- Header with Icon & Name -->
                <div class="agent-header">
                    <div class="agent-header__identity" data-agent-identity>
                    <button type="button" class="agent-header__icon-picker" id="icon-picker" title="${dependencies(runtime).t('agent.layout.changeIcon')}" aria-label="${dependencies(runtime).t('agent.layout.changeIcon')}">
                        ${this.escapeHtml(agent.icon || dependencies(runtime).ENTITY_ICONS.agent)}
                    </button>
                    <div class="agent-header__info">
                        <input type="text" 
                               class="agent-header__name-input" 
                               name="name" 
                               value="${this.escapeHtml(agent.name)}" 
                               aria-label="${dependencies(runtime).t('agent.layout.name')}"
                               placeholder="${dependencies(runtime).t('agent.layout.name')}">
                        <textarea class="agent-header__desc-input" 
                                  name="description" 
                                  aria-label="${dependencies(runtime).t('agent.layout.description')}"
                                  placeholder="${dependencies(runtime).t('agent.layout.description')}"
                                  rows="2">${this.escapeHtml(agent.description || '')}</textarea>
                    </div>
                    </div>
                    <div class="agent-header__actions" data-agent-header-actions></div>
                </div>
                <p class="agent-chat-status" data-agent-chat-status role="status" aria-live="polite" hidden></p>
                <div class="agent-publication" data-agent-publication></div>

                ${this.renderPageTabs()}
                <div class="agent-editor-panels">
                ${this.renderPageStart('general')}
                <div class="agent-editor-page">
                <div class="agent-basic-identity" data-agent-identity-slot></div>
                <div class="agent-form-row">
                    <label class="agent-form-label" for="agent-exposure">${dependencies(runtime).t('callable.exposure.label')}</label>
                    <select class="agent-form-input" id="agent-exposure" name="exposure">
                        ${agent.exposure !== undefined && !['global', 'local'].includes(agent.exposure) ? `<option value="" selected>${dependencies(runtime).t('callable.exposure.invalid')}</option>` : ''}
                        <option value="global" ${agent.exposure === undefined || agent.exposure === 'global' ? 'selected' : ''}>${dependencies(runtime).t('callable.exposure.global')}</option>
                        <option value="local" ${agent.exposure === 'local' ? 'selected' : ''}>${dependencies(runtime).t('callable.exposure.local')}</option>
                    </select>
                    <p class="agent-form-help">${dependencies(runtime).t('callable.exposure.hint')}</p>
                </div>
                <div data-agent-execution-slot></div>
                <div class="agent-host-settings" data-agent-host-settings></div>

                </div></section>
                ${this.renderPageStart('behavior')}
                <div class="agent-editor-page">
                <div data-agent-model-defaults-slot></div>
                <!-- Agent behavior -->
                <div class="agent-section" id="llm-config-section">
                    <button type="button" class="agent-section__header" aria-expanded="true">
                        <span class="agent-section__icon" aria-hidden="true">${dependencies(runtime).ENTITY_ICONS.llm}</span>
                        <span class="agent-section__title">${dependencies(runtime).t('agent.behavior.title')}</span>
                        <span class="agent-section__toggle" aria-hidden="true">${dependencies(runtime).FILE_BROWSER_ICONS.chevron}</span>
                    </button>
                    <div class="agent-section__body">
                        ${dependencies(runtime).renderPromptReference(systemPrompts, config.systemPromptId)}
                        <div class="agent-form-row">
                            <label class="agent-form-label" for="agent-system-prompt">${dependencies(runtime).t('prompt.additional')}</label>
                            <textarea class="agent-form-textarea" 
                                      id="agent-system-prompt"
                                      name="systemPrompt" 
                                      placeholder="You are a helpful assistant...">${this.escapeHtml(config.systemPrompt || '')}</textarea>
                            <p class="agent-form-help">
                                ${dependencies(runtime).t('prompt.additionalHint')}
                            </p>
                        </div>

                        <div class="agent-form-grid">
                        <div class="agent-form-row">
                            <label class="agent-form-label" for="agent-history-length">${dependencies(runtime).t('agent.layout.history')}</label>
                            <input type="number"
                                   id="agent-history-length"
                                   class="agent-form-input"
                                   name="maxHistoryLength"
                                   value="${config.maxHistoryLength ?? -1}"
                                   min="-1">
                            <p class="agent-form-help">${dependencies(runtime).t('agent.layout.historyHint')}</p>
                        </div>

                        <div class="agent-form-row">
                            <label class="agent-form-label" for="agent-temperature">${dependencies(runtime).t('agent.layout.temperature')}</label>
                            <input type="number"
                                   id="agent-temperature"
                                   class="agent-form-input"
                                   name="temperature"
                                   value="${config.temperature ?? ''}"
                                   min="0" max="2" step="0.1"
                                   placeholder="${dependencies(runtime).t('agent.layout.temperatureDefault')}">
                            <p class="agent-form-help">
                                ${dependencies(runtime).t('agent.layout.temperatureHint')}
                            </p>
                        </div>
                        </div>
                        ${dependencies(runtime).renderAgentImageSettings(config.imageProcessing)}
                    </div>
                </div>

                <!-- Default Prompts -->
                <div class="agent-section">
                    <button type="button" class="agent-section__header" aria-expanded="true">
                        <span class="agent-section__icon" aria-hidden="true">${dependencies(runtime).ENTITY_ICONS.chat}</span>
                        <span class="agent-section__title">${dependencies(runtime).t('agent.layout.presets')}</span>
                        <span class="agent-section__toggle" aria-hidden="true">${dependencies(runtime).FILE_BROWSER_ICONS.chevron}</span>
                    </button>
                    <div class="agent-section__body">
                        <p class="agent-form-help" style="margin-bottom:12px;">
                            ${dependencies(runtime).t('agent.layout.presetsHint')}
                        </p>
                        <div class="agent-prompt-list" id="prompt-list">
                            ${(agent.defaultPrompts || []).map((p, i) => this.renderPromptRow(p, i)).join('')}
                        </div>
                    </div>
                </div>

                </div></section>
                ${this.renderPageStart('capabilities')}
                <div class="agent-editor-page agent-editor-page--tools">

                ${dependencies(runtime).renderAgentCapabilities(agent, allSkills, this.defaultToolIds)}

                <!-- MCP Tools -->
                <div class="agent-section" id="mcp-section">
                    <button type="button" class="agent-section__header" aria-expanded="true">
                        <span class="agent-section__icon" aria-hidden="true">${dependencies(runtime).ENTITY_ICONS.mcp}</span>
                        <span class="agent-section__title">${dependencies(runtime).t('agent.layout.mcp')}</span>
                        <span class="agent-section__toggle" aria-hidden="true">${dependencies(runtime).FILE_BROWSER_ICONS.chevron}</span>
                    </button>
                    <div class="agent-section__body">
                        ${allMCPServers.length === 0
            ? `<div class="agent-empty-state">
                                    <div class="agent-empty-state__icon" aria-hidden="true">${dependencies(runtime).ENTITY_ICONS.mcp}</div>
                                    <p>${dependencies(runtime).t('agent.layout.mcpEmpty')}</p>
                                    <p class="agent-form-help">${dependencies(runtime).t('agent.layout.mcpEmptyHint')}</p>
                               </div>`
            : `<p class="agent-form-help" style="margin-bottom:12px;">
                                    ${dependencies(runtime).t('agent.layout.mcpHint')}
                               </p>
                               <div class="agent-mcp-list">
                                    ${allMCPServers.map(server => `
                                        <label class="agent-mcp-item">
                                            <input type="checkbox" 
                                                   name="mcpServers" 
                                                   value="${this.escapeHtml(server.id)}"
                                                   ${(agent.capabilityPolicy?.mcpProfileIds ?? config.mcpServers ?? []).includes(server.id) ? 'checked' : ''}>
                                            <div class="agent-mcp-item__info">
                                                <div class="agent-mcp-item__name">
                                                    ${this.escapeHtml(server.icon || dependencies(runtime).ENTITY_ICONS.mcp)} ${this.escapeHtml(server.name)}
                                                </div>
                                                <div class="agent-mcp-item__desc">
                                                    ${this.escapeHtml(server.description || dependencies(runtime).t('agent.layout.noDescription'))}
                                                </div>
                                            </div>
                                            <span class="agent-mcp-item__status ${server.status === 'connected' ? 'connected' : ''}">
                                                ${dependencies(runtime).t(server.status === 'connected' ? 'agent.layout.connected' : 'agent.layout.disconnected')}
                                            </span>
                                        </label>
                                    `).join('')}
                               </div>`}
                    </div>
                </div>

                </div></section>
                ${this.renderPageStart('advanced')}
                <div class="agent-editor-page">
                ${this.renderAgentType(agent.type)}
                <!-- Advanced Settings -->
                <div class="agent-section">
                    <button type="button" class="agent-section__header" aria-expanded="true">
                        <span class="agent-section__icon" aria-hidden="true">${dependencies(runtime).ACTION_ICONS.settings}</span>
                        <span class="agent-section__title">${dependencies(runtime).t('agent.layout.advanced')}</span>
                        <span class="agent-section__toggle" aria-hidden="true">${dependencies(runtime).FILE_BROWSER_ICONS.chevron}</span>
                    </button>
                    <div class="agent-section__body">
                        <div class="agent-form-row">
                            <label class="agent-form-label" for="agent-id">Agent ID</label>
                            <input type="text" 
                                   class="agent-form-input" 
                                   id="agent-id"
                                   name="id" 
                                   value="${this.escapeHtml(agent.id)}" 
                                   readonly>
                            <p class="agent-form-help">${dependencies(runtime).t('agent.layout.idHint')}</p>
                        </div>
                    </div>
                </div>

                </div></section>
                </div>
                <!-- Hidden field for icon -->
                <input type="hidden" name="icon" value="${this.escapeHtml(agent.icon || dependencies(runtime).ENTITY_ICONS.agent)}">
            </div>
        `;
        const flows = await this.capabilities.listFlows?.() ?? [];
        const agents = await this.service.getAgents?.() ?? [];
        const execution = document.createElement('div');
        execution.innerHTML = dependencies(runtime).renderAgentExecution(agent, flows, agents);
        this.container.querySelector('[data-agent-execution-slot]')!.replaceWith(execution);
        this.container.querySelector('[data-agent-model-defaults-slot]')!.innerHTML = await dependencies(runtime).renderAgentModelDefaults(agent, this.service);
        dependencies(runtime).bindAgentModelDefaults(this.container);
        if (this.options.mountSettings) {
            const slot = this.container.querySelector<HTMLElement>('[data-agent-host-settings]')!;
            this.hostSettings = await this.options.mountSettings(slot);
        }
        const service = this.service;
        const harnessConnections = service.getHarnessConnectionRecord && service.getHarnessConnectionTargets && service.saveHarnessConnection ? {
            get: service.getHarnessConnectionRecord.bind(service), targets: service.getHarnessConnectionTargets.bind(service),
            save: service.saveHarnessConnection.bind(service),
        } : undefined;
        this.executionForm = dependencies(runtime).bindAgentExecution(this.container, agent, flows, { ...this.capabilities,
            harnessConnections: this.capabilities.harnessConnections ?? harnessConnections,
            listHarnessConnections: this.capabilities.listHarnessConnections ?? (() => this.service.getHarnessConnections?.() ?? Promise.resolve([])) });
        await this.executionForm.ready();
        this.bindEvents();
        this.activatePage(this.activePage);
        this.header = dependencies(runtime).mountAgentHeader(this.container, this.options, () => this.flushPendingSave());
        this.publication = new (dependencies(runtime).AgentPublicationController)(this.container.querySelector('[data-agent-publication]')!, this.service, agent.id, () => this.flushPendingSave(), !!this.options.readOnly);
    }
    private renderPageTabs(): string {
        const runtime = this.settingsRuntime;
        return `<nav class="agent-editor-tabs" role="tablist" aria-label="${dependencies(runtime).t('agent.layout.pages')}">
            ${agentEditorPages.map(page => `<button type="button" class="agent-editor-tab" role="tab"
                id="${this.viewId}-tab-${page}" aria-controls="${this.viewId}-panel-${page}"
                data-agent-page-link="${page}" aria-selected="${this.activePage === page}"
                tabindex="${this.activePage === page ? 0 : -1}">${dependencies(runtime).t(`agent.layout.page.${page}`)}</button>`).join('')}
        </nav>`;
    }
    private renderPageStart(page: AgentEditorPage): string {
        return `<section class="agent-editor-panel" role="tabpanel" tabindex="0"
            id="${this.viewId}-panel-${page}" aria-labelledby="${this.viewId}-tab-${page}"
            data-agent-page="${page}" ${page === this.activePage ? '' : 'hidden'}>`;
    }
    private activatePage(page: AgentEditorPage, focus = false): void {
        this.activePage = page;
        this.container.querySelectorAll<HTMLButtonElement>('[data-agent-page-link]').forEach(tab => {
            const selected = tab.dataset.agentPageLink === page;
            tab.setAttribute('aria-selected', String(selected));
            tab.tabIndex = selected ? 0 : -1;
            if (selected && focus) {
                tab.focus();
                tab.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
            }
        });
        this.container.querySelectorAll<HTMLElement>('[data-agent-page]').forEach(panel => {
            panel.hidden = panel.dataset.agentPage !== page;
        });
    }
    private bindPageNavigation(): void {
        this.navigationEvents = new AbortController();
        this.container.addEventListener('focusout', event => {
            const next = event.relatedTarget;
            if (next instanceof HTMLElement && next.closest('.agent-editor-tabs'))
                event.stopImmediatePropagation();
        }, { capture: true, signal: this.navigationEvents.signal });
        const tabs = this.container.querySelector<HTMLElement>('[role=tablist]')!;
        tabs.addEventListener('click', event => {
            const tab = (event.target as HTMLElement).closest<HTMLElement>('[data-agent-page-link]');
            if (tab)
                this.activatePage(tab.dataset.agentPageLink as AgentEditorPage);
        });
        tabs.addEventListener('keydown', event => {
            const tab = (event.target as HTMLElement).closest<HTMLElement>('[data-agent-page-link]');
            if (!tab || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key))
                return;
            event.preventDefault();
            const current = agentEditorPages.indexOf(tab.dataset.agentPageLink as AgentEditorPage);
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? agentEditorPages.length - 1
                : (current + (event.key === 'ArrowRight' ? 1 : -1) + agentEditorPages.length) % agentEditorPages.length;
            this.activatePage(agentEditorPages[next]!, true);
        });
    }
    private bindSectionNavigation(): void {
        this.container.querySelectorAll<HTMLElement>('.agent-section__header').forEach(header => {
            header.addEventListener('click', () => {
                const section = header.closest('.agent-section');
                section?.classList.toggle('collapsed');
                header.setAttribute('aria-expanded', String(!section?.classList.contains('collapsed')));
            });
        });
    }
    private observeValidation(): void {
        const status = this.container.querySelector<HTMLElement>('[data-autosave-status]')!;
        this.validationObserver = new MutationObserver(() => {
            if (status.dataset.state !== 'invalid')
                return;
            const invalid = this.container.querySelector<HTMLElement>('input:invalid, select:invalid, textarea:invalid');
            if (invalid)
                this.revealField(invalid);
        });
        this.validationObserver.observe(status, { attributes: true, attributeFilter: ['data-state'] });
    }
    private revealField(field: HTMLElement): void {
        const panel = field.closest<HTMLElement>('[data-agent-page]');
        if (panel)
            this.activatePage(panel.dataset.agentPage as AgentEditorPage);
        const section = field.closest<HTMLElement>('.agent-section.collapsed');
        section?.classList.remove('collapsed');
        section?.querySelector('.agent-section__header')?.setAttribute('aria-expanded', 'true');
        if (document.activeElement !== field)
            field.focus();
        field.scrollIntoView?.({ block: 'nearest' });
    }
    private readDraftField<T>(selector: string, read: () => T): T {
        try {
            return read();
        }
        catch (error) {
            const field = this.container.querySelector<HTMLElement>(selector);
            if (field)
                this.revealField(field);
            throw error;
        }
    }
    private async flushHostSettings(): Promise<void> {
        try {
            await this.hostSettings?.flush();
        }
        catch (error) {
            const field = this.container.querySelector<HTMLElement>('[data-agent-host-settings] input:invalid, [data-agent-host-settings] select:invalid, [data-agent-host-settings] select');
            if (field)
                this.revealField(field);
            throw error;
        }
    }
    private renderAgentType(type: AgentType): string {
        const runtime = this.settingsRuntime;
        return `<section class="agent-section">
            <button type="button" class="agent-section__header" aria-expanded="true">
                <span class="agent-section__icon" aria-hidden="true">${dependencies(runtime).ENTITY_ICONS.agent}</span>
                <span class="agent-section__title">${dependencies(runtime).t('agent.layout.type')}</span>
                <span class="agent-section__toggle" aria-hidden="true">${dependencies(runtime).FILE_BROWSER_ICONS.chevron}</span>
            </button>
            <div class="agent-section__body">
                <p class="agent-form-help agent-type-help">${dependencies(runtime).t('agent.layout.typeHint')}</p>
                <input class="agent-form-input" data-agent-type-metadata value="${this.escapeHtml(type)}" readonly>
            </div>
        </section>`;
    }
    /** 渲染单个预设 Prompt 行（name + prompt + 排序/删除操作） */
    private renderPromptRow(p: PromptPreset, index: number): string {
        return `
            <div class="agent-prompt-item" data-index="${index}">
                <div class="agent-prompt-item__head">
                    <input type="text"
                           class="agent-form-input agent-prompt-name"
                           placeholder="名称（如：代码审查）"
                           value="${this.escapeHtml(p.name)}">
                    <div class="agent-prompt-actions">
                        <button type="button" class="agent-prompt-btn" data-action="up" title="上移">▲</button>
                        <button type="button" class="agent-prompt-btn" data-action="down" title="下移">▼</button>
                        <button type="button" class="agent-prompt-btn agent-prompt-btn--danger" data-action="remove" title="删除">✕</button>
                    </div>
                </div>
                <textarea class="agent-form-textarea agent-prompt-text"
                          rows="2"
                          placeholder="提示词内容...">${this.escapeHtml(p.prompt)}</textarea>
            </div>
        `;
    }
    private renderError(message: string) {
        this.container.innerHTML = `
            <div class="agent-editor-container">
                <div style="padding: 40px; text-align: center; color: #ef4444;">
                    <div style="font-size: 3rem; margin-bottom: 16px;">⚠️</div>
                    <h3 style="margin-bottom: 8px;">配置解析失败</h3>
                    <p style="color: #6b7280; font-size: 0.9rem;">${this.escapeHtml(message)}</p>
                    <pre style="margin-top: 16px; padding: 16px; background: #fef2f2; border-radius: 8px; text-align: left; overflow: auto; font-size: 0.8rem;">${this.escapeHtml(this.originalContent)}</pre>
                </div>
            </div>
        `;
    }
    private bindEvents() {
        const runtime = this.settingsRuntime;
        this.bindPageNavigation();
        this.bindSectionNavigation();
        if (this.options.readOnly) {
            dependencies(runtime).bindPromptReference(this.container, this.promptLibrary, this.service, this.options.navigation, () => { });
            this.container.querySelectorAll<HTMLInputElement>('input, select, textarea, button:not([role="tab"]):not(.agent-section__header)').forEach(field => { field.disabled = true; });
            return;
        }
        dependencies(runtime).bindAgentCapabilities(this.container, this.defaultToolIds);
        dependencies(runtime).bindAgentImageSettings(this.container);
        // 全局变更监听
        const handleChange = () => {
            this._isDirty = true;
            dependencies(runtime).requestSettingsSave(this.container);
        };
        this.autoSave = new (dependencies(runtime).SettingsAutoSave)(this.container, () => this.saveDraft(), this.container.querySelector<HTMLElement>('.agent-header__info') ?? undefined);
        this.observeValidation();
        dependencies(runtime).bindPromptReference(this.container, this.promptLibrary, this.service, this.options.navigation, handleChange);
        // 名称输入框 → 同步重命名 VFS 文件（复用 engine.rename + node:renamed 事件链）
        const nameInput = this.container.querySelector('.agent-header__name-input') as HTMLInputElement;
        const resource = this.options.resource;
        const nodeId = dependencies(runtime).editorResourceId(this.options);
        if (nameInput && resource && nodeId) {
            const ext = (this.options.language as string) || '';
            const doRename = async () => {
                const newName = nameInput.value.trim();
                if (!newName || newName === this.currentTitle)
                    return;
                const { filename } = dependencies(runtime).buildRenamedFilename(newName, this.currentTitle + ext);
                try {
                    await resource.rename(filename);
                    this.currentTitle = newName;
                }
                catch {
                    nameInput.value = this.currentTitle;
                }
            };
            nameInput.addEventListener('blur', doRename);
            nameInput.addEventListener('keydown', (e: KeyboardEvent) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    nameInput.blur();
                }
                if (e.key === 'Escape') {
                    nameInput.value = this.currentTitle;
                    nameInput.blur();
                }
            });
        }
        // Icon Picker
        const iconPicker = this.container.querySelector('#icon-picker');
        if (iconPicker) {
            iconPicker.addEventListener('click', () => this.showIconPicker());
        }
        // Default Prompts 列表
        this.bindPromptEvents(handleChange);
    }
    /**
     * 绑定预设 Prompt 列表事件：添加、删除、上移、下移。
     *
     * 编辑（name/prompt 输入）已由全局 input/change 监听覆盖，
     * 这里仅处理需要重排 DOM 的操作（增删/排序），重排后重新索引并触发变更。
     */
    private bindPromptEvents(handleChange: () => void): void {
        const list = this.container.querySelector('#prompt-list');
        const addBtn = this.container.querySelector('#prompt-add');
        addBtn?.addEventListener('click', () => {
            // 先回写当前 DOM 状态，再追加空行重渲染，避免丢失未保存输入
            this.collectPromptsToContent();
            this.content?.defaultPrompts?.push({ name: '', prompt: '' });
            if (this.content && !this.content.defaultPrompts) {
                this.content.defaultPrompts = [{ name: '', prompt: '' }];
            }
            this.rerenderPromptList();
            handleChange();
        });
        list?.addEventListener('click', (e) => {
            const btn = (e.target as HTMLElement).closest('.agent-prompt-btn') as HTMLElement | null;
            if (!btn)
                return;
            const item = btn.closest('.agent-prompt-item') as HTMLElement | null;
            const index = parseInt(item?.dataset.index ?? '-1', 10);
            if (index < 0)
                return;
            this.collectPromptsToContent();
            const prompts = this.content?.defaultPrompts;
            if (!prompts)
                return;
            const action = btn.dataset.action;
            if (action === 'remove') {
                prompts.splice(index, 1);
            }
            else if (action === 'up' && index > 0) {
                [prompts[index - 1], prompts[index]] = [prompts[index], prompts[index - 1]];
            }
            else if (action === 'down' && index < prompts.length - 1) {
                [prompts[index + 1], prompts[index]] = [prompts[index], prompts[index + 1]];
            }
            else {
                return;
            }
            this.rerenderPromptList();
            handleChange();
        });
        // 行内编辑（name/prompt）— 委托监听，因 DOM 动态重建无法依赖全局绑定
        list?.addEventListener('input', (e) => {
            const target = e.target as HTMLElement;
            if (target.classList.contains('agent-prompt-name') ||
                target.classList.contains('agent-prompt-text')) {
                handleChange();
            }
        });
    }
    /** 重新渲染 Prompt 列表 DOM（增删/排序后调用） */
    private rerenderPromptList(): void {
        const list = this.container.querySelector('#prompt-list');
        if (!list)
            return;
        const prompts = this.content?.defaultPrompts ?? [];
        list.innerHTML = prompts.map((p, i) => this.renderPromptRow(p, i)).join('');
    }
    /** 从 DOM 读取当前 Prompt 行，回写到 this.content.defaultPrompts */
    private collectPromptsToContent(): void {
        if (!this.content)
            return;
        const rows = Array.from(this.container.querySelectorAll('.agent-prompt-item'));
        this.content.defaultPrompts = rows.map(row => ({
            name: (row.querySelector('.agent-prompt-name') as HTMLInputElement)?.value ?? '',
            prompt: (row.querySelector('.agent-prompt-text') as HTMLTextAreaElement)?.value ?? '',
        }));
    }
    private showIconPicker() {
        const runtime = this.settingsRuntime;
        const icons = [
            '🤖', dependencies(runtime).ENTITY_ICONS.llm, '💡', '🎯', '🚀', '⚡', '🔥', '✨',
            '🎨', '📝', '📊', '📈', '🔍', '🔧', '⚙️', '🛠️',
            '💻', '🖥️', '📱', '🌐', '☁️', '🔒', '🔑', '📡',
            '🎭', '🎪', '🎬', '🎮', '🎲', '🃏', '🎵', '🎸',
            '📚', '📖', '✏️', '🖊️', '📌', '📎', '🗂️', '📁',
            '💬', '💭', '🗨️', '👤', '👥', '🤝', '👋', '✋',
            '🌟', '⭐', '🌙', '☀️', '🌈', '🍀', '🌸', '🌺',
            '🦾', '🦿', '🕸️', '💎', '🏆', '🎖️', '🥇'
        ];
        const overlay = document.createElement('div');
        overlay.className = 'icon-picker-overlay';
        overlay.innerHTML = `
            <div class="icon-picker-modal">
                <h3 style="margin: 0 0 16px 0; font-size: 1.1rem;">选择图标</h3>
                <div class="icon-picker-grid">
                    ${icons.map(icon => `
                        <div class="icon-picker-item" data-icon="${icon}">${icon}</div>
                    `).join('')}
                </div>
                <div style="margin-top: 16px; text-align: right;">
                    <button class="icon-picker-cancel" style="padding: 8px 16px; border: none; background: #e5e7eb; border-radius: 6px; cursor: pointer;">取消</button>
                </div>
            </div>
        `;
        // 选择图标
        overlay.querySelectorAll('.icon-picker-item').forEach(item => {
            item.addEventListener('click', () => {
                const icon = (item as HTMLElement).dataset.icon;
                if (icon) {
                    // 更新 UI
                    const iconDisplay = this.container.querySelector('#icon-picker');
                    if (iconDisplay)
                        iconDisplay.textContent = icon;
                    // 更新隐藏字段
                    const iconInput = this.container.querySelector('input[name="icon"]') as HTMLInputElement;
                    if (iconInput)
                        iconInput.value = icon;
                    this._isDirty = true;
                    dependencies(runtime).requestSettingsSave(this.container);
                }
                overlay.remove();
            });
        });
        overlay.querySelector('.icon-picker-cancel')?.addEventListener('click', () => overlay.remove());
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay)
                overlay.remove();
        });
        document.body.appendChild(overlay);
    }
    private syncModelFromUI() {
        const runtime = this.settingsRuntime;
        if (!this.content || !this.container.querySelector('[name="name"]'))
            return;
        const getVal = (name: string): string => {
            const el = this.container.querySelector(`[name="${name}"]`) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
            return el?.value || '';
        };
        this.content.name = getVal('name');
        this.content.icon = getVal('icon');
        this.content.description = getVal('description');
        const exposure = getVal('exposure');
        if (exposure !== 'global' && exposure !== 'local')
            throw new (dependencies(runtime).SettingsValidationError)(dependencies(runtime).t('callable.exposure.invalid'));
        this.content.exposure = exposure;
        this.content.execution = this.readDraftField('[name=executionKind]', () => dependencies(runtime).readAgentExecution(this.container));
        this.content.composition = this.readDraftField('[name=compositionCoordinator]', () => dependencies(runtime).readAgentComposition(this.container));
        if (this.content.composition)
            this.content.type = 'composite';
        this.content.modelDefaults = this.readDraftField('[data-agent-model-operation]', () => dependencies(runtime).readAgentModelDefaults(this.container, this.content?.modelDefaults));
        // 回写预设 Prompt 列表（过滤掉 name 和 prompt 均为空的行）
        this.collectPromptsToContent();
        this.content.defaultPrompts = (this.content.defaultPrompts ?? [])
            .filter(p => p.name.trim() !== '' || p.prompt.trim() !== '');
        const tempVal = parseFloat(getVal('temperature'));
        this.content.config = {
            ...this.content.config,
            imageProcessing: this.readDraftField('[name=imageMaxEdge]', () => dependencies(runtime).readAgentImageSettings(this.container)),
            systemPromptId: getVal('systemPromptId') || undefined,
            systemPrompt: getVal('systemPrompt'),
            maxHistoryLength: Number.isNaN(Number.parseInt(getVal('maxHistoryLength'))) ? -1 : Number.parseInt(getVal('maxHistoryLength')),
            mcpServers: undefined,
            temperature: !isNaN(tempVal) ? tempVal : undefined,
        };
        this.content.capabilityPolicy = dependencies(runtime).readAgentCapabilities(this.container, this.content.capabilityPolicy, this.defaultToolIds);
        if (this.content.systemPrompt !== undefined)
            this.content.systemPrompt = this.content.config.systemPrompt;
    }
    private async saveDraft(): Promise<void> {
        const runtime = this.settingsRuntime;
        await this.executionForm?.ready();
        const name = this.container.querySelector<HTMLInputElement>('[name="name"]')?.value.trim();
        if (!name) {
            this.revealField(this.container.querySelector<HTMLElement>('[name=name]')!);
            throw new (dependencies(runtime).SettingsValidationError)(dependencies(runtime).t('settings.autosave.invalid'));
        }
        this.syncModelFromUI();
        const draft = structuredClone(this.content!);
        const save = this.options.hostContext?.saveContent;
        const id = dependencies(runtime).editorResourceId(this.options);
        const registered = this.options.target?.kind !== 'file' || !!this.service.getAgentResourceId?.(draft.id);
        if (this.service.saveAgent && registered) {
            await this.service.saveAgent(draft);
            const canonical = await this.service.getAgentConfig?.(draft.id);
            if (canonical && this.content) {
                this.content.execution = canonical.execution;
                this.executionForm?.syncSaved(canonical);
            }
        }
        else if (save && id)
            await save(id, JSON.stringify(draft, null, 2));
        else
            await this.service.saveAgent(draft);
        this._isDirty = false;
        this.emit('saved', undefined);
    }
    private escapeHtml(str: string): string {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    // --- IEditor Interface Implementation ---
    async flushPendingSave(): Promise<void> {
        const runtime = this.settingsRuntime;
        await this.flushHostSettings();
        if (this.autoSave && !await this.autoSave.flush())
            throw new Error(dependencies(runtime).t('settings.autosave.leaveFailed'));
    }
    cancelPendingRender(): void { this.header?.cancelPendingAction(); }
    async destroy() {
        const runtime = this.settingsRuntime;
        this.publication?.assertCanClose();
        this.publication?.destroy();
        this.publication = undefined;
        this.header?.cancelPendingAction();
        await this.flushHostSettings();
        if (this.autoSave && !await this.autoSave.dispose())
            throw new Error(dependencies(runtime).t('settings.autosave.leaveFailed'));
        this.executionForm?.destroy();
        this.validationObserver?.disconnect();
        this.navigationEvents?.abort();
        await this.hostSettings?.destroy();
        this.hostSettings = undefined;
        this.header?.destroy();
        this.header = undefined;
        delete this.container.dataset.editorMobileNavigation;
        this.container.innerHTML = '';
        this.editorEvents.clear();
    }
    getMode(): 'edit' | 'render' { return 'edit'; }
    async switchToMode(_mode: 'edit' | 'render') { }
    setTitle(_title: string) { }
    setReadOnly(_readOnly: boolean) { }
    focus() {
        const nameInput = this.container.querySelector('.agent-header__name-input') as HTMLInputElement;
        nameInput?.focus();
    }
    get commands() { return {}; }
    async getHeadings(): Promise<Heading[]> { return []; }
    async getSearchableText() { return JSON.stringify(this.content || {}); }
    async getSummary() { return this.content?.description || null; }
    async navigateTo() { }
    async search(): Promise<UnifiedSearchResult[]> { return []; }
    gotoMatch() { }
    clearSearch() { }
    async collapseBlocks(): Promise<CollapseExpandResult> {
        return { affectedCount: 0, allCollapsed: true };
    }
    async expandBlocks(): Promise<CollapseExpandResult> {
        return { affectedCount: 0, allCollapsed: false };
    }
    async toggleBlocks(): Promise<CollapseExpandResult> {
        return this.collapseBlocks();
    }
    async pruneAssets(): Promise<number | null> {
        return null;
    }
    // Events
    on<E extends EditorEvent>(event: E, callback: EditorEventCallback<E>): () => void {
        return this.editorEvents.on(event, payload => callback(payload));
    }
    private emit<E extends EditorEvent>(event: E, payload: EditorEventMap[E]): void {
        this.editorEvents.emit(event, payload);
    }
}
function createDependencies(runtime: SettingsRuntime) { return { SettingsAutoSave: runtime.widgets.SettingsAutoSave, SettingsValidationError: runtime.widgets.SettingsValidationError, requestSettingsSave: runtime.widgets.requestSettingsSave, bindAgentImageSettings: bind0(runtime).bindAgentImageSettings, renderAgentImageSettings: bind0(runtime).renderAgentImageSettings, readAgentImageSettings: bind0(runtime).readAgentImageSettings, renderPromptReference: bind1(runtime).renderPromptReference, bindPromptReference: bind1(runtime).bindPromptReference, editorResourceId: runtime.widgets.editorResourceId, renderAgentExecution: bind2(runtime).renderAgentExecution, readAgentExecution: bind2(runtime).readAgentExecution, bindAgentExecution: bind2(runtime).bindAgentExecution, renderAgentModelDefaults: bind3(runtime).renderAgentModelDefaults, readAgentModelDefaults: bind3(runtime).readAgentModelDefaults, bindAgentModelDefaults: bind3(runtime).bindAgentModelDefaults, readAgentComposition: bind4(runtime).readAgentComposition, mountAgentHeader: bind5(runtime).mountAgentHeader, AgentPublicationController: bind6(runtime).AgentPublicationController, buildRenamedFilename: runtime.presentation.buildRenamedFilename, ACTION_ICONS: runtime.presentation.ACTION_ICONS, ENTITY_ICONS: runtime.presentation.ENTITY_ICONS, FILE_BROWSER_ICONS: runtime.presentation.FILE_BROWSER_ICONS, t: runtime.presentation.t, bindAgentCapabilities: bind10(runtime).bindAgentCapabilities, readAgentCapabilities: bind10(runtime).readAgentCapabilities, renderAgentCapabilities: bind10(runtime).renderAgentCapabilities }; }
export function bind(runtime: SettingsRuntime) { return { AgentConfigEditor: bindConstructor(AgentConfigEditor, runtime, 1) }; }

const dependencyCache = new WeakMap<SettingsRuntime, ReturnType<typeof createDependencies>>();
function dependencies(runtime: SettingsRuntime) {
    let value = dependencyCache.get(runtime);
    if (!value) { value = createDependencies(runtime); dependencyCache.set(runtime, value); }
    return value;
}
