import type {IConnectionService} from './domain';
import type {SettingsEditorOptions, SettingsHostContext} from '@nestos/ui-common';
export type {SettingsEditor as IEditor, SettingsEditor, Heading, UnifiedSearchResult, CollapseExpandResult, EditorEvent, EditorEventMap, EditorEventCallback} from '@nestos/ui-common';
export {SettingsAutoSave, SettingsValidationError, requestSettingsSave} from '@nestos/ui-common';
export {Modal, Toast, copyText} from '@nestos/ui-common';
export type {BaseSettingsEditor} from '../base-editor';
export interface SettingsNavigation {
    open(path: string): Promise<void>;
    href(path: string): string;
}
export interface EditorHostContext extends SettingsHostContext {
    requestDelete?(targets: Array<{kind: 'entity'; entityType: 'provider'|'connection'|'mcp'|'system-prompt'; id: string}>): Promise<void>;
}
export interface EditorOptions extends SettingsEditorOptions {
    hostContext?: EditorHostContext;
    navigation?: SettingsNavigation;
    relatedConfiguration?(id:string): {label:string;open(service:IConnectionService):Promise<void>}|undefined;
    consumeAnchor?(target: 'connections'|'providers'): {anchor: string}|undefined;
}
export interface ConfigurationFormControls<T,TDiscovery> {
    render(container: HTMLElement, record: T): void; read(record: T): T;
    tested?(record: T, discovery: TDiscovery): Promise<T>;
    committed?(): void; failed?(): void; dispose?(): void;
}
export function editorResourceId(options: EditorOptions): string|undefined {
    const target=options.target; return target?.kind==='file'?target.path:target?.kind==='entity'?target.id:target?.sessionId;
}
