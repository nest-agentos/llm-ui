import type { EditorOptions } from '../contracts/editor';
import type { SettingsRuntime } from '../runtime';
import { bindConstructor } from '../binding';
import { bind as bind0 } from './provider-layout';
import { bind as bind1 } from './provider-media-probe';
import { bind as bind2 } from './provider-api-reference';
import { bind as bind3 } from './provider-test-result';
import { bind as bind4 } from './model-reasoning-form';
import { bind as bind5 } from './provider-media-form';
import { bind as bind6 } from './provider-authorization';
import { bind as bind7 } from './provider-form';
import { bind as bind8 } from './configuration-form';
import { bind as bind9 } from '../utils/modelBadges';
import { bind as bind10 } from '../utils/modelChoice';
import { randomUUID as randomUUID } from '../identity';
import { shortUUID as generateShortUUID } from '../identity';
import { BaseSettingsEditor } from '../base-editor';
import { bind as bind14 } from './llm-import';
import type { ProviderAuthorizationPanel } from './provider-authorization';
import type { ApiProtocol, IConnectionService, MediaProbeExamples, ProviderAuthorizationState, LLMProvider, LLMModel, ModelCategory } from '../contracts/domain';
/** 模型用途分类选项（顺序即下拉顺序） */
const MODEL_CATEGORIES: ModelCategory[] = ['chat', 'image', 'video', 'audio', 'embedding'];
/** 能力 chip：[能力键, LLMModel 字段, emoji] */
const MODEL_CAP_CHIPS: ReadonlyArray<[
    string,
    keyof LLMModel
]> = [
    ['vision', 'supportsVision'], ['thinking', 'supportsThinking'], ['tools', 'supportsTools'],
    ['audio', 'supportsAudio'], ['video', 'supportsVideo'], ['structuredOutput', 'supportsStructuredOutput'],
];
export class ProviderSettingsEditor extends BaseSettingsEditor<IConnectionService> {
    protected supportsFormRecovery = true;
    protected captureRecoveryModel(): unknown {
        this.syncInputsToModelData();
        return structuredClone({ models: this.editModels, operations: this.editModels.map(model => this.modelOperationDrafts.get(model)),
            reasoning: this.editModels.map(model => this.reasoningDrafts.get(model)), clearStoredKey: this.clearStoredKey, modelSearch: this.modelSearch });
    }
    protected restoreRecoveryModel(snapshot: unknown): void {
        const state = structuredClone(snapshot) as {
            models: LLMModel[];
            operations: Array<string | undefined>;
            reasoning: Array<[
                string | undefined,
                string | undefined
            ] | undefined>;
            clearStoredKey: boolean;
            modelSearch: string;
        };
        this.editModels = state.models;
        this.clearStoredKey = state.clearStoredKey;
        this.modelSearch = state.modelSearch;
        this.editModels.forEach((model, index) => {
            if (state.operations[index] !== undefined)
                this.modelOperationDrafts.set(model, state.operations[index]!);
            if (state.reasoning[index])
                this.reasoningDrafts.set(model, state.reasoning[index]!);
        });
        this.renderModelList();
    }
    protected afterRestoreRecovery(): void {
        if (this.providerForm) {
            this.syncAuthorizationForm(this.providerForm);
            this.syncCatalogControls(this.providerForm);
        }
    }
    constructor(runtime: SettingsRuntime, container: HTMLElement, service: IConnectionService, options: EditorOptions, private readonly mediaProbeExamples: MediaProbeExamples = {}) { super(runtime, container, service, options); }
    private editModels: LLMModel[] = [];
    private reasoningDrafts = new WeakMap<LLMModel, [
        string | undefined,
        string | undefined
    ]>();
    private disposeMediaProbe?: () => void;
    private clearStoredKey = false;
    private modelOperationDrafts = new WeakMap<LLMModel, string>();
    private _checkedIds = new Set<string>();
    private currentProviderId?: string;
    private editingProvider?: LLMProvider;
    private modelSearch = '';
    private providerForm?: HTMLFormElement;
    private editGeneration = 0;
    private editorDisposed = false;
    private authorizationPanel?: ProviderAuthorizationPanel;
    private readonly authorizations = new Map<string, ProviderAuthorizationState>();
    private get formOnly(): boolean { return this.options.target?.kind === 'entity' && this.options.target.entityType === 'provider'; }
    protected override onServiceChange(): void {
        // Authorization has its own status subscription; keep callback drafts mounted.
        if (this.formOnly && this.providerForm)
            return;
        super.onServiceChange();
    }
    async render() {
        const runtime = this.settingsRuntime;
        if (!await this.prepareRender())
            return;
        const providers = this.service.getProviders();
        if (this.formOnly) {
            const target = this.options.target;
            const provider = providers.find(item => item.id === (target?.kind === 'entity' ? target.id : ''));
            if (provider)
                await this.loadEditModal(provider);
            else
                this.container.textContent = dependencies(runtime).t('toolbox.resourceMissing');
            return;
        }
        await Promise.all(providers.filter(provider => provider.implementation === 'chatgpt').map(async (provider) => {
            const state = await this.service.getProviderAuthorization?.(provider.id);
            if (state)
                this.authorizations.set(provider.id, state);
        }));
        // Sort: has-apiKey first → enabled first → alphabetical
        const keyedIds = new Set<string>();
        for (const p of providers) {
            if (p.hasApiKey || p.credentialMode === 'host' || this.authorizations.get(p.id)?.status === 'authorized')
                keyedIds.add(p.id);
        }
        const sorted = [...providers].sort((a, b) => {
            const aKey = keyedIds.has(a.id);
            const bKey = keyedIds.has(b.id);
            if (aKey && !bKey)
                return -1;
            if (!aKey && bKey)
                return 1;
            const aOn = a.enabled !== false;
            const bOn = b.enabled !== false;
            if (aOn && !bOn)
                return -1;
            if (!aOn && bOn)
                return 1;
            return (a.name || '').localeCompare(b.name || '');
        });
        const checkedCount = this._checkedIds.size;
        this.container.innerHTML = `
            <div class="settings-page">
                <div class="settings-page__header">
                    <div>
                        <h2 class="settings-page__title">Provider 配置</h2>
                        <p class="settings-page__description">
                            管理云提供商的模型目录、API 地址与 API Key（认证信息属于 Provider 层）。
                            连接在「LLM 连接」页把 Provider 绑定到 Agent 并设置模型层级。
                        </p>
                    </div>
                    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
                        <input type="file" id="llm-provider-import-file"
                               accept=".llm,.yaml,.yml" multiple style="display:none">
                        <button id="btn-import-provider-llm" class="settings-btn settings-btn--secondary"
                                title="从 .llm 文件导入 Provider 和连接">
                            ↑ 导入 .llm
                        </button>
                        <button id="btn-export-provider-llm" class="settings-btn settings-btn--secondary"
                                ${checkedCount === 0 ? 'disabled' : ''}
                                title="将选中 Provider 及其连接导出为 .llm 文件">
                            ↓ 导出${checkedCount > 0 ? ` (${checkedCount})` : ''}
                        </button>
                        <button id="btn-delete-provider-batch" class="settings-btn settings-btn--danger"
                                ${checkedCount === 0 ? 'disabled' : ''}
                                title="删除选中的自定义 Provider（内置 Provider 不可删除）">
                            🗑️ 删除${checkedCount > 0 ? ` (${checkedCount})` : ''}
                        </button>
                        <button id="btn-add-provider" class="settings-btn settings-btn--primary">
                            <span class="settings-btn__icon">+</span> 添加自定义
                        </button>
                    </div>
                </div>

                <div id="providers-list" class="settings-connection-grid">
                    ${sorted.map(p => this.renderProviderCard(p)).join('')}
                </div>
            </div>
        `;
        this.bindListEvents();
        this.consumeAnchor(sorted);
    }
    // ── Card ───────────────────────────────────────────────────────────────────
    private renderProviderCard(p: LLMProvider & {
        hasApiKey?: boolean;
    }): string {
        const runtime = this.settingsRuntime;
        const subscription = p.implementation === 'chatgpt', authorization = this.authorizations.get(p.id);
        const hasKey = subscription ? authorization?.status === 'authorized' : p.credentialMode === 'host' || p.hasApiKey === true;
        const enabled = p.enabled !== false;
        // A provider is "currently built-in" only if it exists in the live catalog.
        const currentBuiltins = this.service.getProviderDefaults?.() ?? {};
        const isCurrentBuiltin = !!currentBuiltins[p.id];
        const badge = isCurrentBuiltin
            ? '<span class="settings-badge settings-badge--info">内置</span>'
            : '<span class="settings-badge settings-badge--warning">自定义</span>';
        const keyBadge = hasKey
            ? ''
            : `<span class="settings-badge settings-badge--warning" style="font-size:0.7rem">${subscription ? dependencies(runtime).t('provider.auth.signed-out') : dependencies(runtime).t('connection.credentialsRequired')}</span>`;
        const disabledStyle = enabled ? '' : 'opacity:0.55;';
        const isChecked = this._checkedIds.has(p.id);
        return `
            <div class="settings-connection-card" data-id="${p.id}" style="${disabledStyle}">
                <div class="settings-connection-card__header">
                    <div style="display:flex;align-items:center;gap:6px;min-width:0">
                        <input type="checkbox" class="chk-provider-select" data-id="${p.id}"
                               ${isChecked ? 'checked' : ''}
                               title="选中以批量导出"
                               style="flex-shrink:0;cursor:pointer;width:15px;height:15px">
                        <h3 class="settings-connection-card__title"
                            style="margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
                            ${p.icon ?? ''} ${p.name}
                        </h3>
                    </div>
                    <div style="display:flex;gap:4px;flex-wrap:wrap;align-items:center">
                        ${badge}${keyBadge}
                        <label class="llm-enable-toggle" title="${enabled ? '点击禁用' : '点击启用'}">
                            <input type="checkbox" class="chk-provider-enabled" data-id="${p.id}"
                                   ${enabled ? 'checked' : ''} style="display:none">
                            <span class="llm-enable-toggle__track ${enabled ? 'llm-enable-toggle__track--on' : ''}">
                                <span class="llm-enable-toggle__thumb"></span>
                            </span>
                        </label>
                    </div>
                </div>

                <div class="settings-connection-card__details">
                    <div class="settings-detail-item">
                        <span class="settings-detail-item__label">Base URL</span>
                        <span class="settings-detail-item__value" style="font-size:0.75rem;word-break:break-all">
                            ${p.baseURL || '—'}
                        </span>
                    </div>
                    <div class="settings-detail-item">
                        <span class="settings-detail-item__label">${subscription ? dependencies(runtime).t('provider.auth.title') : 'API Key'}</span>
                        <span class="settings-detail-item__value">
                            ${subscription ? dependencies(runtime).t(`provider.auth.${authorization?.supported ? authorization.status : 'unsupported'}`) : p.credentialMode === 'host' ? dependencies(runtime).t('provider.credentials.host') : hasKey
            ? '<span style="color:var(--st-color-success,#10b981)">✓ 已配置</span>'
            : '<span style="color:var(--st-text-disabled)">未配置</span>'}
                        </span>
                    </div>
                </div>

                <div class="settings-page__actions" style="margin-top:auto;width:100%">
                    <button class="settings-btn settings-btn--secondary settings-btn--sm btn-edit-provider" style="flex:1">
                        ✏️ 编辑
                    </button>
                    ${isCurrentBuiltin
            ? '<button class="settings-btn settings-btn--danger settings-btn--sm btn-delete-provider" style="flex:1">🗑️ 删除</button>'
            : '<button class="settings-btn settings-btn--danger settings-btn--sm btn-delete-provider" style="flex:1">🗑️ 删除</button>'}
                </div>
            </div>
        `;
    }
    // ── List events ────────────────────────────────────────────────────────────
    /**
     * Consumes an optional one-shot navigation hint from the host.
     * If the anchor matches a provider id, highlights the card, scrolls it into view,
     * and opens the edit modal automatically. Clears the entry to avoid repeat triggers.
     */
    private consumeAnchor(providers: LLMProvider[]): void {
        const anchor = this.options.consumeAnchor?.('providers')?.anchor;
        if (!anchor) return;
            const provider = providers.find(p => p.id === anchor);
            if (!provider)
                return;
            // Highlight card and scroll into view
            const card = this.container.querySelector(`[data-id="${CSS.escape(anchor)}"]`) as HTMLElement | null;
            if (card) {
                card.classList.add('settings-card--anchored');
                card.scrollIntoView({ behavior: 'smooth', block: 'center' });
                setTimeout(() => card.classList.remove('settings-card--anchored'), 2000);
            }
            // Auto-open the edit modal
            setTimeout(() => this.showEditModal(provider), 120);
    }
    private bindListEvents() {
        this.clearListeners();
        this.bindButton('#btn-add-provider', () => this.showEditModal(null));
        this.bindButton('#btn-import-provider-llm', () => {
            (this.container.querySelector('#llm-provider-import-file') as HTMLInputElement)?.click();
        });
        this.bindButton('#btn-export-provider-llm', () => this.exportSelected());
        this.bindButton('#btn-delete-provider-batch', () => { void this.batchDelete(); });
        const fileInput = this.container.querySelector('#llm-provider-import-file') as HTMLInputElement | null;
        if (fileInput) {
            this.addEventListener(fileInput, 'change', async () => {
                if (fileInput.files?.length) {
                    await this.importLLMFiles(fileInput.files);
                    fileInput.value = '';
                }
            });
        }
        const list = this.container.querySelector('#providers-list');
        if (!list)
            return;
        // Multi-select checkbox
        this.addEventListener(list, 'change', async (e) => {
            const target = e.target as HTMLInputElement;
            if (target.classList.contains('chk-provider-select')) {
                const id = target.dataset.id!;
                if (target.checked)
                    this._checkedIds.add(id);
                else
                    this._checkedIds.delete(id);
                const count = this._checkedIds.size;
                const exportBtn = this.container.querySelector('#btn-export-provider-llm') as HTMLButtonElement | null;
                if (exportBtn) {
                    exportBtn.disabled = count === 0;
                    exportBtn.textContent = `↓ 导出${count > 0 ? ` (${count})` : ''}`;
                }
                const deleteBtn = this.container.querySelector('#btn-delete-provider-batch') as HTMLButtonElement | null;
                if (deleteBtn) {
                    deleteBtn.disabled = count === 0;
                    deleteBtn.textContent = `🗑️ 删除${count > 0 ? ` (${count})` : ''}`;
                }
                return;
            }
            // Enable/disable toggle
            if (target.classList.contains('chk-provider-enabled')) {
                const id = target.dataset.id!;
                const full = await this.service.getFullProvider?.(id);
                if (!full)
                    return;
                await this.service.saveProvider({ ...full, enabled: target.checked });
                this.render();
            }
        });
        this.addEventListener(list, 'click', async (e) => {
            const target = e.target as HTMLElement;
            // Don't intercept toggle/checkbox clicks
            if (target.closest('.llm-enable-toggle') || target.classList.contains('chk-provider-select'))
                return;
            const card = target.closest('[data-id]') as HTMLElement | null;
            if (!card)
                return;
            const id = card.dataset.id!;
            const providers = this.service.getProviders();
            const provider = providers.find(p => p.id === id);
            if (!provider)
                return;
            if (target.closest('.btn-edit-provider')) {
                this.showEditModal(provider);
            }
            else if (target.closest('.btn-delete-provider')) {
                void this.confirmDelete(provider);
            }
            else if (target.closest('.btn-reset-provider')) {
                this.confirmReset(provider);
            }
        });
    }
    // ── Import / Export ────────────────────────────────────────────────────────
    private async importLLMFiles(files: FileList): Promise<void> {
        const runtime = this.settingsRuntime;
        try {
            const imported = await dependencies(runtime).runLLMImport(files, this.service);
            if (imported)
                this.render();
        }
        catch (err) {
            console.error('LLM import failed:', err);
            dependencies(runtime).Toast.error(`导入失败: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    private async exportSelected(): Promise<void> {
        const runtime = this.settingsRuntime;
        const ids = [...this._checkedIds];
        if (!ids.length)
            return;
        const allProviders = this.service.getProviders();
        const providers = allProviders.filter(p => ids.includes(p.id));
        const allConns = await this.service.getConnections();
        const connections = allConns
            .filter(c => ids.includes(c.providerId))
            .map(c => dependencies(runtime).fromConnectionDef(c));
        const yamlStr = dependencies(runtime).exportBundleToLLM(providers, connections);
        const filename = providers.length === 1 ? `${providers[0].id}.llm` : 'providers-export.llm';
        const blob = new Blob([yamlStr], { type: 'text/yaml' });
        const a = Object.assign(document.createElement('a'), {
            href: URL.createObjectURL(blob), download: filename,
        });
        a.click();
        URL.revokeObjectURL(a.href);
    }
    private async batchDelete(): Promise<void> {
        await this.deleteProviders([...this._checkedIds]);
    }
    private async deleteProviders(ids: string[]): Promise<void> {
        if (!ids.length)
            return;
        const request = this.options.hostContext?.requestDelete;
        if (!request)
            throw new Error('Configuration deletion is not connected');
        await request(ids.map(id => ({ kind: 'entity', entityType: 'provider', id })));
        this._checkedIds.clear();
        await this.render();
    }
    // ── Edit modal ─────────────────────────────────────────────────────────────
    async destroy(): Promise<void> {
        this.disposeMediaProbe?.();
        this.authorizationPanel?.destroy();
        await super.destroy();
        this.editorDisposed = true;
        this.editGeneration++;
    }
    private showEditModal(provider: LLMProvider | null) {
        const runtime = this.settingsRuntime;
        void this.loadEditModal(provider).catch(error => dependencies(runtime).Toast.error(String(error)));
    }
    private async loadEditModal(provider: LLMProvider | null) {
        const runtime = this.settingsRuntime;
        this.disposeMediaProbe?.();
        this.authorizationPanel?.destroy();
        this.authorizationPanel = undefined;
        this.clearStoredKey = false;
        const generation = ++this.editGeneration;
        const isNew = !provider;
        const isBuiltin = !!provider?.isBuiltin;
        // Read safe Provider metadata; stored credentials are resolved by the host.
        const supplied = provider ? this.service.getProviders().find(item => item.id === provider.id) ?? provider : null;
        const { apiKey: storedKey, ...safeProvider } = supplied ?? {};
        const fullProvider = supplied ? { ...safeProvider, hasApiKey: !!storedKey || !!(supplied as LLMProvider & {
                hasApiKey?: boolean;
            }).hasApiKey } as LLMProvider & {
            hasApiKey: boolean;
        } : null;
        if (this.editorDisposed || generation !== this.editGeneration)
            return;
        this.currentProviderId = provider?.id;
        this.editingProvider = fullProvider ?? { id: `prov-${generateShortUUID()}`, name: '', implementation: 'openai-compatible', baseURL: '', models: [] };
        this.modelSearch = '';
        this.modelOperationDrafts = new WeakMap();
        this.providerForm = undefined;
        this.editModels = (fullProvider?.models ?? []).map(model => ({ ...model }));
        const hasStoredKey = fullProvider?.hasApiKey ?? false;
        const modalContent = `
            <form id="provider-form" class="settings-form provider-settings">
                <section data-provider-panel="overview">
                <div class="settings-form__group">
                    <label class="settings-form__label">Provider 名称 *</label>
                    <input type="text" class="settings-form__input" name="name"
                           value="${provider?.icon ? `${provider.icon} ${provider.name}` : (provider?.name ?? '')}"
                           required placeholder="如 🐋 DeepSeek（emoji 作为图标）">
                </div>

                <div class="settings-form__group">
                    <label class="settings-form__label">${dependencies(runtime).t('provider.form.implementation')}</label>
                    <select class="settings-form__select" name="implementation">
                        ${(['openai-compatible', 'chatgpt', 'anthropic', 'gemini', 'custom'] as const).map(type => `<option value="${type}" ${this.editingProvider?.implementation === type ? 'selected' : ''}>${dependencies(runtime).t(`provider.implementation.${type}`)}</option>`).join('')}
                    </select>
                </div>
                <section class="provider-authorization" data-provider-authorization hidden></section>
                <div class="settings-form__group" data-provider-api-key>
                    <div data-provider-key-input><label class="settings-form__label">API Key</label>
                    <input type="password" class="settings-form__input" name="apiKey"
                           value=""
                           placeholder="${hasStoredKey ? dependencies(runtime).t('provider.test.savedKey') : 'sk-...'}">
                    <small class="settings-form__help provider-settings__status" data-provider-credential-state>${dependencies(runtime).t(hasStoredKey ? 'provider.settings.configured' : 'provider.settings.unconfigured')}</small>
                    <label class="settings-form__help"><input type="checkbox" data-clear-provider-key>${dependencies(runtime).t('provider.test.clearKey')}</label>
                    </div><div data-provider-text-test ${dependencies(runtime).textTestModels(this.editingProvider).length ? '' : 'hidden'}>${dependencies(runtime).renderTextProbe(this.editingProvider)}
                    ${runtime.presentation.credentialHelp?.length ? `<details class="provider-settings__storage"><summary>${dependencies(runtime).t('provider.credentials.details')}</summary>${runtime.presentation.credentialHelp.map(text=>`<small class="settings-form__help">${runtime.presentation.escapeHTML(text)}</small>`).join('')}</details>` : ''}
                    <div style="margin-top:6px">
                        <button type="button" id="btn-test-provider"
                                class="settings-btn settings-btn--secondary settings-btn--sm" style="width:100%">
                            ${dependencies(runtime).ACTION_ICONS.test} ${dependencies(runtime).t('provider.protocol.testConnection')}
                        </button>
                    </div>
                    <div id="provider-test-result" style="display:none; margin-top:8px; padding:8px 10px; border-radius:4px; font-size:12px;"></div>
                    </div>
                </div>

                <div class="settings-form__group">
                    <label class="settings-form__label">Base URL *</label>
                    <input type="text" class="settings-form__input" name="baseURL"
                           value="${fullProvider?.baseURL ?? provider?.baseURL ?? ''}" required placeholder="https://api.example.com">
                    <small class="settings-form__help">${dependencies(runtime).t('provider.form.addressHelp')}</small>
                </div>

                </section>
                <section data-provider-panel="models">
                <h4 class="settings-section-title" style="display:flex;justify-content:space-between;align-items:center">
                    模型列表
                    <button type="button" id="btn-refresh-models" class="settings-btn settings-btn--xs settings-btn--secondary" ${this.editingProvider?.modelsPath === false && !this.presetModels().length ? 'disabled' : ''}>${dependencies(runtime).t(this.editingProvider?.modelsPath === false && this.presetModels().length ? 'provider.models.refreshPreset' : 'provider.models.refresh')}</button>
                    <button type="button" id="btn-add-model" class="settings-btn settings-btn--xs settings-btn--primary">+ 新增</button>
                </h4>
                <input type="search" id="provider-model-search" class="settings-form__input" placeholder="${dependencies(runtime).t('provider.models.search')}">
                <small id="provider-model-count" class="settings-form__help"></small>
                <div class="settings-model-list-container" id="model-list-container">
                    ${this.renderModelListHTML()}
                </div>
                <small class="settings-form__help" data-model-catalog-help>${dependencies(runtime).t(this.editingProvider?.modelsPath === false ? (this.presetModels().length ? 'provider.models.presetHelp' : 'provider.models.unavailable') : 'provider.models.help')}</small>
                </section>
                <section data-provider-panel="connections"><div data-provider-connections></div></section>
                <section data-provider-panel="advanced">${dependencies(runtime).renderProviderAdvanced(this.editingProvider)}${dependencies(runtime).renderProviderApiReference(this.service.getProviderReferences?.()[this.editingProvider.id])}</section>
            </form>
        `;
        dependencies(runtime).showConfigurationForm(this.container, isNew ? '添加 Provider' : provider!.name, modalContent, {
            width: '620px',
            confirmText: '',
            onAutoSave: save => this.trackAutoSave(save),
            onClose: () => { this.authorizationPanel?.destroy(); this.authorizationPanel = undefined; void this.render(); },
            onConfirm: async () => {
                const form = this.formElement('provider-form') as HTMLFormElement;
                if (!form.checkValidity())
                    return false;
                this.syncInputsToModelData();
                const formData = new FormData(form);
                const data = Object.fromEntries(formData) as Record<string, string>;
                const providerConfig = dependencies(runtime).readProviderForm(form, this.editingProvider!);
                if (dependencies(runtime).textTestModels(providerConfig).length && !providerConfig.supportedProtocols?.length) {
                    throw new (dependencies(runtime).SettingsValidationError)(dependencies(runtime).t('provider.protocol.required'));
                }
                if (this.editModels.some(model => model.preferredProtocol && !dependencies(runtime).getProviderProtocols(providerConfig).includes(model.preferredProtocol))) {
                    throw new (dependencies(runtime).SettingsValidationError)(dependencies(runtime).t('provider.protocol.unavailable'));
                }
                const newApiKey = (data.apiKey as string || '').trim();
                // 图标并入名称：以 emoji 开头的名称自动提取为 icon，其余为名称。
                const rawName = (data.name as string || '').trim();
                const emojiMatch = rawName.match(/^\p{Extended_Pictographic}/u);
                const name = emojiMatch ? rawName.slice(emojiMatch[0].length).trim() : rawName;
                if (!name)
                    throw new (dependencies(runtime).SettingsValidationError)(dependencies(runtime).t('settings.autosave.invalid'));
                const ids = this.editModels.map(model => model.id);
                if (new Set(ids).size !== ids.length)
                    throw new (dependencies(runtime).SettingsValidationError)(dependencies(runtime).t('provider.models.duplicateIds'));
                const icon = emojiMatch ? emojiMatch[0] : (provider?.icon ?? undefined);
                const updated: LLMProvider = {
                    // 保留未在表单中展示的 Provider 字段（capabilities.serverSideWebSearch、
                    // supportsThinking、requiresReferer、metadata 等），否则保存会静默丢失
                    // 内置联网搜索能力，导致 resolveWebSearch 判定失败。
                    ...providerConfig,
                    media: dependencies(runtime).readMediaEndpoints(form, providerConfig),
                    id: this.editingProvider!.id,
                    name,
                    icon,
                    implementation: providerConfig.implementation,
                    baseURL: providerConfig.baseURL,
                    defaultPath: providerConfig.defaultPath,
                    responsesPath: providerConfig.implementation === 'chatgpt' ? '/responses' : (data.responsesPath as string || '').trim() || undefined,
                    anthropicPath: providerConfig.implementation === 'chatgpt' ? undefined : (data.anthropicPath as string || '').trim() || undefined,
                    // Keep existing apiKey if field was left empty
                    apiKey: providerConfig.implementation === 'chatgpt' ? undefined : this.clearStoredKey ? '' : newApiKey || undefined,
                    models: structuredClone(this.collectModels(form)),
                    isBuiltin: isBuiltin,
                    enabled: this.formOnly ? data.enabled === 'on' : provider?.enabled,
                    defaultTemperature: (() => {
                        const v = parseFloat(data.defaultTemperature);
                        return !isNaN(v) ? v : undefined;
                    })(),
                    dailyCosts: provider?.dailyCosts,
                };
                await this.service.saveProvider(updated);
                this.editingProvider = { ...structuredClone(updated), apiKey: undefined, hasApiKey: !this.clearStoredKey && (!!newApiKey || hasSavedCredential(this.editingProvider) || hasStoredKey) } as LLMProvider;
                const key = form.querySelector<HTMLInputElement>('[name="apiKey"]')!;
                key.value = '';
                key.placeholder = hasSavedCredential(this.editingProvider) ? dependencies(runtime).t('provider.test.savedKey') : 'sk-...';
                form.querySelector('[data-provider-credential-state]')!.textContent = dependencies(runtime).t(hasSavedCredential(this.editingProvider) ? 'provider.settings.configured' : 'provider.settings.unconfigured');
                this.clearStoredKey = false;
                form.querySelector<HTMLInputElement>('[data-clear-provider-key]')!.checked = false;
                this.currentProviderId = updated.id;
                this.syncAuthorizationForm(form);
                const heading = this.container.querySelector('.settings-page__title');
                if (this.formOnly && heading)
                    heading.textContent = updated.name;
            },
        }, this.formOnly);
        this.providerForm = (this.formOnly ? this.container : document.body.lastElementChild)?.querySelector<HTMLFormElement>('#provider-form') ?? undefined;
        if (this.providerForm) {
            dependencies(runtime).mountProviderTabs(this.providerForm);
            this.disposeMediaProbe = dependencies(runtime).mountMediaProbe(this.providerForm, () => this.readDraft(), request => this.service.testConnection(request), this.mediaProbeExamples, this.service.getProviderReferences?.()[this.editingProvider!.id]);
            const connectionsForm = this.providerForm, connectionsStarted = performance.now(), connectionsOperationId = randomUUID();
            void this.loadConnections(connectionsForm).catch(error => {
                if (!connectionsForm.isConnected)
                    return;
                const root = connectionsForm.querySelector('[data-provider-connections]');
                if (root)
                    root.textContent = dependencies(runtime).t('provider.settings.connectionsFailed', { message: error instanceof Error ? error.message : String(error) });
                console.error('provider.connections.failed', { operation: 'provider.connections', operationId: connectionsOperationId, stage: 'query', code: 'PROVIDER_CONNECTIONS_QUERY', durationMs: Math.round(performance.now() - connectionsStarted) });
            });
        }
        if (this.formOnly) {
            this.bindModalEvents();
            dependencies(runtime).addConfigurationEnabled(this.container, provider?.enabled !== false);
            const enabled = this.providerForm?.querySelector('[name="enabled"]')?.closest('label');
            if (enabled) {
                enabled.classList.add('provider-settings__enabled');
                this.providerForm?.querySelector('[data-provider-panel="overview"]')?.prepend(enabled);
            }
            const related = provider && this.options.relatedConfiguration?.(provider.id);
            if (related) dependencies(runtime).addConfigurationAction(this.container,related.label,()=>{
                void this.flushPendingSave().then(()=>related.open(this.service)).catch(error=>dependencies(runtime).Toast.error(String(error)));
            });
            if (provider && isBuiltin)
                dependencies(runtime).addConfigurationAction(this.container, dependencies(runtime).t('toolbox.resetDefaults'), () => this.confirmReset(provider));
            if (provider)
                dependencies(runtime).addConfigurationAction(this.container, dependencies(runtime).t('action.delete'), () => { void this.confirmDelete(provider); });
        }
        else
            setTimeout(() => {
                if (!this.editorDisposed && generation === this.editGeneration)
                    this.bindModalEvents();
            }, 100);
    }

    private syncAuthorizationForm(form: HTMLFormElement): void {
        const runtime = this.settingsRuntime;
        const chatgpt = form.querySelector<HTMLSelectElement>('[name="implementation"]')?.value === 'chatgpt';
        dependencies(runtime).syncMediaDeclarations(form);
        const keyFields = form.querySelector<HTMLElement>('[data-provider-key-input]');
        if (keyFields)
            keyFields.hidden = this.editingProvider?.credentialMode === 'host';
        form.querySelector<HTMLElement>('[data-provider-api-key]')!.hidden = chatgpt;
        const root = form.querySelector<HTMLElement>('[data-provider-authorization]')!;
        root.hidden = !chatgpt;
        form.querySelector<HTMLElement>('[data-provider-advanced]')!.hidden = chatgpt;
        const url = form.querySelector<HTMLInputElement>('[name="baseURL"]')!;
        url.readOnly = chatgpt;
        if (chatgpt)
            url.value = 'https://api.openai.com/v1';
        if (!chatgpt) {
            this.authorizationPanel?.destroy();
            this.authorizationPanel = undefined;
            root.replaceChildren();
            return;
        }
        if (this.authorizationPanel)
            return;
        this.authorizationPanel = new (dependencies(runtime).ProviderAuthorizationPanel)(root, this.editingProvider!.id, this.service, async () => {
            const button = form.querySelector<HTMLButtonElement>('#btn-refresh-models')!;
            await this.refreshModels(button, form.querySelector('#model-list-container')!);
        });
        void this.authorizationPanel.init().catch(error => dependencies(runtime).Toast.error(String(error)));
    }
    private presetModels(): LLMModel[] {
        return this.service.getProviderDefaults?.()[this.editingProvider?.id ?? '']?.models ?? [];
    }
    private syncCatalogControls(form: HTMLFormElement): void {
        const runtime = this.settingsRuntime;
        const remote = dependencies(runtime).readProviderForm(form, this.editingProvider!).modelsPath !== false;
        const preset = !remote && this.presetModels().length > 0;
        const button = form.querySelector<HTMLButtonElement>('#btn-refresh-models');
        if (button) {
            button.disabled = !remote && !preset;
            button.textContent = dependencies(runtime).t(preset ? 'provider.models.refreshPreset' : 'provider.models.refresh');
        }
        const help = form.querySelector('[data-model-catalog-help]');
        if (help)
            help.textContent = dependencies(runtime).t(remote ? 'provider.models.help' : preset ? 'provider.models.presetHelp' : 'provider.models.unavailable');
    }
    private async readModelCatalog(form: HTMLFormElement, remote: boolean) {
        const runtime = this.settingsRuntime;
        const snapshot = dependencies(runtime).readProviderForm(form, this.editingProvider!);
        const models = remote ? await this.service.listProviderModels(snapshot) : structuredClone(this.presetModels());
        const current = dependencies(runtime).readProviderForm(form, this.editingProvider!);
        if (['implementation', 'baseURL', 'apiKey', 'modelsPath'].some(field => snapshot[field as keyof LLMProvider] !== current[field as keyof LLMProvider])) {
            throw Object.assign(new Error(dependencies(runtime).t('provider.models.configurationChanged')), { code: 'MODEL_CATALOG_CONFIGURATION_CHANGED' });
        }
        return { snapshot, models };
    }
    private mergeModelCatalog(form: HTMLFormElement, list: HTMLElement, snapshot: LLMProvider, models: LLMModel[]): number {
        const runtime = this.settingsRuntime;
        this.syncInputsToModelData();
        const added = snapshot.implementation === 'chatgpt' ? models.filter(model => !this.editModels.some(old => old.id === model.id)).length : this.appendModels(models);
        if (snapshot.implementation === 'chatgpt')
            this.editModels = models.map(model => ({ ...model }));
        this.renderModelList(list);
        dependencies(runtime).requestSettingsSave(form);
        return added;
    }
    private async refreshModels(button: HTMLButtonElement, list: HTMLElement): Promise<void> {
        const runtime = this.settingsRuntime;
        const form = button.closest('form')!;
        const remote = dependencies(runtime).readProviderForm(form, this.editingProvider!).modelsPath !== false;
        if (!remote && !this.presetModels().length)
            return;
        const started = performance.now(), operationId = randomUUID(), source = remote ? 'remote' : 'preset';
        console.info('provider.models.refresh.started', { operationId, source, stage: 'catalog', result: 'start' });
        button.disabled = true;
        button.textContent = dependencies(runtime).t('provider.models.refreshing');
        let stage = 'catalog';
        try {
            const { snapshot, models } = await this.readModelCatalog(form, remote);
            if (!button.isConnected)
                return;
            stage = 'merge';
            const added = this.mergeModelCatalog(form, list, snapshot, models);
            console.info('provider.models.refresh.completed', { operationId, source, stage, result: 'success',
                count: models.length, added, durationMs: Math.round(performance.now() - started) });
            dependencies(runtime).Toast.success(dependencies(runtime).t('provider.models.refreshed', { count: added, total: models.length, existing: models.length - added }));
        }
        catch (error) {
            const code = (error as {
                code?: unknown;
            })?.code;
            console.error('provider.models.refresh.failed', { operationId, source, stage, result: 'failure',
                code: typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(code) ? code : `PROVIDER_MODEL_${stage.toUpperCase()}_FAILED`,
                durationMs: Math.round(performance.now() - started) });
            dependencies(runtime).Toast.error(dependencies(runtime).t('provider.models.refreshFailed', { message: error instanceof Error ? error.message : String(error) }));
        }
        finally {
            button.disabled = false;
            button.textContent = dependencies(runtime).t('provider.models.refresh');
            this.syncCatalogControls(form);
        }
    }
    private appendModels(entries: LLMModel[]): number {
        const ids = new Set(this.editModels.map(model => model.id));
        let added = 0;
        for (const entry of entries) {
            if (!entry || typeof entry !== 'object' || !('id' in entry) || typeof entry.id !== 'string')
                continue;
            const id = entry.id.trim();
            if (!id)
                continue;
            if (ids.has(id)) {
                const existing = this.editModels.find(model => model.id === id)!;
                for (const field of ['category', 'supportsVision', 'supportsThinking', 'supportsTools', 'supportsAudio', 'supportsVideo', 'supportsStructuredOutput', 'contextWindow', 'maxOutput', 'operations', 'supportedOperations', 'reasoning', 'reasoningByProtocol', 'capabilitiesKnown'] as const)
                    if (entry[field] !== undefined && !(field === 'capabilitiesKnown' && entry[field] === false)
                        && !(field === 'reasoning' && existing.reasoning && existing.reasoning.source === 'user'))
                        (existing as unknown as Record<string, unknown>)[field] = field === 'reasoning' && existing.reasoning && entry.reasoning
                            ? { ...existing.reasoning, ...entry.reasoning } : field === 'reasoningByProtocol'
                            ? { ...entry.reasoningByProtocol, ...existing.reasoningByProtocol } : entry[field];
                continue;
            }
            this.editModels.push({ ...entry, id });
            ids.add(id);
            added++;
        }
        return added;
    }
    private renderModelListHTML(): string {
        const runtime = this.settingsRuntime;
        if (this.editModels.length === 0) {
            return '<div class="settings-empty-small">暂无模型，请添加</div>';
        }
        return this.editModels.map((m, i) => `
            <div class="settings-model-item" ${this.matchesModelSearch(m) ? '' : 'hidden style="display:none"'}>
                <div class="settings-model-item__drag">::</div>
                <div class="settings-model-item__content" style="flex-direction:column;gap:4px;align-items:stretch">
                    <div class="settings-model-item__identity">
                        <input type="text" class="settings-input-sm model-id-input" data-idx="${i}"
                               required value="${dependencies(runtime).escapeAttr(m.id)}" placeholder="Model ID" title="Model ID（API 用）">
                        <input type="text" class="settings-input-sm model-name-input" data-idx="${i}"
                               value="${dependencies(runtime).escapeAttr(m.name)}" placeholder="显示名称">
                        <span class="settings-model-item__capabilities" data-model-capabilities>${dependencies(runtime).renderModelCapabilityBadges(m)}</span>
                    </div>
                    <details><summary>${dependencies(runtime).t('provider.models.details')}</summary>
                    ${dependencies(runtime).renderMediaDeclaration(m.operations, true, this.modelOperationDrafts.get(m))}
                    ${dependencies(runtime).renderReasoningDeclaration(m, ...this.reasoningDrafts.get(m) ?? [])}
                    <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
                        <select class="settings-input-sm model-category-select" data-idx="${i}" title="模型用途" style="max-width:110px">
                            <option value="" ${!m.category ? 'selected' : ''}>${dependencies(runtime).t('provider.models.categoryUnknown')}</option>
                            ${MODEL_CATEGORIES.map(cat => `
                                <option value="${cat}" ${m.category === cat ? 'selected' : ''}>${cat}</option>
                            `).join('')}
                        </select>
                        <label>${dependencies(runtime).t('provider.models.preferredProtocol')}
                            <select class="settings-input-sm model-protocol-select" data-idx="${i}">
                                ${this.renderModelProtocolOptions(m.preferredProtocol)}
                            </select>
                        </label>
                        <select class="settings-input-sm model-thinking-select" data-idx="${i}" title="Thinking 模式" style="max-width:110px">
                            <option value="" ${!m.thinkingMode ? 'selected' : ''}>think: auto</option>
                            <option value="enabled" ${m.thinkingMode === 'enabled' ? 'selected' : ''}>think: on</option>
                            <option value="disabled" ${m.thinkingMode === 'disabled' ? 'selected' : ''}>think: off</option>
                        </select>
                        ${MODEL_CAP_CHIPS.map(([cap, field]) => `
                            <label class="model-cap-chip" title="${cap}"
                                   style="display:inline-flex;align-items:center;cursor:pointer;font-size:13px;padding:2px 4px;border-radius:4px;opacity:${m[field] === true ? '1' : '0.35'}">
                                <input type="checkbox" class="model-cap-chk" data-cap="${cap}" data-idx="${i}"
                                       ${m[field] === true ? 'checked' : ''} style="display:none">
                                ${dependencies(runtime).MODEL_CAPABILITY_META[cap].icon}
                            </label>
                        `).join('')}
                    </div></details>
                </div>
                <div class="settings-model-item__actions">
                    <button type="button" class="btn-icon btn-up"   data-idx="${i}" ${i === 0 ? 'disabled' : ''}>⬆️</button>
                    <button type="button" class="btn-icon btn-down" data-idx="${i}" ${i === this.editModels.length - 1 ? 'disabled' : ''}>⬇️</button>
                    <button type="button" class="btn-icon btn-del text-danger" data-idx="${i}">✖️</button>
                </div>
            </div>
        `).join('');
    }
    // ── Modal events ───────────────────────────────────────────────────────────
    private formElement(id: string): HTMLElement | null {
        if (id === 'provider-form')
            return this.providerForm ?? null;
        return this.providerForm?.querySelector<HTMLElement>('#' + id) ?? null;
    }
    private renderModelList(list = this.formElement('model-list-container')): void {
        const runtime = this.settingsRuntime;
        if (!list)
            return;
        list.innerHTML = this.renderModelListHTML();
        this.updateModelCount();
        this.refreshTextModels();
        if (this.providerForm)
            dependencies(runtime).syncMediaDeclarations(this.providerForm);
    }
    private refreshTextModels(): void {
        const runtime = this.settingsRuntime;
        const select = this.providerForm?.querySelector<HTMLSelectElement>('[name="connectionTestModel"]');
        if (!select)
            return;
        const previous = select.value, models = dependencies(runtime).textTestModels({ ...this.editingProvider!, models: this.editModels });
        select.replaceChildren(...models.map(model => new Option(`${model.name} · ${model.id}`, model.id)));
        if (models.some(model => model.id === previous))
            select.value = previous;
        select.disabled = !models.length;
        const chat = this.providerForm?.querySelector<HTMLElement>('[data-provider-chat-settings]');
        if (chat)
            chat.hidden = !models.length;
        const test = this.providerForm?.querySelector<HTMLElement>('[data-provider-text-test]');
        if (test)
            test.hidden = !models.length;
        if (!models.length)
            select.add(new Option(dependencies(runtime).t('provider.test.noTextModel'), ''));
    }
    private bindModalEvents() {
        const runtime = this.settingsRuntime;
        if (!this.providerForm?.isConnected || this.editorDisposed)
            return;
        const form = this.providerForm;
        const listContainer = this.formElement('model-list-container') as HTMLElement | null;
        const addModelBtn = this.formElement('btn-add-model') as HTMLButtonElement | null;
        const renderList = () => {
            if (!listContainer)
                return;
            this.renderModelList(listContainer);
            if (this.providerForm)
                dependencies(runtime).requestSettingsSave(this.providerForm);
        };
        this.bindProviderControls();
        this.updateModelCount();
        // Test API Key button
        const testBtn = this.formElement('btn-test-provider') as HTMLButtonElement | null;
        const testResult = this.formElement('provider-test-result') as HTMLElement | null;
        if (testBtn && testResult) {
            testBtn.addEventListener('click', async () => {
                if (testBtn.disabled)
                    return;
                const form = this.formElement('provider-form') as HTMLFormElement;
                this.syncInputsToModelData();
                let definition: LLMProvider;
                try {
                    definition = this.readDraft();
                }
                catch (error) {
                    testResult.textContent = error instanceof Error ? error.message : String(error);
                    testResult.style.display = 'block';
                    return;
                }
                const apiKey = definition.apiKey;
                const provId = this.currentProviderId ?? 'custom';
                const baseURL = ((form.querySelector('[name="baseURL"]') as HTMLInputElement)?.value || '').trim();
                const models = this.editModels;
                const model = form.querySelector<HTMLSelectElement>('[name="connectionTestModel"]')?.value;
                if (!model) {
                    testResult.textContent = dependencies(runtime).t('provider.test.noTextModel');
                    testResult.style.display = 'block';
                    return;
                }
                if (!apiKey && !hasSavedCredential(this.editingProvider) && definition.credentialMode !== 'host') {
                    testResult.style.cssText = 'display:block;padding:8px;border-radius:4px;background:var(--st-warning-bg,#fff3cd);color:var(--st-warning,#856404);font-size:12px';
                    testResult.textContent = '⚠️ 请先填写 API Key';
                    return;
                }
                testBtn.disabled = true;
                testBtn.textContent = '⏳ 测试中...';
                testResult.style.display = 'none';
                try {
                    const r = await this.service.testConnection({ provider: provId, apiKey, baseURL, model,
                        protocol: models.find(item => item.id === model)?.preferredProtocol ?? definition.defaultProtocol, providerDefinition: definition });
                    testResult.style.cssText = `display:block;padding:8px;border-radius:4px;font-size:12px;background:${r.success ? 'var(--st-success-bg,#d4edda)' : 'var(--st-danger-bg,#f8d7da)'};color:${r.success ? 'var(--st-success,#155724)' : 'var(--st-danger,#721c24)'}`;
                    if (JSON.stringify(definition) !== JSON.stringify(this.readDraft())) {
                        testResult.textContent = dependencies(runtime).t('provider.test.stale');
                        return;
                    }
                    testResult.textContent = dependencies(runtime).providerTestResult(r);
                }
                catch (e: unknown) {
                    testResult.style.cssText = 'display:block;padding:8px;border-radius:4px;font-size:12px;background:var(--st-danger-bg,#f8d7da);color:var(--st-danger,#721c24)';
                    testResult.textContent = `❌ 测试出错: ${e instanceof Error ? e.message : String(e)}`;
                }
                finally {
                    testBtn.disabled = false;
                    testBtn.textContent = dependencies(runtime).t('provider.protocol.testConnection');
                }
            });
        }
        const refreshBtn = this.formElement('btn-refresh-models') as HTMLButtonElement | null;
        if (refreshBtn)
            form.querySelector('[name="modelsPath"]')?.addEventListener('input', () => {
                this.syncCatalogControls(form);
            });
        refreshBtn?.addEventListener('click', () => {
            if (!refreshBtn.disabled && listContainer)
                void this.refreshModels(refreshBtn, listContainer);
        });
        // Add model
        addModelBtn?.addEventListener('click', () => {
            this.syncInputsToModelData();
            this.editModels.push({ id: '', name: '', category: 'chat' });
            renderList();
            listContainer?.scrollTo({ top: listContainer.scrollHeight, behavior: 'smooth' });
        });
        // Model list actions (up/down/delete)
        listContainer?.addEventListener('click', (e) => {
            const btn = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
            if (!btn)
                return;
            const idx = parseInt(btn.dataset.idx!);
            if (isNaN(idx))
                return;
            this.syncInputsToModelData();
            if (btn.classList.contains('btn-del')) {
                this.editModels.splice(idx, 1);
            }
            else if (btn.classList.contains('btn-up') && idx > 0) {
                [this.editModels[idx], this.editModels[idx - 1]] = [this.editModels[idx - 1], this.editModels[idx]];
            }
            else if (btn.classList.contains('btn-down') && idx < this.editModels.length - 1) {
                [this.editModels[idx], this.editModels[idx + 1]] = [this.editModels[idx + 1], this.editModels[idx]];
            }
            renderList();
        });
        // Capability chip toggle — visual feedback (dim when unchecked)
        listContainer?.addEventListener('change', (e) => {
            const chk = e.target as HTMLElement;
            if (chk.classList.contains('model-category-select')) {
                this.editModels[Number(chk.dataset.idx)].capabilitiesKnown = true;
                this.syncInputsToModelData();
                this.refreshTextModels();
            }
            if (!chk.classList.contains('model-cap-chk'))
                return;
            const label = chk.closest('.model-cap-chip') as HTMLElement | null;
            if (label)
                label.style.opacity = (chk as HTMLInputElement).checked ? '1' : '0.35';
            this.syncInputsToModelData();
            const badges = chk.closest('.settings-model-item')?.querySelector('[data-model-capabilities]');
            if (badges)
                badges.innerHTML = dependencies(runtime).renderModelCapabilityBadges(this.editModels[Number(chk.dataset.idx)]);
        });
    }
    private readDraft(): LLMProvider {
        const runtime = this.settingsRuntime;
        const form = this.providerForm!;
        this.syncInputsToModelData();
        const provider = dependencies(runtime).readProviderForm(form, this.editingProvider!);
        return { ...provider, apiKey: this.clearStoredKey ? '' : provider.apiKey, media: dependencies(runtime).readMediaEndpoints(form, provider), models: structuredClone(this.collectModels(form)) };
    }
    private async loadConnections(form: HTMLFormElement): Promise<void> {
        const runtime = this.settingsRuntime;
        const root = form.querySelector<HTMLElement>('[data-provider-connections]')!;
        const connections = (await this.service.getConnections?.() ?? []).filter(item => item.providerId === this.editingProvider?.id);
        if (!form.isConnected)
            return;
        if (!connections.length) {
            root.textContent = dependencies(runtime).t('provider.settings.connectionsEmpty');
            return;
        }
        for (const connection of connections) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'provider-settings__connection';
            const title = document.createElement('strong');
            title.textContent = connection.name;
            const detail = document.createElement('small');
            detail.textContent = Object.entries(connection.tiers ?? {}).map(([tier, model]) => `${tier}: ${model}`).join(' · ');
            button.append(title, detail);
            button.onclick = () => { void this.options.navigation?.open('/connections/' + encodeURIComponent(connection.id)); };
            root.append(button);
        }
    }
    private renderModelProtocolOptions(selected?: ApiProtocol): string {
        const runtime = this.settingsRuntime;
        const form = this.providerForm?.isConnected ? this.providerForm : undefined;
        const provider = form ? dependencies(runtime).readProviderForm(form, this.editingProvider!) : this.editingProvider;
        if (!provider)
            return '<option value=""></option>';
        return dependencies(runtime).renderProtocolOptions(provider, selected).replace(/<option value="">.*?<\/option>/, `<option value="">${dependencies(runtime).t('provider.models.inheritProtocol')}</option>`);
    }
    private refreshModelProtocolOptions(form: HTMLFormElement): void {
        this.syncInputsToModelData();
        form.querySelectorAll<HTMLSelectElement>('.model-protocol-select').forEach((select, index) => {
            select.innerHTML = this.renderModelProtocolOptions(this.editModels[index].preferredProtocol);
        });
    }
    private matchesModelSearch(model: LLMModel): boolean {
        const runtime = this.settingsRuntime;
        return dependencies(runtime).matchesModelQuery(model, this.modelSearch);
    }
    private updateModelCount(): void {
        const runtime = this.settingsRuntime;
        const count = this.formElement('provider-model-count');
        if (count)
            count.textContent = dependencies(runtime).t('provider.models.count', { total: this.editModels.length,
                visible: this.editModels.filter(model => this.matchesModelSearch(model)).length });
    }
    private bindTestInvalidation(form: HTMLFormElement): void {
        const runtime = this.settingsRuntime;
        dependencies(runtime).bindMediaDeclarations(form);
        dependencies(runtime).bindReasoningFields(form);
        form.addEventListener('change', event => {
            if ((event.target as HTMLElement).matches('[data-clear-provider-key]'))
                this.clearStoredKey = (event.target as HTMLInputElement).checked;
        });
        form.addEventListener('input', event => {
            const input = event.target as HTMLInputElement;
            if (input.matches('.model-id-input, .model-name-input')) {
                this.syncInputsToModelData();
                this.refreshTextModels();
            }
            if (!input.closest('[data-probe-fields]') && input.tagName !== 'BUTTON') {
                const result = form.querySelector<HTMLElement>('#provider-test-result');
                if (result)
                    result.textContent = dependencies(runtime).t('provider.test.stale');
            }
            form.querySelectorAll<HTMLElement>('[data-protocol-result]').forEach(result => {
                result.textContent = dependencies(runtime).t('provider.protocol.unverified');
            });
            const result = form.querySelector<HTMLElement>('#provider-test-result');
            if (result)
                result.style.display = 'none';
        });
    }
    private bindModelSearch(form: HTMLFormElement): void {
        form.querySelector('#provider-model-search')?.addEventListener('input', event => {
            this.syncInputsToModelData();
            this.modelSearch = (event.target as HTMLInputElement).value.toLowerCase().trim();
            this.renderModelList();
        });
    }
    private bindProviderControls(): void {
        const runtime = this.settingsRuntime;
        const form = this.formElement('provider-form') as HTMLFormElement;
        this.providerForm = form;
        this.bindModelSearch(form);
        this.bindTestInvalidation(form);
        form.querySelector('#provider-add-protocol')?.addEventListener('change', event => {
            const select = event.target as HTMLSelectElement;
            const checkbox = form.querySelector<HTMLInputElement>(`[name="supportedProtocols"][value="${select.value}"]`);
            if (checkbox)
                checkbox.checked = true;
            select.value = '';
            dependencies(runtime).syncProtocolControls(form);
            this.refreshModelProtocolOptions(form);
        });
        form.querySelector('#provider-protocols')?.addEventListener('change', () => {
            dependencies(runtime).syncProtocolControls(form);
            this.refreshModelProtocolOptions(form);
        });
        form.querySelector('[name="implementation"]')?.addEventListener('change', () => {
            this.syncAuthorizationForm(form);
            const primary = dependencies(runtime).getPrimaryProtocol(dependencies(runtime).readProviderForm(form, this.editingProvider!));
            form.querySelectorAll<HTMLInputElement>('[name="supportedProtocols"]').forEach(input => { input.checked = input.value === primary; });
            dependencies(runtime).syncProtocolControls(form);
            this.refreshModelProtocolOptions(form);
        });
        this.syncAuthorizationForm(form);
        form.querySelectorAll<HTMLButtonElement>('[data-test-protocol]').forEach(button => {
            button.addEventListener('click', () => { void this.testProtocol(form, button); });
        });
    }
    private async testProtocol(form: HTMLFormElement, button: HTMLButtonElement): Promise<void> {
        const runtime = this.settingsRuntime;
        const protocol = button.dataset.testProtocol as ApiProtocol;
        const result = form.querySelector<HTMLElement>(`[data-protocol-result="${protocol}"]`)!;
        this.syncInputsToModelData();
        const definition = this.readDraft();
        button.disabled = true;
        result.textContent = dependencies(runtime).t('provider.protocol.testing');
        try {
            const response = await this.service.testConnection({ provider: definition.id,
                apiKey: definition.apiKey, baseURL: definition.baseURL, model: form.querySelector<HTMLSelectElement>('[name="connectionTestModel"]')?.value,
                protocol, providerDefinition: definition });
            if (JSON.stringify(definition) !== JSON.stringify(this.readDraft())) {
                result.textContent = dependencies(runtime).t('provider.test.stale');
                return;
            }
            result.textContent = dependencies(runtime).providerTestResult(response);
        }
        catch (error) {
            result.textContent = `${dependencies(runtime).t('provider.protocol.failed')}: ${error instanceof Error ? error.message : String(error)}`;
        }
        finally {
            button.disabled = false;
        }
    }
    // ── Sync helpers ───────────────────────────────────────────────────────────
    private collectModels(form: HTMLFormElement): LLMModel[] {
        const runtime = this.settingsRuntime;
        const rows = form.querySelectorAll('.settings-model-item');
        const models = this.editModels.map((model, index) => {
            const operations = dependencies(runtime).readModelOperations(rows[index], model);
            return { ...model, ...dependencies(runtime).readReasoningDeclaration(rows[index]), operations, ...(operations ? { capabilitiesKnown: true } : {}) };
        });
        // Keep validated values when a later implementation change disables their controls.
        models.forEach((model, index) => { this.editModels[index].operations = model.operations; });
        return models;
    }
    private syncInputsToModelData() {
        const container = this.formElement('model-list-container');
        if (!container)
            return;
        const capMap: Record<string, keyof LLMModel> = {
            vision: 'supportsVision', thinking: 'supportsThinking', tools: 'supportsTools',
            audio: 'supportsAudio',
            video: 'supportsVideo',
            structuredOutput: 'supportsStructuredOutput',
        };
        container.querySelectorAll('.settings-model-item').forEach((row, i) => {
            if (i >= this.editModels.length)
                return;
            const idEl = row.querySelector('.model-id-input') as HTMLInputElement | null;
            const nameEl = row.querySelector('.model-name-input') as HTMLInputElement | null;
            if (idEl)
                this.editModels[i].id = idEl.value.trim();
            if (nameEl)
                this.editModels[i].name = nameEl.value.trim() || this.editModels[i].id;
            const catEl = row.querySelector('.model-category-select') as HTMLSelectElement | null;
            if (catEl)
                this.editModels[i].category = (catEl.value as ModelCategory) || undefined;
            const protocolEl = row.querySelector('.model-protocol-select') as HTMLSelectElement | null;
            if (protocolEl)
                this.editModels[i].preferredProtocol = (protocolEl.value as ApiProtocol) || undefined;
            const thinkEl = row.querySelector('.model-thinking-select') as HTMLSelectElement | null;
            if (thinkEl) {
                const val = thinkEl.value as 'auto' | 'enabled' | 'disabled' | '';
                this.editModels[i].thinkingMode = val || undefined;
            }
            this.captureDeclarationDrafts(row, this.editModels[i]);
            const model = this.editModels[i] as unknown as Record<string, unknown>;
            row.querySelectorAll('.model-cap-chk').forEach((chk) => {
                const el = chk as HTMLInputElement;
                const field = capMap[el.dataset.cap ?? ''];
                if (field && el.checked !== (model[field] === true)) {
                    model[field] = el.checked;
                    model.capabilitiesKnown = true;
                }
            });
        });
    }
    private captureDeclarationDrafts(row: Element, model: LLMModel): void {
        const operations = declarationDraft(row, 'modelOperations', model.operations ?? {});
        if (operations === undefined)
            this.modelOperationDrafts.delete(model);
        else
            this.modelOperationDrafts.set(model, operations);
        const reasoning = declarationDraft(row, 'modelReasoning', model.reasoning ?? null);
        const protocols = declarationDraft(row, 'modelReasoningByProtocol', model.reasoningByProtocol ?? {});
        if (reasoning === undefined && protocols === undefined)
            this.reasoningDrafts.delete(model);
        else
            this.reasoningDrafts.set(model, [reasoning, protocols]);
    }
    // ── Delete / Reset ─────────────────────────────────────────────────────────
    private async confirmDelete(provider: LLMProvider): Promise<void> {
        await this.discardAutoSave();
        await this.deleteProviders([provider.id]);
    }
    private confirmReset(provider: LLMProvider) {
        const runtime = this.settingsRuntime;
        dependencies(runtime).Modal.confirm('确认重置', `将「${provider.name}」恢复为内置默认配置（BaseURL / 模型列表），确定继续？`, async () => {
            await this.discardAutoSave();
            // Re-save from built-in constant (getProviderDefaults returns raw constant values)
            const defaults = this.service.getProviderDefaults();
            const def = defaults[provider.id];
            if (!def) {
                dependencies(runtime).Toast.error('找不到内置默认配置');
                return;
            }
            await this.service.saveProvider({ ...def, id: provider.id, isBuiltin: true });
            dependencies(runtime).Toast.success('已恢复默认配置');
            this.render();
        });
    }
    // ── Utility ────────────────────────────────────────────────────────────────
    private bindButton(selector: string, handler: () => void) {
        const btn = this.container.querySelector(selector);
        if (btn)
            this.addEventListener(btn, 'click', handler);
    }
}
function hasSavedCredential(provider: LLMProvider | undefined): boolean {
    return !!(provider as LLMProvider & {
        hasApiKey?: boolean;
    } | undefined)?.hasApiKey;
}
/** Only authored changes override later catalog values; invalid drafts stay editable. */
function declarationDraft(row: Element, name: string, baseline: unknown): string | undefined {
    const field = row.querySelector<HTMLTextAreaElement>(`[name="${name}"]`);
    if (!field)
        return;
    try {
        if (JSON.stringify(JSON.parse(field.value)) === JSON.stringify(baseline))
            return;
    }
    catch { /* Preserve malformed input until the user corrects it. */ }
    return field.value;
}
function createDependencies(runtime: SettingsRuntime) { return { mountProviderTabs: bind0(runtime).mountProviderTabs, renderTextProbe: bind0(runtime).renderTextProbe, textTestModels: bind0(runtime).textTestModels, mountMediaProbe: bind1(runtime).mountMediaProbe, renderProviderApiReference: bind2(runtime).renderProviderApiReference, providerTestResult: bind3(runtime).providerTestResult, bindReasoningFields: bind4(runtime).bindReasoningFields, readReasoningDeclaration: bind4(runtime).readReasoningDeclaration, renderReasoningDeclaration: bind4(runtime).renderReasoningDeclaration, renderMediaDeclaration: bind5(runtime).renderMediaDeclaration, readMediaEndpoints: bind5(runtime).readMediaEndpoints, readModelOperations: bind5(runtime).readModelOperations, bindMediaDeclarations: bind5(runtime).bindMediaDeclarations, syncMediaDeclarations: bind5(runtime).syncMediaDeclarations, SettingsValidationError: runtime.widgets.SettingsValidationError, ProviderAuthorizationPanel: bind6(runtime).ProviderAuthorizationPanel, readProviderForm: bind7(runtime).readProviderForm, renderProviderAdvanced: bind7(runtime).renderProviderAdvanced, syncProtocolControls: bind7(runtime).syncProtocolControls, renderProtocolOptions: bind7(runtime).renderProtocolOptions, getPrimaryProtocol: runtime.rules.getPrimaryProtocol, getProviderProtocols: runtime.rules.getProviderProtocols, showConfigurationForm: bind8(runtime).showConfigurationForm, addConfigurationAction: bind8(runtime).addConfigurationAction, addConfigurationEnabled: bind8(runtime).addConfigurationEnabled, t: runtime.presentation.t, escapeAttr: runtime.presentation.escapeAttr, ACTION_ICONS: runtime.presentation.ACTION_ICONS, MODEL_CAPABILITY_META: runtime.presentation.MODEL_CAPABILITY_META, renderModelCapabilityBadges: bind9(runtime).renderModelCapabilityBadges, matchesModelQuery: bind10(runtime).matchesModelQuery, requestSettingsSave: runtime.widgets.requestSettingsSave, Modal: runtime.widgets.Modal, Toast: runtime.widgets.Toast, exportBundleToLLM: runtime.rules.exportBundleToLLM, fromConnectionDef: runtime.rules.fromConnectionDef, runLLMImport: bind14(runtime).runLLMImport }; }
export function bind(runtime: SettingsRuntime) { return { ProviderSettingsEditor: bindConstructor(ProviderSettingsEditor, runtime, 2) }; }

const dependencyCache = new WeakMap<SettingsRuntime, ReturnType<typeof createDependencies>>();
function dependencies(runtime: SettingsRuntime) {
    let value = dependencyCache.get(runtime);
    if (!value) { value = createDependencies(runtime); dependencyCache.set(runtime, value); }
    return value;
}
