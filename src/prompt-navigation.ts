import {OutlineView} from '@nestos/ui-common';
import {getPreviewText} from './text-preview';
import {randomUUID} from './random';
import {translator, type Translate} from './i18n';
import { EventCleanup } from './events';
import { PromptNavigationTemplates as templates } from './prompt-templates';
import {presentButton} from './dom';
import type {Translation} from './contracts';

export interface PromptNavigationItem { id: string; text: string; name?: string }
export interface PromptNavigationOptions {
    readonly root: HTMLElement;
    readonly history: HTMLElement;
    readonly trigger: HTMLButtonElement;
    readonly locale?: 'zh-CN' | 'en';
    readonly translate?: Translation;
    readonly presentButton?: (button: HTMLButtonElement, action: string) => void;
    getRows(): readonly {id: string; element: HTMLElement}[];
    reveal(id: string): HTMLElement | null;
    refresh?(): void;
    earlier?(): void;
}

const INITIAL_COUNT = 100;

/** A bounded, read-only index of user prompts, independent of execution and branch commands. */
export class PromptNavigator {
    private readonly panel = document.createElement('section');
    private readonly outline: OutlineView;
    private readonly events = new EventCleanup();
    private readonly trigger: HTMLButtonElement;
    private items: PromptNavigationItem[] = [];
    private filtered: PromptNavigationItem[] = [];
    private query = '';
    private visibleCount = INITIAL_COUNT;
    private hasEarlier = false;
    private loading = false;
    private activeId?: string;
    private frame?: number;
    private destroyed = false;
    private readonly t: Translate;
    private readonly history: HTMLElement;

    constructor(private readonly options: PromptNavigationOptions) {
        const workspace = options.root; this.history = options.history; this.trigger = options.trigger;
        this.t = translator(options.locale, options.translate);
        this.panel.className = 'llm-prompt-nav'; this.panel.hidden = true;
        this.panel.id = `llm-prompt-navigation-${randomUUID()}`;
        this.trigger.setAttribute('aria-controls', this.panel.id);
        this.panel.setAttribute('role', 'region'); this.panel.setAttribute('aria-label', this.t('prompts'));
        this.panel.innerHTML = templates.shell(this.t); workspace.append(this.panel);
        this.outline = new OutlineView({label: this.t('prompts'), emptyLabel: this.t('promptEmpty'), errorLabel: this.t('promptUnavailable'),
            expandLabel: this.t('prompts'), collapseLabel: this.t('promptClose'), select: id => this.select(id),
            onDiagnostic: event => {console[event.result === 'failure' ? 'warn' : 'debug']('[PromptOutline]', event);}});
        this.panel.querySelector('.llm-prompt-nav__list')!.append(this.outline.element);
        for (const action of ['close', 'preview']) {
            const button = this.panel.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)!;
            presentButton(button, action, options.presentButton);
        }
        this.trigger.setAttribute('aria-expanded', 'false');
        this.bind(workspace);
    }

    private bind(workspace: HTMLElement): void {
        this.events.add(this.trigger, 'click', () => this.toggle());
        this.events.add(this.panel, 'click', event => this.click(event));
        this.events.add(this.panel, 'keydown', event => this.keydown(event as KeyboardEvent));
        this.events.add(this.panel.querySelector('input')!, 'input', event => {
            this.query = (event.target as HTMLInputElement).value; this.visibleCount = INITIAL_COUNT; this.filter(); this.render();
        });
        this.events.add(document, 'pointerdown', event => {
            if (!this.panel.hidden && !this.panel.contains(event.target as Node) && !this.trigger.contains(event.target as Node)) this.close(false);
        });
        this.events.add(document, 'keydown', event => {
            if ((event as KeyboardEvent).key !== 'Escape' || this.panel.hidden || !workspace.contains(document.activeElement)) return;
            event.preventDefault(); this.close();
        });
        this.events.add(this.history, 'scroll', () => this.scheduleHighlight(), {passive: true});
    }

    get isVisible(): boolean { return !this.panel.hidden; }

    update(items: PromptNavigationItem[]): void {
        if (this.destroyed) return;
        const changed = items.length !== this.items.length || items.some((item, index) => item.id !== this.items[index]?.id || item.text !== this.items[index]?.text || item.name !== this.items[index]?.name);
        this.items = items;
        if (!changed) return;
        this.filter();
        if (!this.panel.hidden) {
            this.syncActive();
            this.render();
        }
    }

    setEarlier(available: boolean, loading: boolean, error: string): void {
        if (this.destroyed) return;
        this.hasEarlier = available; this.loading = loading;
        const button = this.panel.querySelector<HTMLButtonElement>('[data-action="earlier"]')!;
        button.hidden = !available || !this.options.earlier; button.disabled = loading;
        button.textContent = this.t(loading ? 'promptLoading' : 'earlier');
        const hint = this.panel.querySelector<HTMLElement>('.llm-prompt-nav__scope')!;
        hint.hidden = !available;
        hint.textContent = this.t('promptLoadedOnly') + (error ? ` ${error}` : '');
        if (!this.panel.hidden && !this.filtered.length) this.render();
    }

    toggle(): void {
        if (this.destroyed) return;
        if (!this.panel.hidden) { this.close(); return; }
        this.panel.hidden = false; this.trigger.setAttribute('aria-expanded', 'true');
        this.query = ''; this.visibleCount = INITIAL_COUNT;
        this.panel.querySelector<HTMLInputElement>('input')!.value = '';
        this.filter(); this.syncActive(); this.render();
        this.panel.querySelector('.llm-prompt-nav__list')!.scrollTop = 0;
        this.panel.querySelector<HTMLInputElement>('input')!.focus();
        this.options.refresh?.();
    }

    close(restoreFocus = true): void {
        if (this.destroyed) return;
        this.panel.hidden = true; this.trigger.setAttribute('aria-expanded', 'false');
        if (restoreFocus) this.trigger.focus({preventScroll: true});
    }

    private filter(): void {
        const query = this.query.trim().toLocaleLowerCase();
        this.filtered = (query ? this.items.filter(item => item.text.toLocaleLowerCase().includes(query)) : [...this.items]).reverse();
    }

    private render(): void {
        const list = this.panel.querySelector<HTMLElement>('.llm-prompt-nav__list')!;
        const focusedId = (document.activeElement as HTMLElement)?.closest<HTMLElement>('[data-prompt-id]')?.dataset.promptId;
        const top = list.scrollTop;
        const visible = this.filtered.slice(0, this.visibleCount);
        const empty = this.loading ? 'promptLoading' : this.hasEarlier && !this.query ? 'promptNoLoaded' : 'promptEmpty';
        this.outline.update(visible.map(item => ({id: item.id, label: getPreviewText(item.name ?? item.text, 300) || this.t('promptAttachment')})));
        this.outline.element.querySelectorAll<HTMLButtonElement>('[data-outline-id]').forEach(button => {button.dataset.promptId = button.dataset.outlineId; button.classList.add('llm-prompt-nav__item');});
        if (!visible.length) {const hint = this.outline.element.querySelector('p:last-child')!; hint.classList.add('llm-prompt-nav__empty'); hint.textContent = this.t(empty);}
        this.highlight();
        this.panel.querySelector<HTMLElement>('.llm-prompt-nav__range')!.textContent = this.t('promptCount', {count: visible.length, total: this.filtered.length});
        this.panel.querySelector<HTMLButtonElement>('[data-action="more"]')!.hidden = visible.length >= this.filtered.length;
        this.panel.querySelectorAll<HTMLButtonElement>('[data-jump]').forEach(button => { button.disabled = !this.filtered.length; });
        const focused = [...list.querySelectorAll<HTMLButtonElement>('[data-prompt-id]')].find(button => button.dataset.promptId === focusedId);
        focused?.focus({preventScroll: true}); list.scrollTop = top;
    }

    private click(event: Event): void {
        const target = (event.target as Element).closest<HTMLButtonElement>('button');
        if (!target) return;
        if (target.dataset.promptId) return;
        if (target.dataset.jump) { this.jump(target.dataset.jump); return; }
        this.action(target.dataset.action ?? '');
    }

    private action(action: string): void {
        if (action === 'close') this.close();
        if (action === 'earlier') this.options.earlier?.();
        if (action === 'preview') {
            const expanded = this.panel.classList.toggle('llm-prompt-nav--expanded');
            this.panel.querySelector('[data-action="preview"]')!.setAttribute('aria-pressed', String(expanded));
        }
        if (action === 'more') {
            this.visibleCount += INITIAL_COUNT; this.render();
        }
    }

    private jump(position: string): void {
        const index = position === 'last' ? 0 : position === 'middle' ? Math.floor((this.filtered.length - 1) / 2) : this.filtered.length - 1;
        const item = this.filtered[index]; if (!item) return;
        this.visibleCount = Math.max(this.visibleCount, index + 1); this.render();
        const button = [...this.panel.querySelectorAll<HTMLButtonElement>('[data-prompt-id]')].find(row => row.dataset.promptId === item.id);
        button?.focus(); button?.scrollIntoView?.({block: 'nearest'});
    }

    private select(id: string): void {
        const target = this.options.reveal(id); if (!target) throw new Error('OUTLINE_TARGET_UNAVAILABLE');
        this.activeId = id; this.highlight();
        const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        const offset = target.getBoundingClientRect().top - this.history.getBoundingClientRect().top - 16;
        const behavior = reduced || Math.abs(offset) > this.history.clientHeight * 2 ? 'instant' : 'smooth';
        this.history.scrollTo({top: Math.max(0, this.history.scrollTop + offset), behavior});
        this.history.querySelectorAll('.llm-prompt-nav-target').forEach(row => row.classList.remove('llm-prompt-nav-target'));
        target.classList.add('llm-prompt-nav-target'); target.tabIndex = -1;
        if (window.matchMedia?.('(max-width: 600px)').matches) this.close(false);
        target.focus({preventScroll: true});
    }

    private scheduleHighlight(): void {
        if (this.panel.hidden || this.frame !== undefined) return;
        this.frame = requestAnimationFrame(() => { this.frame = undefined; this.syncActive(); this.highlight(); });
    }

    private syncActive(): void {
        const ids = new Set(this.items.map(item => item.id));
        const bounds = this.history.getBoundingClientRect(), line = bounds.top + bounds.height * .4;
        let first: string | undefined, current: string | undefined;
        for (const row of this.options.getRows()) {
            if (!ids.has(row.id)) continue;
            first ??= row.id;
            if (row.element.getBoundingClientRect().top <= line) current = row.id;
        }
        this.activeId = current ?? first;
    }

    private highlight(): void {
        this.panel.querySelectorAll<HTMLElement>('[data-prompt-id]').forEach(row => {
            if (row.dataset.promptId === this.activeId) row.setAttribute('aria-current', 'location');
            else row.removeAttribute('aria-current');
        });
    }

    private keydown(event: KeyboardEvent): void {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.close(); return; }
        if (event.target instanceof HTMLInputElement && event.key === 'ArrowDown') {
            const first = this.outline.element.querySelector<HTMLButtonElement>('[data-outline-id]');
            if (first) {event.preventDefault(); first.focus();}
        }
    }

    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true; this.events.cleanup(); this.outline.destroy();
        if (this.frame !== undefined) cancelAnimationFrame(this.frame);
        this.trigger.setAttribute('aria-expanded', 'false'); this.trigger.removeAttribute('aria-controls'); this.panel.remove();
        this.history.querySelectorAll('.llm-prompt-nav-target').forEach(row => row.classList.remove('llm-prompt-nav-target'));
    }
}
