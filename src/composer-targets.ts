import {SelectPicker} from './select-picker';
import type {PopupPanelOptions} from './popup-panel';
import type {CallTargetCatalog, CallTargetRef, ComposerInputContract} from './contracts';
import type {Translate} from './i18n';
import {element} from './dom';

/** Only the host's published catalog can turn a selected row into an executable target. */
export class ComposerTargets {
    readonly element = element('div', 'llm-chat__selectors');
    private readonly select = element('select');
    private readonly feedback = element('p', 'llm-chat__target-notice');
    private catalog?: CallTargetCatalog;
    private selected?: CallTargetRef;
    private readonly picker: SelectPicker;
    private readonly caption = element('span', 'llm-chat__selector-label');
    constructor(private readonly t: Translate, private readonly changed: (target: CallTargetRef) => void, options: PopupPanelOptions = {}) {
        const label = element('label'); this.caption.textContent = t('callTarget'); label.append(this.caption); this.select.dataset.callTarget = '';
        this.select.setAttribute('aria-label', t('callTarget')); this.picker = new SelectPicker(this.select, t('callTarget'), {minWidth: 360, variant: 'targets', ...options, groupFilterLabel: t('allChoices'), maxVisible: Number.POSITIVE_INFINITY});
        label.append(this.select, this.picker.trigger); this.element.append(label, this.feedback);
        this.select.addEventListener('change', () => {
            const choice = this.catalog?.entries.find(entry => entry.id === this.select.value);
            if (choice) this.changed({...choice.target});
        });
    }
    update(catalog?: CallTargetCatalog, target?: CallTargetRef): void {
        this.catalog = catalog; this.selected = target; this.element.hidden = !catalog;
        if (!catalog) return;
        this.caption.textContent = catalog.label ?? this.t('callTarget');
        this.picker.trigger.setAttribute('aria-label', catalog.label ?? this.t('callTarget'));
        this.select.setAttribute('aria-label', catalog.label ?? this.t('callTarget'));
        if (!target && catalog.autoSelectFirst !== false && catalog.entries.length) {this.changed({...catalog.entries[0].target}); return;}
        const chosen = this.choice(); this.select.replaceChildren();
        if (!chosen) {const option = element('option', undefined, this.t('chooseTarget')); option.value = ''; option.disabled = true; this.select.append(option);}
        const groups = new Map<string, HTMLOptGroupElement>();
        for (const entry of catalog.entries) {
            const option = element('option', undefined, entry.label); option.value = entry.id;
            if (entry.icon) option.dataset.icon = entry.icon; if (entry.description) option.dataset.description = entry.description;
            if (!entry.group) {this.select.append(option); continue;}
            let group = groups.get(entry.group);
            if (!group) {group = element('optgroup'); group.label = entry.group; groups.set(entry.group, group); this.select.append(group);}
            group.append(option);
        }
        this.select.value = chosen?.id ?? ''; this.select.disabled = catalog.loading || !catalog.entries.length;
        this.feedback.textContent = catalog.message ?? ''; this.picker.update();
    }
    get target(): CallTargetRef | undefined {const choice = this.choice(); return choice && {...choice.target};}
    get contract(): ComposerInputContract | undefined {
        const choice = this.choice();
        return choice?.inputContract && {...choice.inputContract, targetId: choice.id, target: {...choice.target}};
    }
    get enabled(): boolean {return this.catalog !== undefined;}
    issue(): string | undefined {
        if (!this.catalog) return;
        return this.catalog.error ?? (this.catalog.loading ? this.t('loading') : !this.catalog.entries.length ? this.t('noTargets') : !this.choice() ? this.t(this.selected ? 'changedTarget' : 'chooseTarget') : undefined);
    }
    hide(): void {this.picker.hide();}
    destroy(): void {this.picker.destroy();}
    private choice() {return this.catalog?.entries.find(entry => sameCallTarget(entry.target, this.selected));}
}

export function sameCallTarget(left?: CallTargetRef, right?: CallTargetRef): boolean {
    return !left || !right ? left === right : left.kind === right.kind && left.id === right.id
        && left.version === right.version && left.digest === right.digest;
}
