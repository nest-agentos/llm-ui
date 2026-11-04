export interface DisclosureEntry {id: string; element: HTMLElement; trigger?: HTMLElement}
export type DisclosureLocation = {kind: 'item'; id: string} | {kind: 'start' | 'end'};
export interface DisclosureOptions {
    initialStates?: Readonly<Record<string, boolean>>;
    entries?(): readonly DisclosureEntry[];
    titleHeight?: number;
    present?(entry: DisclosureEntry, collapsed: boolean): void;
    onReveal?(entry?: DisclosureEntry): void;
    onChange?(states: Record<string, boolean>): void;
}

/** Stable identities own disclosure state; hosts supply their own rows and presentation policy. */
export class DisclosureController {
    private readonly states = new Map<string, boolean>();
    private readonly registered = new Map<string, DisclosureEntry>();
    private readonly stops = new Set<() => void>();
    constructor(private readonly container: HTMLElement, private readonly options: DisclosureOptions = {}) {
        for (const [id, collapsed] of Object.entries(options.initialStates ?? {})) this.states.set(id, collapsed);
    }
    getStates(): Record<string, boolean> {return Object.fromEntries(this.states);}
    getState(id: string): boolean | undefined {return this.states.get(id);}
    setState(id: string, collapsed: boolean): void {this.states.set(id, collapsed);}
    resetStates(): void {this.states.clear();}
    initialState(id: string, fallback: boolean): boolean {
        if (!this.states.has(id)) this.states.set(id, fallback);
        return this.states.get(id)!;
    }
    entries(): readonly DisclosureEntry[] {return this.options.entries?.() ?? [...this.registered.values()];}
    isCollapsed(entry: DisclosureEntry): boolean {
        return entry.element.tagName === 'DETAILS' ? !(entry.element as HTMLDetailsElement).open : entry.element.classList.contains('is-collapsed');
    }
    register(entry: DisclosureEntry): () => void {
        this.registered.set(entry.id, entry);
        const collapsed = this.initialState(entry.id, entry.element.tagName === 'DETAILS' ? !(entry.element as HTMLDetailsElement).open : entry.element.classList.contains('is-collapsed'));
        this.apply(entry, collapsed);
        const toggle = () => {
            if (this.registered.get(entry.id) !== entry) return;
            const next = !(entry.element as HTMLDetailsElement).open;
            if (this.states.get(entry.id) === next) return;
            this.states.set(entry.id, next); this.present(entry, next);
            if (!next) this.options.onReveal?.(entry); this.notify();
        };
        if (entry.element.tagName === 'DETAILS') entry.element.addEventListener('toggle', toggle);
        const stop = () => {entry.element.removeEventListener('toggle', toggle); if (this.registered.get(entry.id) === entry) this.registered.delete(entry.id); this.stops.delete(stop);};
        this.stops.add(stop); return stop;
    }
    toggle(entry: DisclosureEntry, force?: boolean, notify = true): boolean {
        const previous = this.isCollapsed(entry), next = force ?? !previous;
        this.states.set(entry.id, next); this.apply(entry, next);
        if (!next) this.options.onReveal?.(entry); if (notify) this.notify();
        return previous && !next;
    }
    setAllCollapsed(collapsed: boolean): void {
        for (const entry of this.entries()) {this.states.set(entry.id, collapsed); this.apply(entry, collapsed);}
        if (!collapsed) this.options.onReveal?.(); this.notify();
    }
    shouldCollapse(): boolean {return this.entries().some(entry => !this.isCollapsed(entry));}
    findUnfoldedByViewport(direction: 'current' | 'prev' | 'next', entries = this.entries()): DisclosureLocation | undefined {
        const all = entries.filter(entry => !this.states.get(entry.id) && !this.isCollapsed(entry)); if (!all.length) return;
        const viewport = this.container.getBoundingClientRect(), title = this.options.titleHeight ?? 48;
        const above = all.filter(entry => entry.element.getBoundingClientRect().top + title < viewport.top);
        const below = all.filter(entry => entry.element.getBoundingClientRect().top > viewport.bottom);
        const inside = all.filter(entry => !above.includes(entry) && !below.includes(entry));
        const item = (entry?: DisclosureEntry): DisclosureLocation | undefined => entry ? {kind: 'item', id: entry.id} : undefined;
        const lastAbove = above.at(-1);
        if (direction === 'current') return item(inside[0] ?? (lastAbove && lastAbove.element.getBoundingClientRect().bottom > viewport.top ? lastAbove : undefined));
        if (direction === 'prev') {
            const hidden = all.find(entry => {const rect = entry.element.getBoundingClientRect(); return rect.top + title < viewport.top && rect.bottom > viewport.top;});
            return item(hidden ?? above.at(-1)) ?? (this.container.scrollTop > 0 ? {kind: 'start'} : undefined);
        }
        return item(below[0]) ?? (above.length + inside.length === all.length ? {kind: 'end'} : undefined);
    }
    private apply(entry: DisclosureEntry, collapsed: boolean): void {
        if (entry.element.tagName === 'DETAILS') (entry.element as HTMLDetailsElement).open = !collapsed;
        else entry.element.classList.toggle('is-collapsed', collapsed);
        this.present(entry, collapsed);
    }
    private present(entry: DisclosureEntry, collapsed: boolean): void {
        entry.trigger?.setAttribute('aria-expanded', String(!collapsed)); this.options.present?.(entry, collapsed);
    }
    private notify(): void {this.options.onChange?.(this.getStates());}
    destroy(): void {for (const stop of [...this.stops]) stop(); this.states.clear();}
}
