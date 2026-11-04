import {expect, it, vi} from 'vitest';
import {createOperationLedger, mergeOperationRecords} from '../src/operations';
import type {OperationRecord} from '../src/contracts';
const operation = (id: string, status: OperationRecord['status'] = 'submitting'): OperationRecord => ({
    context: {viewId: 'view', operationId: id}, conversationId: 'session', kind: 'send', input: {text: id}, status,
});
it('merges independent operations without losing either view and preserves confirmed terminal facts', () => {
    expect(mergeOperationRecords([operation('a', 'accepted')], [operation('a', 'unknown'), operation('b')]))
        .toEqual([operation('a', 'accepted'), operation('b')]);
    expect(mergeOperationRecords([operation('a', 'unknown')], [operation('a')])[0].status).toBe('unknown');
});
it.each(['input', 'conversationId', 'context'] as const)('rejects conflicting frozen %s for an existing operation', field => {
    const value = operation('a'), conflicting = {...value, [field]: field === 'input' ? {text: 'different'} : field === 'context' ? {viewId: 'other', operationId: 'a'} : 'other'};
    expect(() => mergeOperationRecords([value], [conflicting])).toThrowError(expect.objectContaining({code: 'OPERATION_IDENTITY_CONFLICT'}));
});
it('rejects contradictory terminal results and conflicting confirmed message identities', () => {
    expect(() => mergeOperationRecords([operation('a', 'accepted')], [operation('a', 'rejected')]))
        .toThrowError(expect.objectContaining({code: 'OPERATION_RECEIPT_CONFLICT'}));
    const accepted = {...operation('a', 'accepted'), observedUserMessageId: 'message-a'};
    expect(mergeOperationRecords([accepted], [operation('a', 'accepted')])[0]).toEqual(accepted);
    expect(() => mergeOperationRecords([accepted], [{...accepted, observedUserMessageId: 'message-b'}]))
        .toThrowError(expect.objectContaining({code: 'OPERATION_RECEIPT_CONFLICT'}));
});
it('publishes the persisted merged snapshot before notifying and does not overwrite it with the stale local proposal', async () => {
    const remote = operation('other', 'accepted');
    const save = vi.fn(async (records: readonly OperationRecord[]) => mergeOperationRecords([remote], records));
    const ledger = createOperationLedger({save}), changes: unknown[] = [];
    ledger.subscribe(() => changes.push(ledger.getSnapshot())); await ledger.register(operation('local'));
    expect(changes).toEqual([[remote, operation('local')]]);
    await ledger.settle({operationId: 'local', status: 'accepted'});
    expect(ledger.getSnapshot()).toEqual([remote, operation('local', 'accepted')]);
});
it('leaves the last saved snapshot intact when a persistence merge fails', async () => {
    const save = vi.fn().mockRejectedValue(new Error('Write conflict')), ledger = createOperationLedger({initial: [operation('a')], save});
    await expect(ledger.register(operation('b'))).rejects.toThrow('Write conflict'); expect(ledger.getSnapshot()).toEqual([operation('a')]);
});

it('rejects an incomplete returned persistence snapshot instead of acknowledging an unsaved registration', async () => {
    const ledger = createOperationLedger({save: async () => []});
    await expect(ledger.register(operation('a'))).rejects.toMatchObject({code: 'OPERATION_SAVE_INCOMPLETE'});
    expect(ledger.getSnapshot()).toEqual([]);
});

it('freezes registration and settlement at entry while a preceding save is suspended', async () => {
    let release!: () => void;
    const waiting = new Promise<void>(resolve => {release = resolve;});
    const save = vi.fn().mockImplementationOnce(() => waiting).mockResolvedValue(undefined);
    const ledger = createOperationLedger({save}), first = ledger.register(operation('first'));
    const draft = operation('second'), second = ledger.register(draft);
    const receipt = {operationId: 'second', status: 'accepted' as const}, accepted = ledger.settle(receipt);
    (draft.input as {text: string}).text = 'Later edit'; receipt.operationId = 'first';
    release(); await Promise.all([first, second, accepted]);
    expect(ledger.getSnapshot()).toEqual([operation('first'), operation('second', 'accepted')]);
});
