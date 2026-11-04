import type { AssetProvider, MDxPlugin } from '@itookit/mdxeditor';
import type { FlowOptions } from './flow-contracts';

export type JsonValue = null | boolean | number | string | readonly JsonValue[]
    | { readonly [key: string]: JsonValue };
export type ActionName = 'send' | 'command' | 'cancel' | 'retry' | 'edit' | 'respond';
export type OperationKind = ActionName | 'flow.add-node' | 'flow.update-node' | 'flow.remove-node'
    | 'flow.connect' | 'flow.disconnect' | 'flow.save' | 'flow.run' | 'flow.cancel';
export interface AttachmentRef { readonly id: string; readonly name: string; readonly mimeType?: string }
export interface DraftAttachment { readonly id: string; readonly file: AttachmentRef; readonly revision?: number }
/** The host supplies image processing without introducing an image-library dependency. */
export interface ImageEditingPort {
    getRevision?(): string;
    subscribe?(changed: () => void): () => void;
    refresh?(items: readonly DraftAttachment[], options: {signal: AbortSignal}): ReturnType<ImageEditingPort['edit']>;
    prepare?(file: File, options: {signal: AbortSignal}): Promise<File>;
    uploaded?(file: File, ref: AttachmentRef, options: {signal: AbortSignal}): Promise<void>;
    edit(items: readonly DraftAttachment[], activeId: string, options: {signal: AbortSignal}): Promise<readonly {
        readonly id: string; readonly expectedFileId: string; readonly expectedRevision: number; readonly file: AttachmentRef;
    }[] | undefined>;
}
export interface MessageTarget { readonly messageId: string; readonly expectedRevision: number }
export type ToolState = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'unknown';
export type MessagePart =
    | { readonly id: string; readonly kind: 'markdown' | 'reasoning'; readonly text: string }
    | { readonly id: string; readonly kind: 'json'; readonly value: JsonValue; readonly label?: string }
    | { readonly id: string; readonly kind: 'tool'; readonly name: string; readonly summary: string;
        readonly state: ToolState; readonly detail?: string }
    | { readonly id: string; readonly kind: 'attachment'; readonly file: AttachmentRef }
    | { readonly id: string; readonly kind: 'extension'; readonly type: string; readonly data: JsonValue };
export interface ChatMessage {
    readonly id: string;
    readonly revision: number;
    readonly role: 'user' | 'assistant' | 'system' | 'tool';
    readonly parts: readonly MessagePart[];
    readonly state: 'pending' | 'streaming' | 'complete' | 'failed' | 'cancelled';
    readonly submissionId?: string;
    /** Only confirmed user messages supply history-based acceptance evidence. */
    readonly acceptance?: 'optimistic' | 'confirmed';
    readonly allowed?: readonly ('edit' | 'retry')[];
    readonly timestamp?: number;
    /** Presentation scope for tool output across intervening prose; hosts preserve turn boundaries. */
    readonly toolGroupId?: string;
}
export interface Choice { readonly id: string; readonly label: string; readonly description?: string }
export type InputField = { readonly id: string; readonly label: string; readonly required?: boolean } & (
    | { readonly kind: 'text'; readonly multiline?: boolean; readonly secret?: boolean }
    | { readonly kind: 'single-choice'; readonly choices: readonly Choice[]; readonly other?: string }
    | { readonly kind: 'multi-choice'; readonly choices: readonly Choice[]; readonly min?: number; readonly max?: number; readonly other?: string }
);
export type InteractionView = {
    readonly id: string; readonly revision: number; readonly title: string; readonly detail?: string;
    readonly state: 'pending' | 'resolved' | 'cancelled' | 'expired';
    readonly messageId?: string; readonly partId?: string;
    readonly responding?: boolean;
} & (
    | { readonly kind: 'approval'; readonly decisions: readonly Choice[]; readonly note?: boolean }
    | { readonly kind: 'input'; readonly fields: readonly InputField[] }
    | { readonly kind: 'unsupported' }
);
export type InteractionResponse =
    | { readonly kind: 'approval'; readonly decisionId: string; readonly note?: string }
    | { readonly kind: 'input'; readonly values: Readonly<Record<string, string | readonly string[]>> };
export interface SelectorView { readonly id: string; readonly label: string; readonly value: string;
    readonly choices: readonly Choice[]; readonly disabled?: boolean;
    readonly placement?: 'start' | 'end' | 'more';
    /** Render this selector and its dependent selector as one control, preserving both stored keys. */
    readonly combineWith?: string;
    /** Dependent choices are scoped to one parent value, such as a selected model. */
    readonly variants?: { readonly selectorId: string;
        readonly values: Readonly<Record<string, { readonly value: string; readonly choices: readonly Choice[] }>> } }
export interface CommandDefinition {
    /** Submit through send with its normal preparation and ledger, rather than nested command dispatch. */
    readonly dispatch?: 'send';
    readonly execution?: 'query' | 'serial';
    readonly id: string; readonly revision: number; readonly name: string; readonly description: string;
    readonly kind: 'prompt' | 'action'; readonly argumentHint?: string; readonly disabled?: boolean;
}
export interface CommandSource { readonly id: string; readonly label: string }
export interface ComposerCommand extends CommandDefinition { readonly commandId: string; readonly source: CommandSource }
export interface CommandCatalog { readonly source: CommandSource; readonly commands: readonly CommandDefinition[] }
export interface CommandSubmission {
    readonly execution?: 'query' | 'serial';
    readonly target: { readonly id: string; readonly expectedRevision: number };
    readonly text: string; readonly arguments: string; readonly kind: 'prompt' | 'action';
    readonly selection?: Readonly<Record<string, string>>;
}
/** Compact host observations; presentation only, never composer admission or billing policy. */
export interface ComposerIndicator {
    /** Normalized occupancy; null shows an unknown meter, omitted keeps text presentation. */
    readonly progress?: number | null;
    readonly id: string;
    readonly label: string;
    readonly value: string;
    readonly detail?: string;
    readonly tone?: 'normal' | 'warning';
}
export interface ConversationSnapshot {
    readonly composerIndicators?: readonly ComposerIndicator[];
    readonly callTargets?: CallTargetCatalog;
    /** Stable across observation bindings; it is not an authorization token. */
    readonly conversationId: string;
    readonly viewId: string;
    readonly revision: number;
    readonly title: string;
    readonly messages: readonly ChatMessage[];
    readonly interactions: readonly InteractionView[];
    readonly selectors?: readonly SelectorView[];
    /** The host contributes only commands available to this binding and target. */
    readonly commands?: readonly ComposerCommand[];
    /** Host-owned durable receipts, including acceptance before a history message exists. */
    readonly operationReceipts?: readonly OperationReceipt[];
    /** Display overrides for admitted inputs; never history or acceptance evidence. */
    readonly operationMessages?: readonly {readonly operationId: string; readonly message: ChatMessage | null}[];
    readonly inputContract?: ComposerInputContract;
    readonly loading: boolean;
    readonly execution: 'unknown' | 'idle' | 'running' | 'waiting-input';
    /** Presentation follows the host's actual admission semantics; it never enables a queue. */
    readonly submissionMode?: 'send' | 'queue' | 'steer';
    readonly executionRef?: string;
    /** Host-observed work phase; elapsed time is display-only, never execution liveness. */
    readonly executionActivity?: {readonly label: string; readonly updatedAt?: number};
    readonly connection: 'online' | 'offline' | 'reconnecting';
    readonly hasEarlier: boolean;
    readonly allowed: readonly ActionName[];
    readonly error?: { readonly code: string; readonly message: string };
}
export interface ConversationSource {
    getSnapshot(): ConversationSnapshot;
    subscribe(listener: () => void): () => void;
    refresh?(): Promise<void>;
}
export interface OperationContext { readonly viewId: string; readonly operationId: string }
export interface OperationDiagnostic {
    readonly operationId: string;
    readonly kind: OperationKind;
    readonly stage: 'prepare' | 'register' | 'dispatch' | 'receipt' | 'reconcile';
    readonly result: 'success' | 'failed' | OperationReceipt['status'];
    readonly durationMs: number;
    readonly code?: string;
}
export type OperationReceipt =
    | { readonly status: 'accepted'; readonly operationId: string; readonly submissionRef?: string;
        readonly observedUserMessageId?: string }
    | { readonly status: 'rejected'; readonly operationId: string; readonly code: string; readonly message: string }
    | { readonly status: 'unknown'; readonly operationId: string; readonly message: string };
export interface CallTargetRef {readonly kind: string; readonly id: string; readonly version: string; readonly digest: string}
export interface CallTargetChoice extends Choice {readonly group?: string; readonly icon?: string; readonly target: CallTargetRef; readonly inputContract?: ComposerInputContract}
export interface CallTargetCatalog {readonly autoSelectFirst?: boolean; readonly label?: string; readonly entries: readonly CallTargetChoice[]; readonly loading: boolean; readonly error?: string; readonly message?: string}
/** Opaque host-owned context selection; the UI only freezes and consumes its revision. */
export interface ComposerContextDraft {readonly revision: number; readonly value: JsonValue}
export interface ChatSubmission { readonly context?: JsonValue; readonly text: string; readonly attachments: readonly AttachmentRef[];
    readonly target?: CallTargetRef;
    readonly selection?: Readonly<Record<string, string>>;
    readonly input?: {readonly targetId: string; readonly target?: CallTargetRef; readonly signature: InputSignature; readonly values: Readonly<Record<string, JsonValue>>} }
export interface InputSignature {readonly id: string; readonly revision: number; readonly digest: string}
export interface ComposerInputContract {readonly targetId: string; readonly target?: CallTargetRef; readonly signature: InputSignature; readonly label: string}
export interface ComposerArgumentDraft {
    readonly target?: CallTargetRef;
    readonly revision: number;
    readonly targetId: string;
    readonly signature: InputSignature;
    /** Preserve invalid JSON verbatim; it must never fall back to an earlier parsed value. */
    readonly json: string;
}
export interface SendPreparation {readonly operationId: string; readonly viewId: string}
export interface ConversationActions {
    /** Prepare a stable host identity and, when needed, install its retained binding before registration. */
    prepareSend?(input: ChatSubmission, draft: ComposerDraft): Promise<SendPreparation | null>;
    send?(input: ChatSubmission, context: OperationContext): Promise<OperationReceipt>;
    command?(input: CommandSubmission, context: OperationContext): Promise<OperationReceipt>;
    cancel?(executionRef: string, context: OperationContext): Promise<OperationReceipt>;
    /** Regenerate a reply from this message; never retry an uncertain send. */
    retry?(target: MessageTarget, context: OperationContext): Promise<OperationReceipt>;
    /** Host determines branching and installs a new observation binding when necessary. */
    edit?(target: MessageTarget, text: string, context: OperationContext): Promise<OperationReceipt>;
    respond?(request: { readonly id: string; readonly revision: number; readonly response: InteractionResponse },
        context: OperationContext): Promise<OperationReceipt>;
    loadEarlier?(options: { readonly signal: AbortSignal }): Promise<void>;
    /** Query by stable identity, even after the original viewId has expired. */
    reconcile?(operationId: string): Promise<OperationReceipt>;
}
export interface ComposerDraft {
    /** Stable identity of a host-owned input draft, independent of observation bindings. */
    readonly scopeId?: string;
    readonly selection?: Readonly<Record<string, string>>;
    readonly context?: ComposerContextDraft;
    readonly target?: CallTargetRef;
    readonly revision: number;
    readonly textRevision: number;
    readonly text: string;
    readonly attachments: readonly DraftAttachment[];
    readonly input?: ComposerArgumentDraft;
}
export interface OperationRecord {
    readonly context: OperationContext;
    readonly conversationId: string;
    readonly kind: OperationKind;
    readonly input: JsonValue;
    readonly draft?: ComposerDraft;
    readonly status: 'submitting' | OperationReceipt['status'];
    readonly message?: string;
    readonly submissionRef?: string;
    /** A confirmed user message has actually appeared, not merely been allocated an ID. */
    readonly observedUserMessageId?: string;
}
/** Hosts retain this ledger beyond any ChatView and persist it when recovery is required. */
export interface OperationLedger {
    getSnapshot(): readonly OperationRecord[];
    subscribe(listener: () => void): () => void;
    register(record: OperationRecord): Promise<void>;
    settle(receipt: OperationReceipt): Promise<void>;
}
export interface RenderContext { readonly message: ChatMessage; readonly snapshot: ConversationSnapshot }
export interface MountedRenderer {
    update?(part: Extract<MessagePart, { kind: 'extension' }>, context: RenderContext): void | Promise<void>;
    destroy(): void | Promise<void>;
}
/** Registered renderers are trusted host code, not a sandbox. */
export type ExtensionRenderer = (container: HTMLElement, part: Extract<MessagePart, { kind: 'extension' }>,
    context: RenderContext) => MountedRenderer;
export interface ResourceCandidate { readonly id: string; readonly label: string; readonly insertText: string }
export interface ToolbarContext {
    readonly headerMenu?: HTMLElement;
    readonly header?: {readonly title: HTMLElement; readonly status: HTMLElement; readonly extra: HTMLElement;
        readonly primary: HTMLElement; readonly menu: HTMLElement; readonly menuBody: HTMLElement};
    readonly snapshot: ConversationSnapshot;
    readonly view: ChatView;
}
export interface MountedToolbar { update?(context: ToolbarContext): void; destroy(): void | Promise<void> }
export type TranslationParameters = Readonly<Record<string, string | number>>;
export type Translation = (key: string, parameters?: TranslationParameters) => string | undefined;
export interface MessageAction {
    readonly id: string; readonly label: string; readonly disabled?: boolean; readonly placement?: 'more';
    run(): void | Promise<void>;
}
export interface ComposerAttachmentMenuContext {
    readonly input: import('./input-plugins').InputPluginContext;
    pickFiles(options?: {accept?: string; capture?: 'user' | 'environment'}): void;
}
export interface ComposerAttachmentMenuAction extends MessageAction {readonly icon?: string}
export interface ChatOptions {
    /** Enable OCR review by supplying recognition; connection policy stays with the host. */
    readonly ocr?: import('./ocr').OcrPort;
    readonly resolveSubmissionMode?: (draft: ComposerDraft, snapshot: ConversationSnapshot) => NonNullable<ConversationSnapshot['submissionMode']>;
    /** Host policy contributes actions for a frozen message projection. */
    readonly attachmentMenu?: (context: ComposerAttachmentMenuContext) => readonly ComposerAttachmentMenuAction[];
    readonly attachmentActions?: (attachment: DraftAttachment) => readonly MessageAction[];
    readonly messageActions?: (context: RenderContext) => readonly MessageAction[];
    readonly disclosure?: Pick<import('./disclosure').DisclosureOptions, 'initialStates' | 'onChange'>;
    readonly plugins?: readonly import('./input-plugins').InputPlugin<import('./input-plugins').InputPluginContext, ComposerDraft>[];
    /** Pause or resume view-owned binding resources; shared sources remain host-owned. */
    readonly setActive?: (active: boolean) => void;
    /** Release this binding's view-owned resources once, including rejected replacements. */
    readonly release?: () => void | Promise<void>;
    readonly promptHistoryPages?: number;
    readonly source: ConversationSource;
    readonly actions: ConversationActions;
    readonly operations: OperationLedger;
    /** Flow stays unavailable until enabled; its code is loaded when opened. */
    readonly features?: { readonly flow?: boolean };
    readonly flow?: FlowOptions;
    readonly initialDraft?: ComposerDraft;
    /** Host-owned forms prepare structured input without exposing the standalone JSON editor. */
    readonly inputPresentation?: 'inline' | 'host';
    readonly onDraftChange?: (draft: ComposerDraft) => void;
    readonly saveDraft?: (draft: ComposerDraft) => Promise<void>;
    /** Trusted host plugins are created once per Markdown part and disposed with its renderer. */
    readonly markdown?: (context: RenderContext, part: Extract<MessagePart, {kind: 'markdown' | 'reasoning'}>) => {
        readonly documentPath?: string; readonly plugins?: readonly MDxPlugin[];
    };
    readonly assets?: AssetProvider;
    readonly onOpenResource?: (id: string) => Promise<void>;
    readonly upload?: (file: File, options: { signal: AbortSignal }) => Promise<AttachmentRef>;
    readonly imageEditing?: ImageEditingPort;
    readonly searchResources?: (query: string, options: { signal: AbortSignal }) => Promise<readonly ResourceCandidate[]>;
    readonly renderers?: Readonly<Record<string, ExtensionRenderer>>;
    readonly mountHeader?: (container: HTMLElement, context: ToolbarContext) => MountedToolbar;
    readonly mountComposerStart?: (container: HTMLElement, context: ToolbarContext) => MountedToolbar;
    readonly mountComposerMenu?: (container: HTMLElement, context: ToolbarContext) => MountedToolbar;
    readonly mountToolbar?: (container: HTMLElement, context: ToolbarContext) => MountedToolbar;
    /** Trusted host presentation; labels and native button behavior remain available. */
    readonly presentButton?: (button: HTMLButtonElement, action: string) => void;
    readonly translate?: Translation;
    readonly locale?: 'zh-CN' | 'en';
    readonly onError?: (error: unknown) => void;
    readonly onDiagnostic?: (event: OperationDiagnostic) => void;
    readonly onBindingDiagnostic?: (event: BindingDiagnostic) => void;
    /** Optional pure host validation; submission still requires authoritative host admission. */
    readonly validateInput?: (input: ChatSubmission) => readonly string[];
}
/** Replace host capabilities without replacing the view's layout or input DOM. */
export type ChatBinding = Pick<ChatOptions, 'source' | 'actions' | 'operations' | 'saveDraft' | 'onDraftChange'
    | 'ocr' | 'markdown' | 'assets' | 'onOpenResource' | 'upload' | 'imageEditing' | 'searchResources' | 'renderers'
    | 'resolveSubmissionMode' | 'mountHeader' | 'mountToolbar' | 'mountComposerMenu' | 'mountComposerStart' | 'attachmentMenu' | 'inputPresentation' | 'validateInput' | 'setActive' | 'release' | 'plugins' | 'disclosure' | 'messageActions' | 'attachmentActions' | 'promptHistoryPages'>;
export interface BindingDiagnostic {
    readonly operationId: string;
    readonly stage: 'flush' | 'subscribe' | 'commit' | 'cleanup';
    readonly result: 'success' | 'failed';
    readonly durationMs: number;
    readonly code?: string;
}
export interface ChatRecoverySnapshot {
    readonly version: 1; readonly conversationId: string; readonly draft: ComposerDraft;
    readonly selectionStart: number; readonly selectionEnd: number;
    readonly selectionDirection: 'forward' | 'backward' | 'none'; readonly focused: boolean;
}
export interface ChatView {
    captureRecovery(): ChatRecoverySnapshot;
    restoreRecovery(snapshot: ChatRecoverySnapshot): void;
    setAllCollapsed(collapsed: boolean): void;
    collapseCurrent(): void;
    disclosureState(): {affectedCount: number; allCollapsed: boolean};
    revealMessage(id: string): boolean;
    scrollHistory(position: 'start' | 'end'): void;
    openPrompts(): void;
    print(): Promise<void>;
    retryMessage(target: MessageTarget): Promise<void>;
    readonly inputBusy: boolean;
    /** Omit draft to retain the current input; another conversation requires an explicit draft. */
    replaceBinding(binding: ChatBinding, options?: {readonly draft?: ComposerDraft}): Promise<void>;
    setActive(active: boolean): void;
    setFlowEnabled(enabled: boolean): Promise<void>;
    focus(): void;
    getDraft(): ComposerDraft;
    setText(text: string): void;
    /** Apply host choices only if the observed draft is still current. */
    configureInput(input: {selection?: Readonly<Record<string, string>>; target?: CallTargetRef}, expectedRevision: number): void;
    setArguments(json: string): void;
    setContext(value: JsonValue): void;
    addFiles(files: readonly File[]): Promise<void>;
    removeAttachment(target: {id: string; fileId: string; revision: number}): boolean;
    /** Trusted host routing may send a command through the normal message operation. */
    submit(options?: {asMessage?: boolean}): Promise<void>;
    inputContext(): import('./input-plugins').InputPluginContext;
    reconcile(operationId: string): Promise<void>;
    flushDraft(): Promise<void>;
    destroy(): Promise<void>;
}
