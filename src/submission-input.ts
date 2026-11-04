import type {ChatSubmission, OperationRecord} from './contracts';

/** Read the frozen structured input without interpreting command payloads or display text. */
export function getOperationCallInput(record?: OperationRecord): ChatSubmission['input'] {
    if (record?.kind !== 'send' || !object(record.input) || !object(record.input.input)) return;
    const input = record.input.input;
    if (typeof input.targetId !== 'string' || !object(input.signature) || !object(input.values)) return;
    const signature = input.signature;
    if (typeof signature.id !== 'string' || !Number.isSafeInteger(signature.revision) || typeof signature.digest !== 'string') return;
    return input as unknown as NonNullable<ChatSubmission['input']>;
}
function object(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}
