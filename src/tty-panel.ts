import {element} from './dom';
import {translator} from './i18n';
import type {Translation} from './contracts';

export interface TtyPanelOptions {locale?: 'zh-CN' | 'en'; translate?: Translation}
const maxOutputCharacters = 100000;

/** Bounded presentation only; process control and exit facts belong to the host. */
export class TtyPanel {
    private readonly root = element('div', 'llm-ui-tty-panel');
    private readonly output = element('pre', 'llm-ui-tty-panel__output');
    private readonly text = document.createTextNode('');
    private readonly status = element('span', 'llm-ui-tty-panel__status llm-ui-tty-panel__status--running');
    private readonly t;
    private exited = false;
    private closed = false;
    constructor(container: HTMLElement, readonly sessionId: string, command: string, pid: number | undefined, options: TtyPanelOptions = {}) {
        this.t = translator(options.locale, options.translate); this.root.dataset.sessionId = sessionId;
        const header = element('div', 'llm-ui-tty-panel__header');
        header.append(element('span', 'llm-ui-tty-panel__cmd', '$ ' + command));
        if (pid !== undefined) header.append(element('span', 'llm-ui-tty-panel__pid', 'PID:' + pid));
        this.status.textContent = this.t('ttyRunning'); header.append(this.status);
        this.output.append(this.text); this.root.append(header, this.output); container.append(this.root);
    }
    appendOutput(chunk: string): void {
        if (this.exited || this.closed || !chunk) return;
        const tail = chunk.length > maxOutputCharacters ? chunk.slice(-maxOutputCharacters) : chunk;
        this.text.appendData(tail);
        if (this.text.length > maxOutputCharacters) this.text.deleteData(0, this.text.length - maxOutputCharacters);
        const first = this.text.data.charCodeAt(0);
        if (first >= 0xdc00 && first <= 0xdfff) this.text.deleteData(0, 1);
        this.output.scrollTop = this.output.scrollHeight;
    }
    finalize(exitCode: number | null): void {
        if (this.exited || this.closed) return; this.exited = true;
        this.status.className = 'llm-ui-tty-panel__status llm-ui-tty-panel__status--exited';
        this.status.textContent = this.t(exitCode === null ? 'ttyStopped' : 'ttyExited');
        this.root.append(element('div', 'llm-ui-tty-panel__exit-info', this.t(exitCode === null ? 'ttyExitUnknown' : 'ttyExitKnown', {code: exitCode ?? ''})));
    }
    destroy(): void {this.closed = true; this.root.remove(); this.text.data = '';}
}
