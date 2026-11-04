import {button, element} from './dom';
import {PopupPanel, type PopupPanelOptions} from './popup-panel';

/** The native select remains the canonical value; the shared popup only presents its choices. */
export class SelectPicker {
    readonly trigger: HTMLButtonElement;
    private readonly text = element('span', 'llm-chat__picker-label');
    private readonly popup: PopupPanel;
    private readonly changed = () => this.update();
    constructor(private readonly select: HTMLSelectElement, label: string, options: PopupPanelOptions = {}) {
        this.trigger = button(label, () => this.toggle()); this.trigger.className = 'llm-chat__picker';
        if (select.dataset.selectorId) this.trigger.dataset.selectorTrigger = select.dataset.selectorId;
        this.trigger.setAttribute('aria-label', label); this.trigger.setAttribute('aria-haspopup', 'listbox');
        this.trigger.setAttribute('aria-expanded', 'false'); this.trigger.append(this.text, element('span', 'llm-chat__picker-chevron'));
        this.trigger.firstChild!.remove(); this.select.hidden = true; this.select.tabIndex = -1;
        this.popup = new PopupPanel(this.trigger, {showSearch: true, minWidth: 300, maxVisible: Number.POSITIVE_INFINITY, ...options});
        this.select.addEventListener('change', this.changed);
        this.trigger.addEventListener('keydown', event => {
            if (event.isComposing) return;
            if (this.popup.handleKeyDown(event)) return;
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {event.preventDefault(); this.toggle();}
        });
        this.update();
    }
    get ownsFocus(): boolean {return this.trigger === document.activeElement || this.popup.element.contains(document.activeElement);}
    update(): void {
        this.trigger.disabled = this.select.disabled;
        this.text.textContent = this.select.selectedOptions[0]?.textContent ?? this.trigger.getAttribute('aria-label');
        this.trigger.title = this.text.textContent ?? '';
        if (this.select.disabled) this.popup.hide();
        else if (this.popup.isVisible) this.popup.updateItems(this.items());
    }
    private toggle(): void {
        if (this.popup.isVisible) {this.popup.hide(); return;}
        if (this.select.disabled) return;
        this.popup.show(this.items(),
        {onSelect: item => {this.select.value = item.id; this.select.dispatchEvent(new Event('change', {bubbles: true}));},
            onClose: () => {if (this.popup.element.contains(document.activeElement)) this.trigger.focus();}});
    }
    private items() {return Array.from(this.select.options).filter(option => option.value !== '' || !option.disabled).map(option => ({id: option.value, label: option.textContent ?? '', disabled: option.disabled, icon: option.dataset.icon, description: option.dataset.description,
        group: option.parentElement instanceof HTMLOptGroupElement ? option.parentElement.label : undefined}));}
    hide(): void {this.popup.hide();}
    destroy(): void {this.select.removeEventListener('change', this.changed); this.popup.destroy(); this.trigger.remove();}
}
