import type {ActionName, BindingDiagnostic, ChatBinding, ChatOptions} from './contracts';
import {disposeAll} from './dom';

/** One view owns one lifetime for each accepted or rejected binding. */
export class BindingLifetime {
    private active?: boolean;
    private released?: Promise<void>;
    constructor(private readonly binding: Pick<ChatBinding, 'setActive' | 'release'>) {}
    setActive(active: boolean): void {
        if (this.released || this.active === active) return;
        this.active = active; this.binding.setActive?.(active);
    }
    release(): Promise<void> {
        if (this.released) return this.released;
        this.released = Promise.resolve().then(() => disposeAll([
            () => {if (this.active !== false) {this.active = false; this.binding.setActive?.(false);}},
            () => this.binding.release?.(),
        ]));
        return this.released;
    }
}

export function assertBinding(binding: ChatBinding): void {
    if (['send', 'command', 'cancel', 'edit', 'retry', 'respond'].some(kind => !!binding.actions[kind as ActionName])
        && !binding.actions.reconcile) throw Object.assign(new Error('Mutating hosts must provide operation reconciliation'), {code: 'RECONCILE_REQUIRED'});
}
export function replaceBindingOptions(previous: ChatOptions, binding: ChatBinding): ChatOptions {
    const {features, flow, presentButton, translate, locale, onError, onDiagnostic, onBindingDiagnostic} = previous;
    return {...binding, features, flow, presentButton, translate, locale, onError, onDiagnostic, onBindingDiagnostic};
}

/** Disabled observations ignore late notifications even if a host unsubscribe fails. */
export class BindingObservation {
    private active = false;
    private releases: (() => void)[] = [];
    constructor(binding: ChatBinding, changed: () => void, operationChanged: () => void) {
        try {
            this.releases.push(binding.source.subscribe(() => {if (this.active) changed();}));
            this.releases.push(binding.operations.subscribe(() => {if (this.active) operationChanged();}));
        } catch (error) {
            try {this.destroy();} catch (cleanup) {throw new AggregateError([error, cleanup], 'Binding subscription failed');}
            throw error;
        }
    }
    activate(): void {this.active = true;}
    destroy(): void {
        this.active = false;
        const releases = this.releases; this.releases = [];
        const failures: unknown[] = [];
        for (const release of releases) {try {release();} catch (error) {failures.push(error);}}
        if (failures.length) throw new AggregateError(failures, 'Binding observation cleanup failed');
    }
}
export function diagnoseBinding(report: ChatOptions['onBindingDiagnostic'], operationId: string,
    stage: BindingDiagnostic['stage'], started: number, error?: unknown): void {
    const code = (error as {code?: unknown})?.code;
    const safe = typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(code) ? code : 'BINDING_CHANGE_FAILED';
    const event: BindingDiagnostic = {operationId, stage, result: error ? 'failed' : 'success', durationMs: Date.now() - started,
        ...(error ? {code: safe} : {})};
    try {if (report) report(event); else console.debug('[llm-ui] Binding', event);} catch { /* Diagnostics do not own binding changes. */ }
}
