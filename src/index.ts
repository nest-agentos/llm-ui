import './style.css';
import type { ChatOptions, ChatView } from './contracts';
import { ChatController } from './chat-view';

export type * from './contracts';
export {composeCommandCatalogs, parseCommand, isCommandInput} from './commands';
export { createOperationLedger, mergeOperationRecords } from './operations';
export {getOperationCallInput} from './submission-input';
export {createInteractionCard} from './interactions';
export type {InteractionCard, InteractionEditorDraft, InteractionCardOptions} from './interactions';
export type { OperationLedgerOptions } from './operations';
export { createContentSearch } from './search';
export type { ContentSearchOptions, ContentSearchView, SearchContent } from './search';

export async function createChatView(container: HTMLElement, options: ChatOptions): Promise<ChatView> {
    let controller: ChatController | undefined;
    try { controller = new ChatController(container, options); controller.initialize(); return controller; }
    catch (error) {
        try {if (controller) await controller.destroy(); else await options.release?.();}
        catch (cleanup) { throw new AggregateError([error, cleanup], 'Chat initialization failed'); }
        throw error;
    }
}

export {InstructionQueueView} from './instruction-queue';
export {ExecutionNotice} from './execution-notice';
export type {InstructionQueueSnapshot, InstructionQueueViewOptions, InstructionQueueEdit, InstructionQueueChange, InstructionState} from './instruction-queue';

export {ScrollController} from './scroll';
export type {ScrollControllerCallbacks} from './scroll';
export {ContentResizeTracker} from './content-resize';
export {TimerManager} from './timers';
export {PromptNavigator} from './prompt-navigation';
export type {PromptNavigationItem, PromptNavigationOptions} from './prompt-navigation';
export {EventCleanup} from './events';
export {shouldSubmitMessage, resizeMessageInput} from './input-behavior';
export {getPreviewText} from './text-preview';
export {DOMCache} from './dom-cache';
export {CHAT_SLOT_CLASSES} from './host-slots';
export {InputPluginRegistry} from './input-plugins';
export type {InputPlugin, InputPluginContext} from './input-plugins';
export {PopupPanel} from './popup-panel';
export type {PopupItem, PopupPanelOptions} from './popup-panel';
export {TtyPanel} from './tty-panel';
export type {TtyPanelOptions} from './tty-panel';
export {DisclosureController} from './disclosure';
export type {DisclosureEntry, DisclosureOptions, DisclosureLocation} from './disclosure';

export type {OcrPort, OcrDiagnostic} from './ocr';
export {OcrReviewPanel} from './ocr-panel';
export type {OcrReviewCallbacks} from './ocr-panel';
export {downscaleImageForOcr, type DownscaleOptions} from './image-downscale';
