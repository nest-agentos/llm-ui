import {escapeHTML} from './html';
import {EventCleanup} from './events';
import {translator} from './i18n';
import type {Translation} from './contracts';
import {randomUUID} from './random';
import {observePopupDismiss} from './popup-dismiss';

export interface PopupItem {
    id: string; disabled?: boolean; label: string; description?: string;
    /** Trusted host markup only; labels and search text are always escaped. */
    icon?: string;
    group?: string; searchText?: string; hasArgs?: boolean; shortcut?: string;
}
export interface PopupPanelOptions {
    locale?: 'zh-CN' | 'en'; translate?: Translation;
    positionAnchor?: HTMLElement;
    minWidth?: number;
    groupFilterLabel?: string;
    toggle?: {label: string; checked?: boolean; onChange(checked: boolean): void};
    maxVisible?: number; showSearch?: boolean; searchPlaceholder?: string; emptyText?: string;
    footerHint?: string; variant?: string; animated?: boolean; onDelete?(item: PopupItem): void;
}
interface Callbacks {onSelect(item: PopupItem): void; onClose?(): void}

/** Shared candidate filtering, keyboard navigation and popup ownership. */
export class PopupPanel {
    private readonly panel = document.createElement('div');
    private readonly list = document.createElement('div');
    readonly element = this.panel;
    private readonly events = new EventCleanup();
    private readonly filters = document.createElement('div');
    private readonly search = document.createElement('input');
    private readonly t;
    private items: PopupItem[] = [];
    private rows: PopupItem[] = [];
    private selected = -1;
    private group?: string;
    private query = '';
    private visible = false;
    private closed = false;
    private callbacks?: Callbacks;
    private stopOutside?: () => void;
    constructor(private readonly anchor: HTMLElement, private readonly options: PopupPanelOptions = {}) {
        this.t = translator(options.locale, options.translate); this.layout(); this.bind();
    }
    get isVisible(): boolean {return this.visible;}
    private layout(): void {
        this.panel.className = 'llm-popup';
        if (this.options.variant) this.panel.classList.add(`llm-popup--${this.options.variant}`);
        if (this.options.animated) this.panel.classList.add('llm-popup--animated');
        this.filters.className = 'llm-popup__filters'; this.filters.setAttribute('role', 'group');
        this.filters.setAttribute('aria-label', this.options.groupFilterLabel ?? '');
        this.search.type = 'text'; this.search.className = 'llm-popup__search-input'; this.search.autocomplete = 'off'; this.search.spellcheck = false;
        this.search.placeholder = this.options.searchPlaceholder ?? this.t('popupSearch');
        if (this.options.showSearch) {const slot = document.createElement('div'); slot.className = 'llm-popup__search'; slot.append(this.search); this.panel.append(slot);}
        if (this.options.groupFilterLabel) this.panel.append(this.filters);
        this.list.className = 'llm-popup__list'; this.list.id = `llm-popup-${randomUUID()}`; this.list.setAttribute('role', 'listbox'); this.panel.append(this.list);
        if (this.options.toggle) this.mountToggle();
        if (this.options.footerHint) {const footer = document.createElement('div'); footer.className = 'llm-popup__footer'; footer.textContent = this.options.footerHint; this.panel.append(footer);}
        document.body.append(this.panel);
    }
    private mountToggle(): void {
        const label = document.createElement('label'), input = document.createElement('input'); label.className = 'llm-popup__footer';
        input.type = 'checkbox'; input.dataset.popupToggle = ''; input.checked = !!this.options.toggle?.checked;
        label.append(input, document.createTextNode(' ' + this.options.toggle!.label)); this.panel.append(label);
        this.events.add(input, 'change', () => this.options.toggle!.onChange(input.checked));
    }
    private bind(): void {
        this.events.add(this.search, 'input', () => this.filter(this.search.value));
        this.events.add(this.search, 'keydown', event => this.handleKeyDown(event as KeyboardEvent));
        this.events.add(this.list, 'mousedown', event => event.preventDefault());
        this.events.add(this.list, 'click', event => this.click(event));
        this.events.add(this.filters, 'click', event => {
            const target = (event.target as HTMLElement).closest<HTMLElement>('[data-popup-group]'); if (!target) return;
            this.group = target.dataset.popupGroup || undefined; this.renderFilters(); this.filter(this.query);
        });
        const reposition = () => {if (this.visible) this.positionPanel();};
        this.events.add(window, 'resize', reposition);
        if (window.visualViewport) {
            this.events.add(window.visualViewport, 'resize', reposition);
            this.events.add(window.visualViewport, 'scroll', reposition);
        }
    }
    show(items: PopupItem[], callbacks: Callbacks): void {
        if (this.closed) return;
        this.items = [...items]; this.callbacks = callbacks; this.group = undefined; this.query = ''; this.search.value = '';
        this.renderFilters(); this.filter(''); this.visible = true; this.panel.classList.add('llm-popup--visible'); this.positionPanel();
        this.anchor.setAttribute('aria-controls', this.list.id); this.anchor.setAttribute('aria-expanded', 'true');
        const style = getComputedStyle(this.anchor);
        for (const name of Array.from(style)) if (name.startsWith('--llm-')) this.panel.style.setProperty(name, style.getPropertyValue(name));
        if (this.options.showSearch && !globalThis.matchMedia?.('(pointer: coarse)').matches) this.search.focus({preventScroll: true});
        this.stopOutside ??= observePopupDismiss([this.anchor, this.panel], () => this.hide());
    }
    hide(): void {
        if (!this.visible) return;
        this.visible = false; this.panel.classList.remove('llm-popup--visible');
        if (this.anchor.getAttribute('aria-controls') === this.list.id) {this.anchor.removeAttribute('aria-controls'); this.anchor.setAttribute('aria-expanded', 'false');}
        this.stopOutside?.(); this.stopOutside = undefined; this.callbacks?.onClose?.();
    }
    updateItems(items: PopupItem[]): void {
        if (this.closed) return; this.items = [...items];
        if (!items.some(item => item.group === this.group)) this.group = undefined;
        this.renderFilters(); this.filter(this.query);
    }
    filter(query: string): void {
        if (this.closed) return; this.query = query;
        const terms = query.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean);
        this.rows = this.items.filter(item => (!this.group || item.group === this.group) && terms.every(term =>
            [item.label, item.description, item.group, item.searchText].some(field => field?.toLocaleLowerCase().includes(term))));
        this.selected = this.shown().findIndex(item => !item.disabled); this.renderItems(); this.list.scrollTop = 0;
    }
    private shown(): PopupItem[] {return this.rows.slice(0, this.options.maxVisible ?? 10);}
    private renderFilters(): void {
        if (!this.options.groupFilterLabel) return;
        const groups = [{value: '', label: this.options.groupFilterLabel}, ...[...new Set(this.items.flatMap(item => item.group ? [item.group] : []))].map(value => ({value, label: value}))];
        this.filters.innerHTML = groups.map(item => `<button type="button" class="llm-popup__filter" data-popup-group="${escapeHTML(item.value)}" aria-pressed="${(this.group ?? '') === item.value}">${escapeHTML(item.label)}</button>`).join('');
    }
    private renderItems(): void {
        if (!this.rows.length) {this.list.innerHTML = `<div class="llm-popup__empty">${escapeHTML(this.options.emptyText ?? this.t('popupEmpty'))}</div>`; return;}
        let group = '';
        this.list.innerHTML = this.shown().map((item, index) => {
            const heading = item.group && item.group !== group ? `<div class="llm-popup__group-title">${escapeHTML(item.group)}</div>` : ''; group = item.group ?? '';
            return heading + renderItem(item, index, index === this.selected, !!this.options.onDelete, this.t('popupRemove'));
        }).join('');
        const remaining = this.rows.length - this.shown().length;
        if (remaining) this.list.insertAdjacentHTML('beforeend', `<div class="llm-popup__more">${escapeHTML(this.t('popupMore', {count: remaining}))}</div>`);
    }
    private click(event: Event): void {
        const target = event.target as HTMLElement, row = target.closest<HTMLElement>('.llm-popup__item'); if (!row) return;
        const index = Number(row.dataset.index), item = this.rows[index]; if (!item) return;
        if (target.closest('.llm-popup__item-delete')) {
            event.stopPropagation(); this.options.onDelete?.(item); this.items = this.items.filter(current => current.id !== item.id);
            this.filter(this.query); if (!this.rows.length) this.hide(); return;
        }
        this.selected = index; this.select();
    }
    handleKeyDown(event: KeyboardEvent): boolean {
        if (!this.visible || event.isComposing || event.keyCode === 229) return false;
        if (['ArrowUp', 'ArrowDown'].includes(event.key)) this.move(event.key === 'ArrowDown' ? 1 : -1);
        else if (event.key === 'Escape') this.hide();
        else if (['Tab', 'Enter'].includes(event.key) && this.rows.length) this.select();
        else return false;
        event.preventDefault(); return true;
    }
    private move(delta: number): void {
        const shown = this.shown(); if (!shown.length) return;
        for (let count = 0; count < shown.length; count++) {
            this.selected = (this.selected + delta + shown.length) % shown.length;
            if (!shown[this.selected].disabled) break;
        }
        this.list.querySelectorAll<HTMLElement>('.llm-popup__item').forEach((row, index) => {
            row.classList.toggle('llm-popup__item--selected', index === this.selected); row.setAttribute('aria-selected', String(index === this.selected));
        });
        this.list.querySelector<HTMLElement>('.llm-popup__item--selected')?.scrollIntoView?.({block: 'nearest'});
    }
    private select(): void {const item = this.rows[this.selected]; if (item && !item.disabled) {try {this.callbacks?.onSelect(item);} finally {this.hide();}}}
    private positionPanel(): void {
        const rect = (this.options.positionAnchor ?? this.anchor).getBoundingClientRect();
        const viewport = window.visualViewport;
        const x = viewport?.offsetLeft ?? 0, y = viewport?.offsetTop ?? 0;
        const viewportWidth = viewport?.width ?? window.innerWidth, viewportHeight = viewport?.height ?? window.innerHeight;
        const width = Math.max(0, Math.min(Math.max(rect.width, this.options.minWidth ?? 0), viewportWidth - 16));
        const left = Math.max(x + 8, Math.min(rect.left, x + viewportWidth - width - 8));
        this.panel.style.maxHeight = '';
        const limit = parseFloat(getComputedStyle(this.panel).maxHeight) || 420;
        const above = Math.max(0, Math.min(rect.top - y - 12, viewportHeight - 16));
        const below = Math.max(0, Math.min(y + viewportHeight - rect.bottom - 12, viewportHeight - 16));
        const openAbove = above >= Math.min(this.panel.scrollHeight, limit) || above >= below;
        const maxHeight = Math.min(limit, openAbove ? above : below);
        Object.assign(this.panel.style, {position: 'fixed', left: `${left}px`, width: `${width}px`, right: 'auto',
            bottom: 'auto', maxHeight: `${maxHeight}px`});
        const height = this.panel.getBoundingClientRect().height;
        const top = openAbove ? rect.top - height - 4 : rect.bottom + 4;
        this.panel.style.top = `${Math.max(y + 8, Math.min(top, y + viewportHeight - height - 8))}px`;
    }
    destroy(): void {
        if (this.closed) return; this.closed = true;
        try {this.hide();} finally {this.events.cleanup(); this.panel.remove(); this.items = []; this.rows = []; this.callbacks = undefined;}
    }
}
function renderItem(item: PopupItem, index: number, selected: boolean, removable: boolean, removeLabel: string): string {
    const classes = ['llm-popup__item', ...(selected ? ['llm-popup__item--selected'] : []), ...(item.hasArgs ? ['llm-popup__item--has-args'] : []), ...(item.group ? ['llm-popup__item--dimmed'] : [])].join(' ');
    const icon = item.icon ? `<span class="llm-popup__item-icon">${item.icon}</span>` : '';
    const description = item.description ? `<span class="llm-popup__item-desc">${escapeHTML(item.description)}</span>` : '';
    const shortcut = item.shortcut ? `<span class="llm-popup__item-shortcut">${escapeHTML(item.shortcut)}</span>` : '';
    const remove = removable ? `<button type="button" class="llm-popup__item-delete" title="${escapeHTML(removeLabel)}" aria-label="${escapeHTML(removeLabel)}">×</button>` : '';
    return `<div class="${classes}" data-index="${index}" role="option" aria-selected="${selected}" aria-disabled="${!!item.disabled}">${icon}<span class="llm-popup__item-label">${escapeHTML(item.label)}</span>${description}${shortcut}${remove}</div>`;
}
