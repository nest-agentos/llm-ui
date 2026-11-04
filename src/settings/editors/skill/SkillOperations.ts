import type { SettingsRuntime } from '../../runtime';
import { shortUUID as generateShortUUID } from '../../identity';
import type { LLMSkill, IAgentManagementService } from '../../contracts/domain';
// @file llm-ui/editors/skill/SkillOperations.ts
// CRUD operations for SkillSettingsEditor — extracted for stability.
// Infrequently modified: operation patterns are stable; only types change.
export interface SkillOperationsDeps {
    service: IAgentManagementService;
    beforeDelete?: () => Promise<void>;
    container: HTMLElement;
    render: () => Promise<void>;
    val: (name: string) => string;
    chk: (name: string) => boolean;
    get selectedId(): string | null;
    set selectedId(id: string | null);
}
export async function addNew(deps: SkillOperationsDeps): Promise<void> {
    const skill: LLMSkill = {
        id: `skill-${generateShortUUID()}`,
        name: 'New Skill',
        type: 'prompt',
        enabled: false,
        description: '',
        instructions: '',
        tools: [],
        triggerPatterns: [],
        autoLoad: false,
        priority: 50,
        createdAt: Date.now(),
        modifiedAt: Date.now(),
    };
    await deps.service.saveSkill(skill);
    deps.selectedId = skill.id;
    await deps.render();
}
export function deleteCurrent(runtime: SettingsRuntime, deps: SkillOperationsDeps): void {
    if (!deps.selectedId)
        return;
    dependencies(runtime).Modal.confirm(dependencies(runtime).t('dialog.delete.title'), dependencies(runtime).t('skill.confirm.delete'), async () => {
        await deps.beforeDelete?.();
        await deps.service.deleteSkill(deps.selectedId!);
        deps.selectedId = null;
        dependencies(runtime).Toast.success(dependencies(runtime).t('skill.toast.deleted'));
        await deps.render();
    });
}
export async function testCurrent(runtime: SettingsRuntime, deps: SkillOperationsDeps): Promise<void> {
    const skills = await deps.service.getSkills();
    const skill = skills.find(s => s.id === deps.selectedId);
    if (!skill)
        return;
    if (skill.type === 'prompt') {
        dependencies(runtime).Toast.info(dependencies(runtime).t('skill.toast.testPrompt'));
        return;
    }
    if (skill.type === 'mcp') {
        dependencies(runtime).Toast.info(dependencies(runtime).t('skill.toast.testMcp'));
        return;
    }
    if (skill.type !== 'http') {
        dependencies(runtime).Toast.error(dependencies(runtime).t('skill.toast.testNotHttp'));
        return;
    }
    if (!skill.endpoint) {
        dependencies(runtime).Toast.error(dependencies(runtime).t('skill.toast.testNoEndpoint'));
        return;
    }
    const btn = deps.container.querySelector<HTMLButtonElement>('[data-action="test"]');
    if (!btn)
        return;
    const originalHTML = btn.innerHTML;
    btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${dependencies(runtime).t('status.testing')}`;
    btn.disabled = true;
    try {
        const res = await fetch(skill.endpoint, {
            method: skill.method ?? 'POST',
            headers: { 'Content-Type': 'application/json', ...skill.headers },
            body: JSON.stringify({}),
        });
        res.ok ? dependencies(runtime).Toast.success(dependencies(runtime).t('skill.toast.testSuccess', { status: res.status }))
            : dependencies(runtime).Toast.error(dependencies(runtime).t('skill.toast.testFailed', { status: res.status }));
    }
    catch (e: unknown) {
        dependencies(runtime).Toast.error(dependencies(runtime).t('skill.toast.testError', { message: (e as Error).message }));
    }
    finally {
        btn.innerHTML = originalHTML;
        btn.disabled = false;
    }
}
function createDependencies(runtime: SettingsRuntime) { return { t: runtime.presentation.t, Modal: runtime.widgets.Modal, Toast: runtime.widgets.Toast }; }
export function bind(runtime: SettingsRuntime) { return { addNew: addNew.bind(null), deleteCurrent: deleteCurrent.bind(null, runtime), testCurrent: testCurrent.bind(null, runtime) }; }

const dependencyCache = new WeakMap<SettingsRuntime, ReturnType<typeof createDependencies>>();
function dependencies(runtime: SettingsRuntime) {
    let value = dependencyCache.get(runtime);
    if (!value) { value = createDependencies(runtime); dependencyCache.set(runtime, value); }
    return value;
}
