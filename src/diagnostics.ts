import type {OperationDiagnostic} from './contracts';

/** Diagnostics never expose operation input or alter acceptance and recovery. */
export function diagnoseOperation(report: ((event: OperationDiagnostic) => void) | undefined,
    event: Omit<OperationDiagnostic, 'durationMs' | 'code'>, started: number, code?: unknown): void {
    const safe = typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(code) ? code : undefined;
    const diagnostic = {...event, durationMs: Date.now() - started, ...(safe ? {code: safe} : {})};
    try {
        if (report) report(diagnostic);
        else console.debug('[llm-ui] Operation', diagnostic);
    } catch { /* Diagnostics cannot change the operation outcome. */ }
}
