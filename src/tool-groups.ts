import type {MessagePart} from './contracts';
import type {DisclosureController} from './disclosure';
import type {Translate} from './i18n';
import {element} from './dom';

type Tool = Extract<MessagePart, {kind: 'tool'}>;
export interface ToolGroupEntry {id: string; element: HTMLElement; tools?: readonly Tool[]; continuation?: boolean; groupId?: string; boundary?: boolean}
interface Group {root: HTMLDetailsElement; summary: HTMLElement; body: HTMLElement; members: Set<string>; release(): void}

/** Tool output shares a stable disclosure within adjacency or an explicit host presentation scope. */
export class ToolOutputGroups {
    private groups = new Set<Group>();
    constructor(private readonly container: HTMLElement, private readonly t: Translate, private readonly disclosure: DisclosureController) {}
    sync(entries: readonly ToolGroupEntry[], scope: string): void {
        const used = new Set<Group>(), order: HTMLElement[] = [], previous = new Map<string, Group>();
        for (const group of this.groups) for (const id of group.members) previous.set(id, group);
        for (const run of this.runs(entries)) {
            if (!Array.isArray(run)) {order.push(run.element); continue;}
            const group = run.map(row => previous.get(row.id)).find(group => group && !used.has(group)) ?? this.create(run, scope);
            group.members = new Set(run.map(row => row.id)); used.add(group); order.push(group.root);
            this.summary(group, run.flatMap(row => row.tools ?? [])); this.place(group.body, run.map(row => row.element));
        }
        this.place(this.container, order);
        for (const group of this.groups) if (!used.has(group)) {group.release(); group.root.remove();}
        this.groups = used;
    }
    private runs(entries: readonly ToolGroupEntry[]): Array<ToolGroupEntry | ToolGroupEntry[]> {
        const order: Array<ToolGroupEntry | ToolGroupEntry[]> = [], keyed = new Map<string, ToolGroupEntry[]>();
        let active: ToolGroupEntry[] | undefined;
        for (const entry of entries) {
            if (entry.boundary) {keyed.clear(); active = undefined;}
            if (entry.tools?.length) {
                const prior = this.previousRun(entry, keyed, active);
                const run = prior ?? [];
                if (!prior) {order.push(run); if (entry.groupId) keyed.set(entry.groupId, run);}
                run.push(entry); active = run;
            } else if (entry.continuation && active) active.push(entry);
            else {order.push(entry); active = undefined;}
        }
        return order;
    }
    private previousRun(entry: ToolGroupEntry, keyed: Map<string, ToolGroupEntry[]>, active?: ToolGroupEntry[]): ToolGroupEntry[] | undefined {
        if (entry.groupId) return keyed.get(entry.groupId);
        return active?.[0].groupId ? undefined : active;
    }
    private create(run: readonly ToolGroupEntry[], scope: string): Group {
        const root = element('details', 'llm-tool-group'), summary = element('summary', 'llm-tool-group__summary'), body = element('div', 'llm-tool-group__body');
        summary.dataset.searchExclude = ''; root.append(summary, body);
        const key = (id: string) => JSON.stringify([scope, id, 'tool-group']);
        const anchor = run.find(row => this.disclosure.getState(key(row.id)) !== undefined) ?? run[0];
        const id = key(anchor.id); this.disclosure.initialState(id, true);
        return {root, summary, body, members: new Set(), release: this.disclosure.register({id, element: root})};
    }
    private summary(group: Group, tools: readonly Tool[]): void {
        const busy = tools.filter(tool => tool.state === 'running' || tool.state === 'pending').length;
        const failed = tools.filter(tool => tool.state === 'failed').length;
        const label = [this.t('toolGroupCount', {count: tools.length}), busy ? this.t('toolGroupRunning', {count: busy}) : '',
            failed ? this.t('toolGroupFailed', {count: failed}) : ''].filter(Boolean).join(' · ');
        if (group.summary.textContent !== label) group.summary.textContent = label;
        group.root.dataset.state = busy ? 'running' : failed ? 'failed' : 'settled';
    }
    private place(parent: HTMLElement, children: readonly HTMLElement[]): void {
        let next = parent.firstElementChild;
        for (const child of children) {if (child !== next) parent.insertBefore(child, next); next = child.nextElementSibling;}
    }
    destroy(): void {
        for (const group of this.groups) {group.release(); group.root.replaceWith(...group.body.children);}
        this.groups.clear();
    }
}
