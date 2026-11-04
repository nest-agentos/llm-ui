import {Modal,Toast,copyText,SettingsAutoSave,SettingsValidationError,requestSettingsSave} from '@nestos/ui-common';
import type {SettingsTranslate} from '@nestos/ui-common';
import {editorResourceId,type EditorOptions} from './contracts/editor';
import type {SettingsRules} from './contracts/rules';
export interface SettingsDiagnosticLogger {debug(event:string,details?:unknown):void;info(event:string,details?:unknown):void;warn(event:string,details?:unknown):void;error(event:string,details?:unknown):void}
export interface Meta {icon:string;color:string;label?:string;dot?:string;name?:string;labelKey?:string}
export interface SettingsPresentation {
    credentialHelp?:readonly string[]; iconChoices?:readonly string[];
    t:SettingsTranslate; getLocale():string;
    escapeHTML(value:unknown):string; escapeAttr(value:unknown):string;
    buildRenamedFilename(name:string,current:string):{filename:string};
    createModuleLogger(name:string):SettingsDiagnosticLogger;
    ACTION_ICONS:Readonly<Record<string,string>>;ENTITY_ICONS:Readonly<Record<string,string>>;
    FILE_BROWSER_ICONS:Readonly<Record<string,string>>;TOOLBOX_ICONS:Readonly<Record<string,string>>;
    MCP_TRANSPORT_ICONS:Readonly<Record<string,string>>;
    MODEL_CAPABILITY_META:Readonly<Record<string,Meta>>;MODEL_CATEGORY_META:Readonly<Record<string,Meta>>;
    SKILL_TYPE_META:Readonly<Record<string,Meta>>;STATUS_META:Readonly<Record<string,{color:string;dot:string}>>;
}
export interface SettingsHost {
    presentation:SettingsPresentation;
    rules:SettingsRules;
    codecs:{yaml:{load(text:string):unknown;dump(value:unknown,options?:{lineWidth?:number;noRefs?:boolean}):string}};
    prepareOptions?(options:unknown):EditorOptions;
}
export interface SettingsRuntime extends SettingsHost {
    widgets:{Modal:typeof Modal;Toast:typeof Toast;copyText:typeof copyText;SettingsAutoSave:typeof SettingsAutoSave;
        SettingsValidationError:typeof SettingsValidationError;requestSettingsSave:typeof requestSettingsSave;editorResourceId:typeof editorResourceId};
}
export function createSettingsRuntime(host:SettingsHost):SettingsRuntime {
    class LocalModal extends Modal {
        constructor(title:string,html:string,options:ConstructorParameters<typeof Modal>[2]={}) {
            super(title,html,{confirmText:host.presentation.t('action.confirm'),cancelText:host.presentation.t('action.cancel'),closeLabel:host.presentation.t('action.close'),...options});
        }
    }
    class LocalAutoSave extends SettingsAutoSave {
        constructor(root:HTMLElement,save:ConstructorParameters<typeof SettingsAutoSave>[1],status?:HTMLElement){super(root,save,status,host.presentation.t);}
    }
    return {...host,widgets:{Modal:LocalModal,Toast,copyText:(...args)=>copyText(...args),SettingsAutoSave:LocalAutoSave,SettingsValidationError,requestSettingsSave,editorResourceId}};
}
