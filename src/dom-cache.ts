/** Cache child identities within one retained view, including detached view roots. */
export class DOMCache {
    private readonly cache = new Map<string, WeakRef<HTMLElement>>();
    constructor(private readonly root: HTMLElement) {}
    byId(id: string): HTMLElement | null {
        const cached = this.cache.get(id)?.deref();
        if (cached && cached.id === id && this.root.contains(cached)) return cached;
        this.cache.delete(id);
        const node = /^[A-Za-z_][\w-]*$/.test(id) ? this.root.querySelectorAll<HTMLElement>(`#${id}`)[0]
            : [...this.root.querySelectorAll<HTMLElement>('[id]')].find(node => node.id === id);
        if (node) this.cache.set(id, new WeakRef(node));
        return node ?? null;
    }
    invalidate(id?: string): void {if (id === undefined) this.cache.clear(); else this.cache.delete(id);}
    destroy(): void {this.cache.clear();}
}
