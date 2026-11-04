import {randomUUID} from './identity';
import {SettingsBaseEditor} from '@itookit/ui-common';
import type {SettingsRuntime} from './runtime';
import type {EditorOptions} from './contracts/editor';
export abstract class BaseSettingsEditor<T> extends SettingsBaseEditor<T,EditorOptions> {
    constructor(protected readonly settingsRuntime:SettingsRuntime, container:HTMLElement, service:T, options:EditorOptions) {
        super(container,service,options,{t:settingsRuntime.presentation.t,escapeAttr:settingsRuntime.presentation.escapeAttr,entityIcon:settingsRuntime.presentation.ENTITY_ICONS.llm,iconChoices:settingsRuntime.presentation.iconChoices,operationId:randomUUID},options.resource);
    }
}
