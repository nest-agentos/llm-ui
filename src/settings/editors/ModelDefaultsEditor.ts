import type { SettingsRuntime } from '../runtime';
import { bindConstructor } from '../binding';
import { bind as bind0 } from '../components/OcrSettingsForm';
import { BaseSettingsEditor } from '../base-editor';
import { bind as bind2 } from '../utils/modelChoice';
import { bind as bind3 } from '../utils/modelBadges';
import { bind as bind4 } from '../utils/modelPrice';
import './model-defaults.css';
import type { OcrControls, IConnectionService, ModelDefaults, ModelOperation, ConnectionMeta, LLMProvider, ModelPricingConfig } from '../contracts/domain';
import type { OcrSettingsForm } from '../components/OcrSettingsForm';
import type { EditorOptions } from '../contracts/editor';
export class ModelDefaultsEditor extends BaseSettingsEditor<IConnectionService> {
    protected supportsFormRecovery = true;
    private connections: ConnectionMeta[] = [];
    private providers: LLMProvider[] = [];
    private defaults: ModelDefaults = {};
    private pending?: Promise<void>;
    private closed = false;
    private generation = 0;
    private fingerprint?: string;
    private readFailed = false;
    private ocrForm?: OcrSettingsForm;
    private pricing?: ModelPricingConfig;
    private recoveringDraft = false;
    private readonly ocrContainer = document.createElement('section');
    constructor(runtime: SettingsRuntime, container: HTMLElement, service: IConnectionService, options: EditorOptions, private readonly ocr?: OcrControls) { super(runtime, container, service, options); }
    protected onServiceChange(): void {
        if (!this.pending && !this.recoveringDraft)
            void this.render();
    }
    async render(): Promise<void> {
        const runtime = this.settingsRuntime;
        this.container.classList.add('model-defaults-host');
        const generation = ++this.generation;
        try {
            const [connections, defaults] = await Promise.all([this.service.getConnections(), this.service.getModelDefaults()]);
            if (this.closed || generation !== this.generation)
                return;
            if (this.readFailed) {
                this.container.querySelector('[data-defaults-result]')?.replaceChildren();
                this.readFailed = false;
            }
            const edits = this.selectionEdits();
            this.connections = connections;
            this.defaults = defaults;
            this.providers = this.service.getProviders();
            this.pricing = this.service.getPricingConfig?.();
            const fingerprint = JSON.stringify([defaults, this.pricing, connections.map(({ id, name, providerId, enabled, credentialsReady, hasApiKey, model, tiers, protocol, baseURL }) => ({ id, name, providerId, enabled, credentialsReady, hasApiKey, model, tiers, protocol, baseURL })),
                this.providers.map(({ id, name, enabled, models, media, baseURL, defaultProtocol, implementation }) => ({ id, name, enabled, models, media, baseURL, defaultProtocol, implementation }))]);
            if (fingerprint === this.fingerprint)
                return;
            this.fingerprint = fingerprint;
            this.clearListeners();
            this.container.innerHTML = `<section class="model-defaults"><h2>${dependencies(runtime).t('modelDefaults.title')}</h2>
                <p class="model-defaults__description">${this.description()}</p>${dependencies(runtime).MODEL_OPERATIONS.map(operation => this.row(operation, edits.get(operation) ?? defaults[operation])).join('')}
                ${this.ocr ? '<section data-ocr-default></section>' : ''}
                <p role="status" data-defaults-result></p></section>`;
            this.bind();
            await this.mountOcr();
        }
        catch (error) {
            if (!this.closed && generation === this.generation) {
                if (!this.container.querySelector('[data-defaults-result]'))
                    this.fingerprint = undefined;
                this.readFailed = true;
                this.showError(error);
            }
        }
    }
    private description(): string {
        const runtime = this.settingsRuntime;
        const [before, after = ''] = dependencies(runtime).t('modelDefaults.description').split('{models}');
        return `${dependencies(runtime).escapeHTML(before)}<a href="${dependencies(runtime).escapeAttr(this.options.navigation?.href('/connections') ?? '#')}" data-models-link data-model-config="/connections">${dependencies(runtime).escapeHTML(dependencies(runtime).t('modelDefaults.modelsLink'))}</a>${dependencies(runtime).escapeHTML(after)}`;
    }
    private async mountOcr(): Promise<void> {
        const runtime = this.settingsRuntime;
        if (!this.ocr)
            return;
        this.ocrContainer.className = 'model-defaults__row';
        this.container.querySelector('[data-ocr-default]')!.replaceWith(this.ocrContainer);
        if (!this.ocrForm) {
            this.ocrForm = new (dependencies(runtime).OcrSettingsForm)(this.ocrContainer, this.ocr, true, (id, host) => this.ocrConnectionLink(id, host));
            await this.ocrForm.refresh();
        }
        this.ocrForm.syncSelection();
    }
    private ocrConnectionLink(id: string | undefined, host: HTMLElement): void {
        this.ocrContainer.querySelector('[data-model-config]')?.remove();
        if (id && this.connections.some(connection => connection.id === id))
            host.insertAdjacentHTML('beforeend', this.connectionLink(id));
    }
    private row(operation: ModelOperation, selected: string | undefined): string {
        const runtime = this.settingsRuntime;
        const current = this.connections.find(item => item.id === selected);
        const candidates = this.connections.filter(item => dependencies(runtime).modelForOperation(item, this.provider(item), operation));
        const options = candidates.sort((a, b) => Number(!available(runtime, a)) - Number(!available(runtime, b)) || a.name.localeCompare(b.name))
            .map(item => `<option value="${dependencies(runtime).escapeAttr(item.id)}" ${item.id === selected ? 'selected' : ''} ${available(runtime, item) ? '' : 'disabled'}>${dependencies(runtime).escapeHTML(this.label(item))}${available(runtime, item) ? '' : ` · ${dependencies(runtime).escapeHTML(unavailableReason(runtime, item))}`}</option>`).join('');
        const missing = selected && !candidates.some(item => item.id === selected)
            ? `<option selected value="${dependencies(runtime).escapeAttr(selected)}">${dependencies(runtime).escapeHTML(dependencies(runtime).t('connection.unavailable', { id: selected }))}</option>` : '';
        const status = this.selectionStatus(operation, current, selected);
        return `<section class="model-defaults__row" data-purpose="${operation}"><label for="default-${operation}">${purposeLabel(runtime, operation)}</label>
            <div class="model-defaults__selection" data-default-selection="${operation}"><select id="default-${operation}" class="settings-form__select" data-default-operation="${operation}"><option value="">${dependencies(runtime).t('modelDefaults.unset')}</option>${missing}${options}</select>${current ? this.connectionLink(current.id) : ''}</div>
            <div class="model-defaults__model" data-default-model="${operation}">${this.modelInfo(operation, current)}</div>
            ${status ? `<p class="model-defaults__status">${status}</p>` : ''}</section>`;
    }
    private selectionStatus(operation: ModelOperation, current: ConnectionMeta | undefined, selected: string | undefined): string {
        const runtime = this.settingsRuntime;
        if (!selected)
            return dependencies(runtime).t('modelDefaults.notConfigured');
        if (!current)
            return dependencies(runtime).t('modelDefaults.incompatible');
        if (!available(runtime, current))
            return unavailableReason(runtime, current);
        return dependencies(runtime).modelForOperation(current, this.provider(current), operation) ? '' : dependencies(runtime).t('modelDefaults.incompatible');
    }
    private selectionEdits(): Map<ModelOperation, string> {
        const edits = new Map<ModelOperation, string>();
        for (const select of this.container.querySelectorAll<HTMLSelectElement>('[data-default-operation]')) {
            const operation = select.dataset.defaultOperation as ModelOperation;
            if (select.value !== (this.defaults[operation] ?? ''))
                edits.set(operation, select.value);
        }
        return edits;
    }
    private label(connection: ConnectionMeta): string {
        const provider = this.provider(connection);
        return [...new Set([connection.name, provider?.name ?? connection.providerId])].join(' · ');
    }
    private modelInfo(operation: ModelOperation, connection?: ConnectionMeta): string {
        const runtime = this.settingsRuntime;
        if (!connection)
            return '';
        const model = dependencies(runtime).modelForOperation(connection, this.provider(connection), operation);
        if (!model)
            return '';
        const source = dependencies(runtime).modelPriceSource(connection.providerId, this.pricing, model.id);
        return `<strong>${dependencies(runtime).escapeHTML(model.name || model.id)}</strong>${dependencies(runtime).renderModelCapabilityBadges(model)}<span>${dependencies(runtime).escapeHTML(dependencies(runtime).modelPriceLabel(model, connection.providerId, this.pricing))}</span>
            ${source ? `<a href="${dependencies(runtime).escapeAttr(source.url)}" target="_blank" rel="noopener noreferrer">${dependencies(runtime).escapeHTML(dependencies(runtime).t('connection.modelPriceSource', { date: source.reviewedAt }))}</a>` : ''}`;
    }
    private connectionLink(id: string): string {
        const runtime = this.settingsRuntime;
        const path = '/connections/' + encodeURIComponent(id), name = this.connections.find(connection => connection.id === id)?.name ?? id;
        const label = dependencies(runtime).escapeAttr(dependencies(runtime).t('modelDefaults.openConnection', { name }));
        return `<a class="model-defaults__configure" href="${dependencies(runtime).escapeAttr(this.options.navigation?.href(path) ?? '#')}" data-model-config="${dependencies(runtime).escapeAttr(path)}" title="${label}" aria-label="${label}"><span aria-hidden="true">${dependencies(runtime).ACTION_ICONS.settings}</span></a>`;
    }
    private provider(connection: ConnectionMeta): LLMProvider | undefined { return this.providers.find(item => item.id === connection.providerId); }
    private bind(): void {
        this.addEventListener(this.container, 'change', event => {
            const select = event.target as HTMLSelectElement, operation = select.dataset.defaultOperation as ModelOperation | undefined;
            if (operation)
                this.save(operation, select.value || null);
        });
        this.addEventListener(this.container, 'click', event => {
            const click = event as MouseEvent, link = (event.target as HTMLElement | null)?.closest<HTMLAnchorElement>('[data-model-config]');
            const host = this.options.navigation;
            if (!link || !host?.open || click.button || click.ctrlKey || click.metaKey || click.shiftKey || click.altKey)
                return;
            click.preventDefault();
            void host.open(link.dataset.modelConfig!);
        });
    }
    private save(operation: ModelOperation, id: string | null): void {
        const runtime = this.settingsRuntime;
        if (this.pending)
            return;
        this.recoveringDraft = false;
        this.container.querySelectorAll<HTMLSelectElement>('[data-default-operation]').forEach(select => { select.disabled = true; });
        this.pending = this.service.setModelDefault(operation, id).then(async () => {
            if (!this.closed) {
                await this.render();
                this.result().textContent = dependencies(runtime).t('modelDefaults.saved');
            }
        }).catch(error => {
            if (!this.closed) {
                this.restoreSelections();
                this.showError(error);
            }
        })
            .finally(() => {
            this.pending = undefined;
            if (!this.closed)
                this.container.querySelectorAll<HTMLSelectElement>('[data-default-operation]').forEach(select => { select.disabled = false; });
        });
    }
    private restoreSelections(): void {
        this.container.querySelectorAll<HTMLSelectElement>('[data-default-operation]').forEach(select => { select.value = this.defaults[select.dataset.defaultOperation as ModelOperation] ?? ''; });
    }
    private result(): HTMLElement { return this.container.querySelector<HTMLElement>('[data-defaults-result]')!; }
    private showError(error: unknown): void {
        const runtime = this.settingsRuntime;
        const message = error instanceof Error ? error.message : String(error);
        const result = this.container.querySelector<HTMLElement>('[data-defaults-result]');
        if (result) {
            result.textContent = message;
            return;
        }
        const description = document.createElement('p'), retry = document.createElement('button');
        description.textContent = message;
        description.setAttribute('role', 'alert');
        retry.type = 'button';
        retry.className = 'settings-btn settings-btn--secondary';
        retry.textContent = dependencies(runtime).t('settings.autosave.retry');
        retry.onclick = () => { void this.render(); };
        this.container.replaceChildren(description, retry);
    }
    captureRecovery(): unknown {
        const runtime = this.settingsRuntime;
        if (this.pending || this.ocrForm?.isDirty())
            throw Object.assign(new Error(dependencies(runtime).t('httpApp.recoveryBusy')), { code: 'RECOVERY_BUSY' });
        return super.captureRecovery();
    }
    restoreRecovery(snapshot: unknown): void {
        const state = snapshot as {
            model: {
                ocrId?: string;
            };
        };
        if (state.model.ocrId || !this.ocrContainer.querySelector('[name=ocr-connection]')) {
            super.restoreRecovery(snapshot);
            return;
        }
        // A failed initial OCR read contained no editable OCR fields to restore.
        const placeholder = document.createComment('OCR configuration');
        this.ocrContainer.replaceWith(placeholder);
        try {
            super.restoreRecovery(snapshot);
        }
        finally {
            placeholder.replaceWith(this.ocrContainer);
        }
    }
    protected captureRecoveryModel(): unknown {
        return { ocrId: this.container.querySelector<HTMLSelectElement>('[name=ocr-connection]')?.id };
    }
    protected restoreRecoveryModel(snapshot: unknown): void {
        const state = snapshot as {
            ocrId?: string;
        };
        const select = this.container.querySelector<HTMLSelectElement>('[name=ocr-connection]');
        if (select && state.ocrId) {
            const label = this.ocrContainer.querySelector<HTMLLabelElement>('label');
            select.id = state.ocrId;
            if (label)
                label.htmlFor = state.ocrId;
        }
    }
    protected afterRestoreRecovery(): void {
        this.recoveringDraft = true;
        ++this.generation;
        for (const root of this.container.querySelectorAll<HTMLElement>('[data-default-model]')) {
            const operation = root.dataset.defaultModel as ModelOperation;
            const value = this.container.querySelector<HTMLSelectElement>(`[data-default-operation="${operation}"]`)!.value;
            const connection = this.connections.find(item => item.id === value);
            root.innerHTML = this.modelInfo(operation, connection);
            const selection = this.container.querySelector(`[data-default-selection="${operation}"]`)!;
            selection.querySelector('[data-model-config]')?.remove();
            if (connection)
                selection.insertAdjacentHTML('beforeend', this.connectionLink(connection.id));
        }
        this.ocrForm?.syncSelection();
    }
    suspendForRecovery(): void {
        this.closed = true;
        ++this.generation;
        this.ocrForm?.destroy();
        super.suspendForRecovery();
    }
    async flushPendingSave(): Promise<void> { await Promise.all([this.pending, this.ocrForm?.flushPendingSave()]); }
    isDirty(): boolean { return this.selectionEdits().size > 0 || !!this.pending || !!this.ocrForm?.isDirty() || super.isDirty(); }
    async navigateToAnchor(anchor: string): Promise<void> {
        if (anchor === 'ocr') {
            this.ocrContainer.querySelector('select')?.focus();
            this.ocrContainer.scrollIntoView?.({ block: 'nearest' });
            return;
        }
        const select = [...this.container.querySelectorAll<HTMLSelectElement>('[data-default-operation]')].find(select => select.dataset.defaultOperation === anchor);
        select?.focus();
        select?.scrollIntoView?.({ block: 'nearest' });
    }
    async destroy(): Promise<void> {
        await this.flushPendingSave();
        this.closed = true;
        ++this.generation;
        this.ocrForm?.destroy();
        this.container.classList.remove('model-defaults-host');
        await super.destroy();
    }
}
function available(runtime: SettingsRuntime, connection: ConnectionMeta): boolean { return connection.enabled !== false && dependencies(runtime).hasConnectionCredentials(connection); }
function unavailableReason(runtime: SettingsRuntime, connection: ConnectionMeta): string { return dependencies(runtime).t(connection.enabled === false ? 'modelDefaults.disabled' : 'modelDefaults.credentials'); }
function purposeLabel(runtime: SettingsRuntime, operation: ModelOperation): string { return dependencies(runtime).t(`modelDefaults.purpose.${operation}`); }
function createDependencies(runtime: SettingsRuntime) { return { OcrSettingsForm: bind0(runtime).OcrSettingsForm, ACTION_ICONS: runtime.presentation.ACTION_ICONS, escapeAttr: runtime.presentation.escapeAttr, escapeHTML: runtime.presentation.escapeHTML, t: runtime.presentation.t, MODEL_OPERATIONS: runtime.rules.MODEL_OPERATIONS, hasConnectionCredentials: runtime.rules.hasConnectionCredentials, modelForOperation: runtime.rules.modelForOperation, modelPriceLabel: bind2(runtime).modelPriceLabel, renderModelCapabilityBadges: bind3(runtime).renderModelCapabilityBadges, modelPriceSource: bind4(runtime).modelPriceSource }; }
export function bind(runtime: SettingsRuntime) { return { ModelDefaultsEditor: bindConstructor(ModelDefaultsEditor, runtime, 2) }; }

const dependencyCache = new WeakMap<SettingsRuntime, ReturnType<typeof createDependencies>>();
function dependencies(runtime: SettingsRuntime) {
    let value = dependencyCache.get(runtime);
    if (!value) { value = createDependencies(runtime); dependencyCache.set(runtime, value); }
    return value;
}
