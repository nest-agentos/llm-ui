import type { SettingsRuntime } from '../../runtime';
import { bind as bind0 } from './SkillSupportFields';
import type { LLMSkill, SkillType } from '../../contracts/domain';
export type Value = (name: string) => string;
export type Checked = (name: string) => boolean;
function parseObject(runtime: SettingsRuntime, raw: string, message: string): Record<string, unknown> | undefined {
    if (!raw.trim())
        return;
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
            throw new Error(message);
        return parsed;
    }
    catch {
        throw new (dependencies(runtime).SettingsValidationError)(message);
    }
}
function readExecutable(runtime: SettingsRuntime, type: SkillType, val: Value): Partial<LLMSkill> {
    const http = type === 'http';
    const headers = http ? parseObject(runtime, val('headers'), dependencies(runtime).t('skill.toast.invalidHeaders')) : undefined;
    if (headers && Object.values(headers).some(value => typeof value !== 'string')) {
        throw new (dependencies(runtime).SettingsValidationError)(dependencies(runtime).t('skill.toast.invalidHeaders'));
    }
    const auth = val('auth-header').trim();
    return {
        instructions: type === 'prompt' ? val('instructions') : '',
        command: type === 'shell' ? val('command') || undefined : undefined,
        mcpServerId: type === 'mcp' ? val('mcpServerId') || undefined : undefined,
        mcpToolName: type === 'mcp' ? val('mcpToolName') || undefined : undefined,
        endpoint: http ? val('endpoint') || undefined : undefined,
        method: http ? (val('method') || 'POST') as LLMSkill['method'] : undefined,
        headers: http ? { ...headers as Record<string, string>, ...(auth ? { Authorization: auth } : {}) } : undefined,
        parameters: !['prompt', 'mcp'].includes(type) ? parseObject(runtime, val('parameters'), dependencies(runtime).t('skill.toast.invalidParams')) : undefined,
    };
}
export function readSkillDraft(runtime: SettingsRuntime, existing: LLMSkill, val: Value, chk: Checked): LLMSkill {
    const name = val('header-name').trim();
    if (!name)
        throw new (dependencies(runtime).SettingsValidationError)(dependencies(runtime).t('settings.autosave.invalid'));
    const type = val('type') as SkillType;
    const globs = val('globs').split('\n').map(value => value.trim()).filter(Boolean);
    const priority = Number(val('priority') || '50');
    if (!Number.isFinite(priority))
        throw new (dependencies(runtime).SettingsValidationError)(dependencies(runtime).t('settings.autosave.invalid'));
    return {
        ...existing,
        id: val('id').trim() || existing.id, name, type,
        icon: val('header-icon') || undefined,
        description: val('description'), enabled: chk('enabled'),
        ...readExecutable(runtime, type, val),
        triggerStrategy: (val('triggerStrategy') || 'reference') as LLMSkill['triggerStrategy'],
        autoLoad: chk('autoLoad'), priority, globs: globs.length ? globs : undefined,
        ...dependencies(runtime).readSkillSupportFields(val, chk),
        disableModelInvocation: chk('disableModelInvocation') || undefined,
        modifiedAt: Date.now(),
    };
}
function createDependencies(runtime: SettingsRuntime) { return { t: runtime.presentation.t, SettingsValidationError: runtime.widgets.SettingsValidationError, readSkillSupportFields: bind0().readSkillSupportFields }; }
export function bind(runtime: SettingsRuntime) { return { readSkillDraft: readSkillDraft.bind(null, runtime) }; }

const dependencyCache = new WeakMap<SettingsRuntime, ReturnType<typeof createDependencies>>();
function dependencies(runtime: SettingsRuntime) {
    let value = dependencyCache.get(runtime);
    if (!value) { value = createDependencies(runtime); dependencyCache.set(runtime, value); }
    return value;
}
