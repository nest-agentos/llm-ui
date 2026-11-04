import {afterEach, expect, it, vi} from 'vitest';
import {createSettingsUI, type SettingsHost, type SettingsRules} from '../src/settings';

const escape = (value:unknown) => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
function host(locale:string):SettingsHost {
    return {presentation:{t:key=>`${locale}:${key}`,getLocale:()=>locale,escapeHTML:escape,escapeAttr:escape,
        buildRenamedFilename:name=>({filename:name}),createModuleLogger:()=>console,
        ACTION_ICONS:{},ENTITY_ICONS:{},FILE_BROWSER_ICONS:{},TOOLBOX_ICONS:{},MCP_TRANSPORT_ICONS:{},
        MODEL_CAPABILITY_META:{},MODEL_CATEGORY_META:{},SKILL_TYPE_META:{},STATUS_META:{}},
        rules:new Proxy({} as SettingsRules,{get:(_target,key)=>()=>{throw new Error(`Unexpected rule: ${String(key)}`);}}),
        codecs:{yaml:{load:()=>({}),dump:()=>''}}};
}
const state = {value:{connectionId:'one'},connections:[{id:'one',label:'<unsafe>'},{id:'two',label:'Second'}]};
afterEach(()=>{vi.restoreAllMocks();document.body.replaceChildren();});
it('keeps labels and service callbacks isolated across simultaneous hosts', async()=>{
    const first=createSettingsUI(host('zh')), second=createSettingsUI(host('en'));
    expect(first.renderOcrSettings(state,'a')).toContain('zh:ocr.connection');
    expect(second.renderOcrSettings(state,'b')).toContain('en:ocr.connection');
    expect(first.renderOcrSettings(state,'a')).not.toContain('en:');
    const root=document.createElement('div'), save=vi.fn(async()=>{});
    const form=new first.OcrSettingsForm(root,{readSettings:async()=>state,saveSettings:save,subscribe:()=>()=>{},openSettings:async()=>{}});
    await form.refresh();expect(root.querySelector('unsafe')).toBeNull();
    root.querySelector('select')!.value='two';root.querySelector('select')!.dispatchEvent(new Event('change',{bubbles:true}));
    await form.flushPendingSave();expect(save).toHaveBeenCalledWith({connectionId:'two'});form.destroy();
});
it('does not apply a late settings response after destruction and releases the subscription', async()=>{
    let resolve!:(value:typeof state)=>void;
    const read=new Promise<typeof state>(done=>{resolve=done;}), unsubscribe=vi.fn(), root=document.createElement('div');
    const form=new (createSettingsUI(host('en')).OcrSettingsForm)(root,{readSettings:()=>read,saveSettings:async()=>{},subscribe:()=>unsubscribe,openSettings:async()=>{}});
    const pending=form.refresh();form.destroy();resolve(state);await pending;
    expect(root.childNodes).toHaveLength(0);expect(unsubscribe).toHaveBeenCalledOnce();
});
it('retains an unsaved selection after a storage failure and allows an explicit retry', async()=>{
    vi.spyOn(console,'error').mockImplementation(()=>{});
    const save=vi.fn().mockRejectedValueOnce(new Error('Storage offline')).mockResolvedValue(undefined), root=document.createElement('div');
    const form=new (createSettingsUI(host('en')).OcrSettingsForm)(root,{readSettings:async()=>state,saveSettings:save,subscribe:()=>()=>{},openSettings:async()=>{}});
    await form.refresh();root.querySelector('select')!.value='two';root.dispatchEvent(new Event('change'));
    await expect(form.flushPendingSave()).rejects.toThrow('Storage offline');
    expect(root.querySelector('select')!.value).toBe('two');expect(form.isDirty()).toBe(true);
    root.dispatchEvent(new Event('change'));await form.flushPendingSave();expect(form.isDirty()).toBe(false);form.destroy();
});
