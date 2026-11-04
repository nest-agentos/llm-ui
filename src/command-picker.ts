import type {ComposerCommand} from './contracts';
import {parseCommand} from './commands';
import {PopupPanel} from './popup-panel';
import type {Translate} from './i18n';

/** Command semantics stay here; all candidate UI uses the shared popup. */
export class CommandPicker {
    private commands: readonly ComposerCommand[] = [];
    private chosen?: {id: string; revision: number; name: string};
    private active = true;
    private panel?: PopupPanel;
    private readonly blur = () => this.panel?.hide();
    constructor(private readonly input: HTMLTextAreaElement, private readonly insert: (text: string) => void, private readonly t: Translate) {
        this.input.addEventListener('blur', this.blur);
    }
    update(commands: readonly ComposerCommand[]): void {this.commands = commands; if (this.panel?.isVisible) this.refresh();}
    refresh(): void {
        const match = this.input.value.match(/^\/([\p{L}\p{N}_:.-]*)$/u);
        if (this.chosen && parseCommand(this.input.value)?.name !== this.chosen.name) this.chosen = undefined;
        if (!this.active || !match) {this.panel?.hide(); return;}
        const query = match[1].toLocaleLowerCase();
        const rows = this.commands.filter(command => !command.disabled && [command.name, command.description, command.source.label].join(' ').toLocaleLowerCase().includes(query));
        this.panel ??= new PopupPanel(this.input, {maxVisible: 30, translate: (key, parameters) => this.t(key as Parameters<Translate>[0], parameters)});
        this.panel.element.dataset.chatCommands = '';
        this.panel.show(rows.map(command => ({id: command.id, label: `/${command.name} · ${command.source.label}`, description: command.description})), {
            onSelect: item => {const command = rows.find(command => command.id === item.id); if (command) this.choose(command);},
        });
    }
    private choose(command: ComposerCommand): void {
        this.chosen = {id: command.id, revision: command.revision, name: command.name};
        this.insert('/' + command.name + ' '); this.panel?.hide(); this.input.focus();
    }
    key(event: KeyboardEvent): boolean {return this.panel?.handleKeyDown(event) ?? false;}
    resolve(text: string): {command: ComposerCommand; arguments: string} | undefined {
        const parsed = parseCommand(text); if (!parsed) return;
        const rows = this.commands.filter(command => command.name === parsed.name && !command.disabled);
        const target = this.chosen?.name === parsed.name ? rows.find(row => row.id === this.chosen!.id && row.revision === this.chosen!.revision)
            : rows.length === 1 ? rows[0] : undefined;
        if (!target) throw new Error(rows.length > 1 ? this.t('commandAmbiguous') : this.t('commandUnavailable'));
        return {command: target, arguments: parsed.arguments};
    }
    setActive(active: boolean): void {this.active = active; if (!active) this.panel?.hide();}
    reset(): void {this.chosen = undefined; this.commands = []; this.panel?.hide();}
    destroy(): void {this.panel?.destroy(); this.panel = undefined; this.input.removeEventListener('blur', this.blur);}
}
