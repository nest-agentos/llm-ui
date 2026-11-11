import {formatDateTime} from '@nestos/ui-common';
import type { SettingsRuntime } from '../runtime';
import { bindConstructor } from '../binding';
import type { LocaleKey, IConnectionService, ProviderAuthorizationState } from '../contracts/domain';
export type PendingAuthorization = NonNullable<ProviderAuthorizationState['pending']>;
/** The view owns no OAuth tokens, callback listener or background refresh loop. */
export class ProviderAuthorizationPanel {
    private unsubscribe?: () => void;
    private generation = 0;
    private last?: string;
    private status?: ProviderAuthorizationState['status'];
    private disposed = false;
    private progress?: LocaleKey;
    private readonly events = new AbortController();
    private refreshQueued = false;
    constructor(private readonly settingsRuntime: SettingsRuntime, private readonly root: HTMLElement, private readonly providerId: string, private readonly service: IConnectionService, private readonly authorized: () => Promise<void>) {
        root.addEventListener('input', event => event.stopPropagation());
        root.addEventListener('change', event => event.stopPropagation());
    }
    async init(): Promise<void> {
        this.unsubscribe = this.service.onChange(() => this.queueRefresh());
        window.addEventListener('focus', () => this.queueRefresh(), { signal: this.events.signal });
        document.addEventListener('visibilitychange', () => this.queueRefresh(), { signal: this.events.signal });
        await this.refresh();
    }
    destroy(): void { this.disposed = true; this.generation++; this.unsubscribe?.(); this.events.abort(); }
    private queueRefresh(): void {
        if (this.disposed || this.refreshQueued || document.visibilityState === 'hidden')
            return;
        this.refreshQueued = true;
        queueMicrotask(() => {
            this.refreshQueued = false;
            if (!this.disposed)
                void this.refresh().catch(() => { });
        });
    }
    private async refresh(): Promise<void> {
        if (this.disposed)
            return;
        const generation = ++this.generation;
        const state = await this.service.getProviderAuthorization?.(this.providerId) ?? { supported: false, status: 'signed-out' };
        if (this.disposed || generation !== this.generation)
            return;
        const fingerprint = JSON.stringify(state);
        if (fingerprint === this.last)
            return;
        const completed = this.status === 'pending' && state.status === 'authorized' && !state.issue;
        this.last = fingerprint;
        this.status = state.status;
        this.render(state);
        if (completed)
            await this.authorized();
    }
    private render(state: ProviderAuthorizationState): void {
        const runtime = this.settingsRuntime;
        this.root.innerHTML = `<h3>${dependencies(runtime).t('provider.auth.title')}</h3><p>${dependencies(runtime).t('provider.auth.description')}</p>
            <p role="status" data-auth-status>${dependencies(runtime).t(`provider.auth.${state.supported ? state.status : 'unsupported'}`)}${state.account ? ` · ${dependencies(runtime).escapeHTML(state.account)}` : ''}</p>
            <p role="status" data-auth-progress hidden></p>
            ${state.issue ? `<p role="alert">${dependencies(runtime).t(`provider.auth.issue.${issueKey(state.issue)}`)}</p>` : ''}
            ${state.pending ? this.pendingMarkup(state.pending) : ''}
            <div class="provider-authorization__actions" data-auth-actions></div>`;
        if (state.supported)
            this.renderActions(state);
        this.setProgress(this.progress);
    }
    private pendingMarkup(pending: PendingAuthorization): string {
        const runtime = this.settingsRuntime;
        const expires = formatDateTime(new Date(pending.expiresAt), dependencies(runtime).getLocale());
        return `<label class="provider-authorization__field">${dependencies(runtime).t('provider.auth.url')}
                <textarea class="settings-form__textarea provider-authorization__url" data-auth-url readonly rows="4" spellcheck="false">${dependencies(runtime).escapeHTML(pending.url)}</textarea></label>
            <p class="settings-form__help">${dependencies(runtime).t('provider.auth.urlHint')}</p>
            <p class="settings-form__help">${dependencies(runtime).t('provider.auth.expires', { time: expires })}</p>
            <div class="provider-authorization__actions" data-auth-links></div>
            <p class="settings-form__help">${dependencies(runtime).t('provider.auth.regenerateHint')}</p>
            <p>${dependencies(runtime).t('provider.auth.remoteHint')}</p>
            <label class="provider-authorization__field">${dependencies(runtime).t('provider.auth.callback')}
                <input type="url" class="settings-form__input" data-auth-callback autocomplete="off" spellcheck="false" placeholder="${dependencies(runtime).escapeAttr(pending.callbackUri)}"></label>`;
    }
    private renderActions(state: ProviderAuthorizationState): void {
        const runtime = this.settingsRuntime;
        const actions = this.root.querySelector<HTMLElement>('[data-auth-actions]')!;
        if (state.pending) {
            const navigation = this.root.querySelector<HTMLElement>('[data-auth-links]')!;
            const link = document.createElement('a');
            link.href = state.pending.url;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.className = 'settings-btn settings-btn--primary';
            link.textContent = dependencies(runtime).t('provider.auth.open');
            navigation.append(link);
            this.copyButton(navigation, state.pending.url);
            this.button(navigation, dependencies(runtime).t('provider.auth.regenerate'), () => this.regenerate(), 'provider.auth.preparing');
            this.button(actions, dependencies(runtime).t('provider.auth.complete'), async () => {
                const input = this.root.querySelector<HTMLInputElement>('[data-auth-callback]')!;
                if (!input.value.trim()) {
                    input.focus();
                    throw new Error(dependencies(runtime).t('provider.auth.callbackRequired'));
                }
                return this.service.completeProviderAuthorization!(this.providerId, state.pending!.id, input.value.trim());
            }, 'provider.auth.verifying');
            this.button(actions, dependencies(runtime).t('action.cancel'), () => this.service.cancelProviderAuthorization!(this.providerId));
        }
        else {
            this.button(actions, dependencies(runtime).t('provider.auth.continue'), () => this.service.beginProviderAuthorization!(this.providerId), 'provider.auth.preparing');
            if (state.status === 'authorized' || state.status === 'reauthorize')
                this.button(actions, dependencies(runtime).t('provider.auth.disconnect'), () => this.service.disconnectProviderAuthorization!(this.providerId));
        }
    }
    private async regenerate(): Promise<ProviderAuthorizationState> {
        await this.service.cancelProviderAuthorization!(this.providerId);
        try {
            return await this.service.beginProviderAuthorization!(this.providerId);
        }
        catch (error) {
            await this.refresh();
            throw error;
        }
    }
    private copyButton(parent: HTMLElement, url: string): void {
        const runtime = this.settingsRuntime;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'settings-btn settings-btn--secondary';
        button.textContent = dependencies(runtime).t('provider.auth.copy');
        button.onclick = () => {
            if (this.disposed || this.progress)
                return;
            void dependencies(runtime).copyText(url).then(copied => {
                if (this.disposed)
                    return;
                if (copied)
                    dependencies(runtime).Toast.success(dependencies(runtime).t('editor.copySuccess'));
                else {
                    const input = this.root.querySelector<HTMLTextAreaElement>('[data-auth-url]');
                    input?.focus();
                    input?.select();
                    dependencies(runtime).Toast.error(dependencies(runtime).t('provider.auth.copyFailed'));
                }
            });
        };
        parent.append(button);
    }
    private button(parent: HTMLElement, label: string, action: () => Promise<ProviderAuthorizationState>, progress: LocaleKey = 'provider.auth.working'): void {
        const runtime = this.settingsRuntime;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'settings-btn settings-btn--secondary';
        button.textContent = label;
        button.onclick = () => {
            if (this.disposed || this.progress)
                return;
            this.setProgress(progress);
            void action().then(() => this.refresh()).catch(error => {
                if (!this.disposed)
                    dependencies(runtime).Toast.error(String(error));
            })
                .finally(() => {
                if (!this.disposed)
                    this.setProgress();
            });
        };
        parent.append(button);
    }
    private setProgress(progress?: LocaleKey): void {
        const runtime = this.settingsRuntime;
        this.progress = progress;
        this.root.setAttribute('aria-busy', String(Boolean(progress)));
        this.root.querySelectorAll<HTMLButtonElement>('button').forEach(button => { button.disabled = Boolean(progress); });
        const status = this.root.querySelector<HTMLElement>('[data-auth-status]');
        if (status)
            status.hidden = Boolean(progress);
        const notice = this.root.querySelector<HTMLElement>('[data-auth-progress]');
        if (notice) {
            notice.hidden = !progress;
            notice.textContent = progress ? dependencies(runtime).t(progress) : '';
        }
    }
}
function issueKey(issue: string): 'authorization-failed' | 'consent-denied' | 'reauthorization-required' | 'revocation-unconfirmed' | 'refresh-unavailable' {
    return ['consent-denied', 'reauthorization-required', 'revocation-unconfirmed', 'refresh-unavailable'].includes(issue)
        ? issue as ReturnType<typeof issueKey> : 'authorization-failed';
}
function createDependencies(runtime: SettingsRuntime) { return { t: runtime.presentation.t, escapeAttr: runtime.presentation.escapeAttr, escapeHTML: runtime.presentation.escapeHTML, getLocale: runtime.presentation.getLocale, Toast: runtime.widgets.Toast, copyText: runtime.widgets.copyText }; }
export function bind(runtime: SettingsRuntime) { return { ProviderAuthorizationPanel: bindConstructor(ProviderAuthorizationPanel, runtime) }; }

const dependencyCache = new WeakMap<SettingsRuntime, ReturnType<typeof createDependencies>>();
function dependencies(runtime: SettingsRuntime) {
    let value = dependencyCache.get(runtime);
    if (!value) { value = createDependencies(runtime); dependencyCache.set(runtime, value); }
    return value;
}
