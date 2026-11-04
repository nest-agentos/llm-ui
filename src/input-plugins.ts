import {randomUUID} from './random';
/** Editing capabilities only; hosts may extend this context with their own policy. */
export interface InputPluginContext {
    textarea: HTMLTextAreaElement;
    container: HTMLElement;
    getText(): string;
    getDraftRevision?(): number;
    setText(text: string): void;
    insertAtCursor(text: string): void;
    replaceRange(start: number, end: number, text: string): void;
    getCursorPosition(): number;
    setCursorPosition(position: number): void;
    triggerSend(): void;
    focus(): void;
}
export interface InputPlugin<Context extends InputPluginContext = InputPluginContext, Sent = unknown> {
    readonly id: string;
    readonly priority?: number;
    activate(context: Context): void;
    deactivate(): void;
    setActive?(active: boolean): void;
    onKeyDown?(event: KeyboardEvent): boolean;
    onInput?(text: string, cursor: number): void;
    onBeforeSend?(text: string): boolean | void;
    onAfterSend?(text: string, sent: Sent): void;
    onFocus?(): void;
    onBlur?(): void;
}

/** Ordered hook dispatch and view ownership are identical for every host. */
export class InputPluginRegistry<Context extends InputPluginContext = InputPluginContext, Sent = unknown> {
    private items: InputPlugin<Context, Sent>[] = [];
    private readonly started = new Set<InputPlugin<Context, Sent>>();
    private context?: Context;
    private active = true;
    get plugins(): readonly InputPlugin<Context, Sent>[] {return this.items;}
    register(plugin: InputPlugin<Context, Sent>): void {
        if (this.items.some(item => item.id === plugin.id)) throw new Error(`Duplicate input plugin: ${plugin.id}`);
        this.items.push(plugin); this.items.sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
        if (this.context) this.start(plugin);
    }
    setContext(context: Context): void {
        if (this.context) this.stop(); this.context = context;
        for (const plugin of this.items) this.start(plugin);
    }
    replace(plugins: readonly InputPlugin<Context, Sent>[], retain = false): void {
        const previous = this.items;
        this.stop(retain ? previous.filter(plugin => !plugins.includes(plugin)) : previous);
        this.items = [];
        for (const plugin of plugins) this.register(plugin);
    }
    private start(plugin: InputPlugin<Context, Sent>): void {
        if (this.started.has(plugin)) return;
        this.started.add(plugin); this.invoke(plugin, 'activate', () => {plugin.activate(this.context!); plugin.setActive?.(this.active);});
    }
    key(event: KeyboardEvent): boolean {
        if (!this.active || event.isComposing || event.keyCode === 229) return false;
        return this.items.some(plugin => this.invoke(plugin, 'keydown', () => plugin.onKeyDown?.(event)));
    }
    input(text: string, cursor: number): void {if (this.active) for (const plugin of this.items) this.invoke(plugin, 'input', () => plugin.onInput?.(text, cursor));}
    beforeSend(text: string): boolean {return this.active && this.items.every(plugin => this.invoke(plugin, 'before-send', () => plugin.onBeforeSend?.(text)) !== false);}
    afterSend(text: string, sent: Sent): void {for (const plugin of this.items) this.invoke(plugin, 'after-send', () => plugin.onAfterSend?.(text, sent));}
    focus(): void {if (this.active) for (const plugin of this.items) this.invoke(plugin, 'focus', () => plugin.onFocus?.());}
    blur(): void {for (const plugin of this.items) this.invoke(plugin, 'blur', () => plugin.onBlur?.());}
    setActive(active: boolean): void {
        if (this.active === active) return;
        this.active = active;
        for (const plugin of this.started) this.invoke(plugin, 'activation', () => plugin.setActive?.(active));
        if (!active) this.blur();
    }
    private stop(plugins: readonly InputPlugin<Context, Sent>[] = this.items): void {
        const errors: unknown[] = [];
        for (const plugin of plugins) if (this.started.delete(plugin)) {
            try {this.invoke(plugin, 'release', () => plugin.deactivate());} catch (error) {errors.push(error);}
        }
        if (errors.length) throw new AggregateError(errors, 'Input plugin disposal failed');
    }
    destroy(): void {try {this.stop();} finally {this.items = []; this.context = undefined;}}
    private invoke<T>(plugin: InputPlugin<Context, Sent>, stage: string, run: () => T): T {
        const started = Date.now();
        try {return run();} catch (error) {
            const raw = (error as {code?: unknown})?.code;
            console.warn('[llm-ui] Input plugin', {operationId: randomUUID(), stage, result: 'failure', durationMs: Date.now() - started,
                pluginId: /^[\w.:-]{1,128}$/.test(plugin.id) ? plugin.id : 'custom',
                code: typeof raw === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(raw) ? raw : 'INPUT_PLUGIN_FAILED'});
            throw error;
        }
    }
}
