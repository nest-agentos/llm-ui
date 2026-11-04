import {persistedOperationSnapshot} from './operations-merge';
export {mergeOperationRecords} from './operations-merge';
import type { OperationLedger, OperationReceipt, OperationRecord } from './contracts';

export interface OperationLedgerOptions {
    readonly initial?: readonly OperationRecord[];
    readonly save?: (records: readonly OperationRecord[]) => Promise<void | readonly OperationRecord[]>;
    readonly onError?: (error: unknown) => void;
}

/** Publish only saved immutable versions; action dispatch waits for registration. */
export function createOperationLedger(options: OperationLedgerOptions = {}): OperationLedger {
    let records: readonly OperationRecord[] = structuredClone(options.initial ?? []);
    let tail = Promise.resolve();
    const listeners = new Set<() => void>();
    const mutate = (change: () => readonly OperationRecord[]) => {
        const task = tail.catch(() => {}).then(async () => {
            const next = change();
            if (next === records) return;
            const persisted = await options.save?.(next);
            records = persisted ? persistedOperationSnapshot(next, persisted) : next;
            for (const listener of listeners) {
                try { listener(); } catch (error) { options.onError?.(error); }
            }
        });
        tail = task;
        return task;
    };
    return {
        getSnapshot: () => records,
        subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
        register: record => {
            const frozen = structuredClone(record);
            return mutate(() => {
                if (records.some(item => item.context.operationId === frozen.context.operationId)) throw new Error('Duplicate operation identity');
                return [...records, frozen];
            });
        },
        settle: receipt => {
            const frozen = structuredClone(receipt);
            return mutate(() => settle(records, frozen, options.onError));
        },
    };
}

function settle(records: readonly OperationRecord[], receipt: OperationReceipt,
    report?: (error: unknown) => void): readonly OperationRecord[] {
    const current = records.find(item => item.context.operationId === receipt.operationId);
    if (!current) throw new Error('Unknown operation identity');
    if (current.status === 'accepted' || current.status === 'rejected') {
        if (receipt.status !== 'unknown' && receipt.status !== current.status)
            report?.(new Error(`Conflicting receipt: ${receipt.operationId}`));
        if (current.status === 'accepted' && receipt.status === 'accepted' && receipt.observedUserMessageId && !current.observedUserMessageId)
            return records.map(item => item === current ? { ...item, observedUserMessageId: receipt.observedUserMessageId } : item);
        return records;
    }
    const next = { ...current, status: receipt.status, message: 'message' in receipt ? receipt.message : undefined,
        submissionRef: receipt.status === 'accepted' ? receipt.submissionRef : current.submissionRef,
        observedUserMessageId: receipt.status === 'accepted' ? receipt.observedUserMessageId : current.observedUserMessageId };
    return records.map(item => item === current ? next : item);
}
