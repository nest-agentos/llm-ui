import './settings.css';
import {createSettingsRuntime,type SettingsHost} from './settings/runtime';
import {bind as bind0} from './settings/components/OcrSettingsForm';
import {bind as bind1} from './settings/editors/AgentConfigEditor';
import {bind as bind2} from './settings/editors/ConnectionSettingsEditor';
import {bind as bind3} from './settings/editors/CostEditor';
import {bind as bind4} from './settings/editors/MCPSettingsEditor';
import {bind as bind5} from './settings/editors/ModelDefaultsEditor';
import {bind as bind6} from './settings/editors/ProviderSettingsEditor';
import {bind as bind7} from './settings/editors/SkillSettingsEditor';
import {bind as bind8} from './settings/editors/SystemPromptSettingsEditor';
import {bind as bind9} from './settings/editors/agent-capabilities';
import {bind as bind10} from './settings/editors/agent-composition';
import {bind as bind12} from './settings/editors/agent-execution';
import {bind as bind13} from './settings/editors/agent-flow-diagnostics';
import {bind as bind14} from './settings/editors/agent-flow-fields';
import {bind as bind15} from './settings/editors/agent-harness-connections';
import {bind as bind16} from './settings/editors/agent-header';
import {bind as bind17} from './settings/editors/agent-image-settings';
import {bind as bind18} from './settings/editors/agent-model-defaults';
import {bind as bind19} from './settings/editors/agent-prompt-reference';
import {bind as bind20} from './settings/editors/agent-publication';
import {bind as bind21} from './settings/editors/configuration-form';
import {bind as bind22} from './settings/editors/cost-trend';
import {bind as bind23} from './settings/editors/llm-import';
import {bind as bind24} from './settings/editors/mcp-content';
import {bind as bind25} from './settings/editors/mcp-resource-preview';
import {bind as bind26} from './settings/editors/media-fields';
import {bind as bind27} from './settings/editors/model-reasoning-form';
import {bind as bind28} from './settings/editors/provider-api-reference';
import {bind as bind29} from './settings/editors/provider-authorization';
import {bind as bind30} from './settings/editors/provider-form';
import {bind as bind31} from './settings/editors/provider-layout';
import {bind as bind32} from './settings/editors/provider-media-form';
import {bind as bind33} from './settings/editors/provider-media-probe';
import {bind as bind34} from './settings/editors/provider-test-result';
import {bind as bind35} from './settings/editors/skill/SkillImporter';
import {bind as bind36} from './settings/editors/skill/SkillOperations';
import {bind as bind37} from './settings/editors/skill/SkillRenderer';
import {bind as bind38} from './settings/editors/skill/SkillSupportFields';
import {bind as bind39} from './settings/editors/skill/skill-draft';
import {bind as bind40} from './settings/utils/model-picker';
import {bind as bind41} from './settings/utils/modelBadges';
import {bind as bind42} from './settings/utils/modelChoice';
import {bind as bind43} from './settings/utils/modelPrice';
function group0(runtime:ReturnType<typeof createSettingsRuntime>) {return {
    ...bind0(runtime),
    ...bind1(runtime),
    ...bind2(runtime),
    ...bind3(runtime),
    ...bind4(runtime),
    ...bind5(runtime),
    ...bind6(runtime),
    ...bind7(runtime),
    ...bind8(runtime),
    ...bind9(runtime),
    ...bind10(runtime),
    ...bind12(runtime),
};}
function group1(runtime:ReturnType<typeof createSettingsRuntime>) {return {
    ...bind13(),
    ...bind14(runtime),
    ...bind15(runtime),
    ...bind16(runtime),
    ...bind17(runtime),
    ...bind18(runtime),
    ...bind19(runtime),
    ...bind20(runtime),
    ...bind21(runtime),
    ...bind22(runtime),
    ...bind23(runtime),
    ...bind24(runtime),
};}
function group2(runtime:ReturnType<typeof createSettingsRuntime>) {return {
    ...bind25(runtime),
    ...bind26(runtime),
    ...bind27(runtime),
    ...bind28(runtime),
    ...bind29(runtime),
    ...bind30(runtime),
    ...bind31(runtime),
    ...bind32(runtime),
    ...bind33(runtime),
    ...bind34(runtime),
    ...bind35(runtime),
    ...bind36(runtime),
};}
function group3(runtime:ReturnType<typeof createSettingsRuntime>) {return {
    ...bind37(runtime),
    ...bind38(),
    ...bind39(runtime),
    ...bind40(runtime),
    ...bind41(runtime),
    ...bind42(runtime),
    ...bind43(runtime),
};}
export function createSettingsUI(host:SettingsHost) {
 const runtime=createSettingsRuntime(host);
 return {...group0(runtime),...group1(runtime),...group2(runtime),...group3(runtime)};
}
export type {SettingsHost,SettingsRuntime,SettingsPresentation} from './settings/runtime';
export type {SettingsRules} from './settings/contracts/rules';
export type {EditorOptions as SettingsEditorOptions, SettingsNavigation, ConfigurationFormControls} from './settings/contracts/editor';
export type * from './settings/contracts/domain';
export type {AgentCapabilityOptions} from './settings/editors/agent-capabilities';
export type {AgentExecutionOptions,AgentFlowChoice,AgentFlowRevision,AgentFlowDefinition,HarnessConnectionManagement} from './settings/editors/agent-execution-options';
export type SettingsUI = ReturnType<typeof createSettingsUI>;
