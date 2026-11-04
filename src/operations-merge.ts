import type {OperationRecord} from './contracts';

/** Merge saved facts; stale views cannot erase another operation or regress a terminal receipt. */
export function mergeOperationRecords(saved: readonly OperationRecord[], incoming: readonly OperationRecord[]): readonly OperationRecord[] {
    const records = new Map<string, OperationRecord>();
    for (const record of [...saved, ...incoming]) {
        validate(record);
        const id = record.context.operationId, previous = records.get(id);
        records.set(id, previous ? mergeRecord(previous, record) : record);
    }
    return structuredClone([...records.values()]);
}
export function persistedOperationSnapshot(proposed: readonly OperationRecord[], persisted: readonly OperationRecord[]): readonly OperationRecord[] {
    const saved = mergeOperationRecords([], persisted);
    if (canonical(saved) !== canonical(mergeOperationRecords(saved, proposed))) throw failure('OPERATION_SAVE_INCOMPLETE');
    return saved;
}
function mergeRecord(saved: OperationRecord, incoming: OperationRecord): OperationRecord {
    const identity = (record: OperationRecord) => ({context: record.context, conversationId: record.conversationId,
        kind: record.kind, input: record.input, draft: record.draft});
    if (canonical(identity(saved)) !== canonical(identity(incoming))) throw failure('OPERATION_IDENTITY_CONFLICT');
    if (terminal(saved) && terminal(incoming)) {
        if (saved.status !== incoming.status) throw failure('OPERATION_RECEIPT_CONFLICT');
        for (const key of ['observedUserMessageId', 'submissionRef'] as const)
            if (saved[key] && incoming[key] && saved[key] !== incoming[key]) throw failure('OPERATION_RECEIPT_CONFLICT');
        return {...incoming, ...saved, observedUserMessageId: saved.observedUserMessageId ?? incoming.observedUserMessageId,
            submissionRef: saved.submissionRef ?? incoming.submissionRef};
    }
    if (terminal(saved)) return saved;
    if (terminal(incoming)) return incoming;
    return saved.status === 'unknown' && incoming.status === 'submitting' ? saved : incoming;
}
function terminal(record: OperationRecord): boolean {return record.status === 'accepted' || record.status === 'rejected';}
function canonical(value: unknown): string {
    return JSON.stringify(value, (_key, entry) => entry && typeof entry === 'object' && !Array.isArray(entry)
        ? Object.fromEntries(Object.keys(entry).sort().map(key => [key, entry[key]])) : entry);
}
function validate(record: OperationRecord): void {
    if (!record || !record.context || typeof record.context.operationId !== 'string' || !record.context.operationId
        || typeof record.context.viewId !== 'string' || typeof record.conversationId !== 'string' || !record.conversationId
        || typeof record.kind !== 'string' || !record.kind
        || !['submitting', 'unknown', 'accepted', 'rejected'].includes(record.status) || record.input === undefined)
        throw failure('OPERATION_RECORD_INVALID');
}
function failure(code: string): Error {
    const messages: Record<string, string> = {OPERATION_IDENTITY_CONFLICT: 'Operation identity conflicts with saved input',
        OPERATION_RECEIPT_CONFLICT: 'Operation receipts conflict', OPERATION_RECORD_INVALID: 'Invalid saved operation record',
        OPERATION_SAVE_INCOMPLETE: 'The saved journal does not contain the proposed operation'};
    return Object.assign(new Error(messages[code] ?? code), {code});
}
