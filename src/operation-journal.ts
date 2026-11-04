import type {OperationDiagnostic, OperationLedger, OperationReceipt, OperationRecord} from './contracts';
import {diagnoseOperation} from './diagnostics';

interface JournalHost {
    readonly operations: OperationLedger;
    readonly onDiagnostic?: (event: OperationDiagnostic) => void;
}

/** Delegate persistence to the host's existing ledger, preserving its single ownership. */
export async function registerOperation(host: JournalHost, record: OperationRecord): Promise<boolean> {
    const started = Date.now(), metadata = {operationId: record.context.operationId, kind: record.kind, stage: 'register' as const};
    try {
        await host.operations.register(record);
        const saved = host.operations.getSnapshot().find(item => item.context.operationId === record.context.operationId);
        if (!saved) throw new Error('Operation registration was not saved');
        diagnoseOperation(host.onDiagnostic, {...metadata, result: saved.status === 'submitting' ? 'success' : saved.status}, started);
        if (saved.status === 'accepted') return false;
        if (saved.status !== 'submitting') throw new Error(saved.message ?? 'Operation is awaiting reconciliation or was rejected');
        return true;
    } catch (error) {
        diagnoseOperation(host.onDiagnostic, {...metadata, result: 'failed'}, started, 'OPERATION_REGISTRATION_FAILED');
        throw error;
    }
}

export async function settleOperation(host: JournalHost, receipt: OperationReceipt, kind: OperationRecord['kind']): Promise<void> {
    const started = Date.now(), metadata = {operationId: receipt.operationId, kind, stage: 'receipt' as const};
    try {
        await host.operations.settle(receipt);
        diagnoseOperation(host.onDiagnostic, {...metadata, result: receipt.status}, started);
    } catch (error) {
        diagnoseOperation(host.onDiagnostic, {...metadata, result: 'failed'}, started, 'OPERATION_RECEIPT_PERSIST_FAILED');
        throw error;
    }
}
