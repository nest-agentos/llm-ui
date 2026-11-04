export interface OcrControls {
    readSettings(): Promise<OcrSettingsState>;
    saveSettings(value: OcrSettingsState['value']): Promise<void>;
    openSettings(target: 'models' | 'prompt'): Promise<void>;
    recognize(image: Blob, signal?: AbortSignal): Promise<string>;
    configure(): Promise<boolean>;
    label(): Promise<string>;
    subscribe(listener: () => void): () => void;
}
export interface OcrSettingsState {
    value: {
        connectionId?: string;
    };
    connections: Array<{
        id: string;
        label: string;
        disabled?: boolean;
        supported?: boolean;
    }>;
}
export type AgentType = 'agent' | 'composite' | 'tool' | 'workflow';
export interface AgentDefinition {
    id: string;
    exposure?: 'global' | 'local';
    version?: string;
    name: string;
    type: AgentType;
    icon?: string;
    description?: string;
    config: AgentConfig;
    modelDefaults?: ModelDefaults;
    composition?: AgentComposition;
    execution?: AgentExecution;
    readonly availability?: AgentAvailability;
    tags?: string[];
    interface?: AgentInterfaceDef;
    defaultPrompts?: PromptPreset[];
    createdAt?: number;
    modifiedAt?: number;
    systemPrompt?: string;
    capabilityPolicy?: {
        inheritDefaultTools?: boolean;
        toolIds?: string[];
        skillIds?: string[];
        mcpProfileIds: string[];
    };
    memoryPolicy?: {
        namespaceId: string;
        readScopes: string[];
        writeScopes: string[];
        retrievalLimit?: number;
    };
    defaultContextPolicy?: {
        tokenBudget?: number;
        automaticCompression?: boolean;
    };
}
export interface AgentConfig {
    imageProcessing?: ImageProcessingPreference;
    systemPrompt?: string;
    systemPromptId?: string;
    maxHistoryLength?: number;
    temperature?: number;
    mcpServers?: string[];
}
export interface ImageProcessingPreference {
    readonly resize?: ImageResizePolicy;
}
export type ImageResizePolicy = {
    readonly mode: 'original';
} | {
    readonly mode: 'max-edge';
    readonly maxEdge: number;
};
export type ModelDefaults = Partial<Record<ModelOperation, string>>;
export type ModelOperation = 'chat'|'image.generate'|'speech.synthesize';
export interface AgentComposition {
    coordinatorAgentId: string;
    memberAgentIds: string[];
    maxDelegations?: number;
    maxConcurrency?: number;
}
export type AgentExecution = {
    kind: 'agent';
} | {
    kind: 'harness';
    connectionId: string;
} | {
    kind: 'flow';
    flowId: string;
    revision?: number;
    parameters?: Record<string, unknown>;
    connectionBindings?: Record<string, string>;
};
export interface AgentAvailability {
    status: 'ready' | 'disabled';
    reason?: 'flow-missing' | 'flow-unpublished' | 'flow-revision-missing' | 'flow-invalid';
    flowId?: string;
}
export interface AgentInterfaceDef {
    inputs: Array<{
        name: string;
        type: string;
    }>;
    outputs: Array<{
        name: string;
        type: string;
    }>;
}
export interface PromptPreset {
    name: string;
    prompt: string;
}
export interface IAgentManagementService {
publishAgent?(request: AgentPublishRequest): Promise<AgentPublishedRevision>;
getHarnessConnectionTargets?(): Promise<HarnessExecutionConnectionTarget[]>;
getHarnessConnectionRecord?(id: string): Promise<HarnessExecutionConnectionRecord | undefined>;
saveHarnessConnection?(connection: HarnessExecutionConnection, expectedRevision: number): Promise<HarnessExecutionConnectionRecord>;
saveAgent(agent: AgentDefinition, options?: {
    onDuplicate?: 'merge' | 'error';
}): Promise<void>;
getAgentPublicationStatus?(agentId: string): Promise<AgentPublicationStatus>;
getAgentPublicationReceipt?(request: AgentPublishRequest): Promise<AgentPublishedRevision | null>;
getAgentConfig(agentId: string): Promise<AgentDefinition | null>;
getAgentResourceId?(agentId: string): string | undefined;
getAgents(): Promise<AgentDefinition[]>;
getSystemPrompt(id: string): Promise<SystemPromptDefinition | null>;
listSystemPrompts(): Promise<SystemPromptDefinition[]>;
saveSystemPrompt(prompt: SystemPromptDefinition): Promise<void>;
deleteSystemPrompt(id: string): Promise<void>;
getSkills(): Promise<LLMSkill[]>;
getHarnessConnections?(): Promise<HarnessExecutionConnection[]>;
getModelDefaults(): Promise<ModelDefaults>;
getConnections(): Promise<ConnectionMeta[]>;
getDefaultConnection(operation?: ModelOperation): Promise<ConnectionMeta | null>;
getFullConnection(id: string): Promise<LLMConnection | null>;
onChange(listener: () => void): () => void;
getProviders(): Array<LLMProvider & {
    hasApiKey?: boolean;
}>;
getFullProvider(id: string): LLMProvider | undefined | Promise<LLMProvider | undefined>;
supportsMCPStdio?(): boolean;
getMCPServers(): Promise<MCPServer[]>;
saveMCPServer(server: MCPServer): Promise<void>;
testMCPServer(server: MCPServer): Promise<MCPDiscovery>;
readMCPResource(serverId: string, uri: string): Promise<unknown>;
getMCPPrompt(serverId: string, name: string, args?: Record<string, string>): Promise<unknown>;
saveSkill(skill: LLMSkill): Promise<void>;
deleteSkill(id: string): Promise<void>;
writePricing(config: ModelPricingConfig): Promise<void>;
queryCosts(filter?: {
    dateFrom?: string;
    dateTo?: string;
    providerId?: string;
}): Promise<CostRecord[]>;
getPricingConfig(): ModelPricingConfig;
getPricingDefaults(): ModelPricingConfig;
setModelDefault(operation: ModelOperation, id: string | null): Promise<void>;
setDefaultConnection(id: string | null): Promise<void>;
saveConnection(conn: LLMConnection): Promise<void>;
getProviderDefaults(): Record<string, LLMProvider>;
getProviderReferences?(): Record<string, ProviderApiReference>;
saveProvider(provider: LLMProvider): Promise<void>;
testConnection(params: ProviderConnectionTestParams): Promise<ConnectionTestResult>;
listProviderModels(provider: LLMProvider): Promise<LLMModel[]>;
getProviderAuthorization?(providerId: string): Promise<ProviderAuthorizationState>;
beginProviderAuthorization?(providerId: string): Promise<ProviderAuthorizationState>;
completeProviderAuthorization?(providerId: string, attemptId: string, callbackUrl: string): Promise<ProviderAuthorizationState>;
cancelProviderAuthorization?(providerId: string): Promise<ProviderAuthorizationState>;
disconnectProviderAuthorization?(providerId: string): Promise<ProviderAuthorizationState>;
}
export interface AgentPublishRequest {
    agentId: string;
    operationId: string;
    expectedSourceDigest: string;
    expectedRevisionDigest: string;
    expectedPublishedVersion: string | null;
}
export interface AgentPublishedRevision extends AgentRevisionContent {
    schemaVersion: 1;
    target: {
        kind: 'agent';
        id: string;
        version: string;
        digest: string;
    };
    createdAt: number;
}
export interface AgentRevisionContent {
    definition: AgentDefinition;
    sourceDigest: string;
    systemPrompt?: SystemPromptDefinition;
    flow?: {
        id: string;
        revision: number;
        digest: string;
    };
}
export interface SystemPromptDefinition {
    id: string;
    name: string;
    description?: string;
    content: string[];
    presets?: PromptPreset[];
}
export interface HarnessExecutionConnectionTarget {
    nodeConnectionId: string;
    projectId: string;
    projectName: string;
    profiles: Array<{
        id: string;
        name?: string;
        kind: string;
    }>;
    available: boolean;
    errorCode?: string;
}
export interface HarnessExecutionConnectionRecord {
    version: 1;
    revision: number;
    connection: HarnessExecutionConnection | null;
}
export interface HarnessExecutionConnection {
    directory?: string;
    id: string;
    name: string;
    kind: 'harness';
    nodeConnectionId: string;
    projectId: string;
    profileId: string;
    enabled?: boolean;
    selection?: {
        modelId: string;
        reasoningEffort?: string;
    };
}
export interface AgentPublicationStatus {
    sourceDigest: string;
    draftDigest: string;
    latest?: Pick<AgentPublishedRevision, 'target' | 'createdAt'>;
    hasDraftChanges: boolean;
}
export type LLMSkill = SkillDefinition;
export interface SkillDefinition {
    id: string;
    name: string;
    description: string;
    type: SkillType;
    enabled: boolean;
    icon?: string;
    instructions: string;
    tools: SkillToolBinding[];
    triggerPatterns: string[];
    autoLoad: boolean;
    priority: number;
    versionPolicy?: SkillVersionPolicy;
    endpoint?: string;
    method?: 'GET' | 'POST' | 'PUT';
    headers?: Record<string, string>;
    parameters?: Record<string, unknown>;
    command?: string;
    mcpServerId?: string;
    mcpToolName?: string;
    metadata?: Record<string, unknown>;
    createdAt?: number;
    modifiedAt?: number;
    triggerStrategy?: SkillTriggerStrategy;
    source?: 'vfs' | 'filesystem';
    scopeLevel?: SkillScopeLevel;
    scopeRoot?: string;
    disableModelInvocation?: boolean;
    globs?: string[];
    compact?: CompactSection | null;
    correctionLog?: SkillCorrectionLog;
    referencePaths?: string[];
    templatePath?: string;
    fsRoot?: string;
    supportsSubagent?: boolean;
    subagentRole?: string;
    subagentModel?: string;
    taskProgram?: SkillTaskProgramRef;
}
export type SkillType = 'builtin' | 'http' | 'shell' | 'prompt' | 'mcp' | 'custom';
export interface SkillToolBinding {
    toolId: string;
    definition: ToolDefinition;
    executionType: 'builtin' | 'http' | 'shell' | 'handler' | 'mcp';
    mcpServerId?: string;
    mcpToolName?: string;
    args?: string[];
    command?: string;
    sideEffect?: ToolSideEffect;
    timeoutMs?: number;
}
export interface ToolDefinition {
    type?: 'function' | 'computer_20241022' | 'bash_20241022' | 'text_editor_20241022' | 'mcp';
    function?: {
        name: string;
        description?: string;
        parameters?: Record<string, any>;
        strict?: boolean;
    };
    name?: string;
    display_width_px?: number;
    display_height_px?: number;
    display_number?: number;
    computer_use?: Record<string, unknown>;
    [key: string]: unknown;
}
export type ToolSideEffect = 'none' | 'local' | 'external';
export type SkillVersionPolicy = 'keep-old' | 'require-reload';
export type SkillTriggerStrategy = 'reference' | 'action';
export type SkillScopeLevel = 'vfs' | 'global-fs' | 'parent-fs' | 'local-fs';
export interface CompactSection {
    marker: string;
    redLines: string[];
    rawContent: string;
}
export interface SkillCorrectionLog {
    root?: string;
    path: string;
    enabled: boolean;
}
export interface SkillTaskProgramRef {
    kind: string;
    version: string;
}
export interface ConnectionMeta {
    baseURL?: string;
    id: string;
    name: string;
    providerId: string;
    model: string;
    tiers?: Partial<Record<ModelTier, string>>;
    hasApiKey: boolean;
    credentialsReady?: boolean;
    enabled: boolean;
    metadata?: Record<string, unknown>;
    status?: 'active' | 'error' | 'untested';
    temperature?: number;
    dailyCosts?: Record<string, DailyCost>;
    protocol?: ApiProtocol;
}
export type ModelTier = 'optimal' | 'standard' | 'fast';
export interface DailyCost {
    date: string;
    inputTokens: number;
    outputTokens: number;
    cost: number;
    requests: number;
}
export type ApiProtocol = 'openai-chat' | 'openai-responses' | 'anthropic-messages' | 'gemini-generate';
export interface LLMConnection {
    id: string;
    name: string;
    providerId: string;
    tiers?: Partial<Record<ModelTier, string>>;
    protocol?: ApiProtocol;
    metadata?: {
        isSystemDefault?: boolean;
        thinkingBudget?: number;
        reasoningEffort?: string;
        modelReasoningEfforts?: Record<string, string>;
        modelThinkingBudgets?: Record<string, number>;
        mcpServers?: string[];
        caching?: boolean;
        headers?: Record<string, string>;
        [key: string]: unknown;
    };
    enabled?: boolean;
    status?: 'active' | 'error' | 'untested';
    temperature?: number;
    dailyCosts?: Record<string, DailyCost>;
    lastTestedAt?: number;
    lastTestResult?: boolean;
    createdAt?: number;
    updatedAt?: number;
    baseURL?: string;
}
export interface LLMProvider {
    credentialMode?: 'api-key' | 'host';
    connectionTestModel?: string;
    media?: Partial<Record<MediaOperation, MediaEndpoint>>;
    id: string;
    name: string;
    implementation: LLMProviderImplementation;
    supportedProtocols?: ApiProtocol[];
    defaultProtocol?: ApiProtocol;
    modelsPath?: string | false;
    geminiPath?: string;
    chatPath?: string;
    baseURL: string;
    defaultPath?: string;
    anthropicPath?: string;
    responsesPath?: string;
    apiKey?: string;
    models: LLMModel[];
    icon?: string;
    authMethod?: 'bearer' | 'api-key' | 'query-param';
    supportsThinking?: boolean;
    requiresReferer?: boolean;
    capabilities?: {
        vision?: boolean;
        audioInput?: boolean;
        audioOutput?: boolean;
        tools?: boolean;
        thinking?: boolean;
        streaming?: boolean;
        serverSideWebSearch?: boolean;
    };
    responses?: {
        defaultThinkingEnabled?: boolean;
    };
    isBuiltin?: boolean;
    enabled?: boolean;
    defaultTemperature?: number;
    dailyCosts?: Record<string, DailyCost>;
}
export type MediaOperation = 'image.generate' | 'speech.synthesize';
export interface MediaEndpoint {
    adapter: string;
    path?: string;
    operation?: MediaOperation;
    adapterVersion?: string;
    sampleRate?: number;
    responseFormat?: 'b64_json' | 'url';
    outputFormatParameter?: boolean;
    assetHosts?: string[];
}
export type LLMProviderImplementation = 'openai-compatible' | 'chatgpt' | 'anthropic' | 'gemini' | 'custom';
export interface LLMModel {
    reasoning?: ReasoningCapabilities | false;
    reasoningByProtocol?: Partial<Record<ApiProtocol, ReasoningCapabilities | false>>;
    capabilitiesKnown?: boolean;
    operations?: Partial<Record<MediaOperation, MediaModelCapabilities>>;
    supportedOperations?: MediaOperation[];
    id: string;
    name: string;
    icon?: string;
    category?: ModelCategory;
    preferredProtocol?: ApiProtocol;
    contextWindow?: number;
    maxOutput?: number;
    supportsVision?: boolean;
    supportsThinking?: boolean;
    thinkingMode?: 'auto' | 'enabled' | 'disabled';
    supportsTools?: boolean;
    supportsAudio?: boolean;
    supportsVideo?: boolean;
    supportsStructuredOutput?: boolean;
    inputPricePerMillion?: number;
    outputPricePerMillion?: number;
    cacheWritePricePerMillion?: number;
    cacheReadPricePerMillion?: number;
}
export interface ReasoningCapabilities {
    source?: 'catalog' | 'preset' | 'user';
    efforts: Array<{
        id: string;
        label?: string;
        value?: string;
    }>;
    defaultEffort?: string;
    canDisable?: boolean;
    budget?: {
        min: number;
        max: number;
    };
    transport?: 'effort' | 'deepseek' | 'adaptive' | 'budget';
}
export interface MediaModelCapabilities {
    inputModalities: string[];
    outputModalities: string[];
    formats: string[];
    voices?: string[];
    sizes?: string[];
    qualities?: string[];
    features?: string[];
    maxInputCharacters?: number;
    maxOutputs?: number;
    speedRange?: {
        min: number;
        max: number;
    };
}
export type ModelCategory = 'chat' | 'image' | 'video' | 'audio' | 'embedding';
export interface MCPServer {
    id: string;
    name: string;
    transport: 'stdio' | 'http';
    command?: string;
    endpoint?: string;
    status?: MCPConnectionState['status'];
    connectionState?: MCPConnectionState;
    args?: string;
    cwd?: string;
    apiKey?: string;
    auth?: MCPAuthentication;
    extensions?: Record<string, unknown>;
    headers?: Record<string, string>;
    env?: Record<string, string>;
    autoConnect?: boolean;
    timeout?: number;
    timeoutUnit?: 'ms';
    tools?: unknown[];
    resources?: unknown[];
    prompts?: unknown[];
    icon?: string;
    description?: string;
}
export interface MCPConnectionState {
    status: 'idle' | 'connecting' | 'connected' | 'error';
    checkedAt?: number;
    issues: Array<{
        stage: 'connect' | 'discover';
        reason: 'authentication' | 'timeout' | 'network' | 'closed' | 'unknown';
    }>;
}
export interface MCPAuthentication {
    type: 'basic' | 'bearer' | 'anonymous';
    credentialRef: string;
    username?: string;
}
export interface MCPDiscovery {
    protocolVersion?: string;
    capabilities?: {
        tools: boolean;
        resources: boolean;
        prompts: boolean;
    };
    metadata?: Record<string, unknown>;
    extensions?: Record<string, unknown>;
    tools: Array<{
        name: string;
        description?: string;
        inputSchema: Record<string, unknown>;
    }>;
    resources: Array<{
        uri: string;
        name: string;
        description?: string;
        mimeType?: string;
    }>;
    prompts: Array<{
        name: string;
        description?: string;
        arguments?: Array<{
            name: string;
            description?: string;
            required?: boolean;
        }>;
    }>;
}
export interface ModelPricingConfig {
    model_pricing: ModelPricingEntry[];
    reference_catalog?: ModelPriceCatalog;
}
export interface ModelPricingEntry {
    id: string;
    price: [
        number,
        number,
        number,
        number
    ];
    providers: Record<string, string[]>;
    names?: string[];
    fallbackFor?: string[];
}
export interface ModelPriceCatalog {
    version: number;
    providers: Record<string, ProviderPriceCatalog>;
}
export interface ProviderPriceCatalog {
    sourceUrl: string;
    reviewedAt: string;
    status: 'published' | 'account' | 'subscription' | 'unknown';
    models: ModelReferencePrice[];
}
export interface ModelReferencePrice {
    modelIds: string[];
    sourceUrl?: string;
    currency: 'USD' | 'CNY';
    unit: ModelPriceUnit;
    tokenModality?: 'text' | 'audio' | 'video';
    status?: 'unverified' | 'variable';
    rates: ModelPriceBand[];
}
export type ModelPriceUnit = 'million-tokens' | 'image' | 'million-characters' | 'ten-thousand-characters' | 'second' | 'minute';
export interface ModelPriceBand {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    conditions?: {
        minInputTokens?: number;
        maxInputTokens?: number;
        minImagePixels?: number;
        maxImagePixels?: number;
        period?: 'peak' | 'off-peak';
        operation?: 'image.generate' | 'image.layer';
        validUntil?: string;
        minInputImages?: number;
        maxInputImages?: number;
        includesVideo?: boolean;
        videoHeight?: number;
    };
}
export interface CostRecord {
    sessionId: string;
    providerId: string;
    connectionId: string;
    modelId: string;
    date: string;
    inputTokens: number;
    outputTokens: number;
    cacheWriteTokens?: number;
    cacheReadTokens?: number;
    cost: number;
    requests: number;
}
export interface ProviderApiReference {
    version: number;
    reviewedAt: string;
    scope: string;
    sources: Array<{
        id: string;
        title: string;
        url: string;
    }>;
    models: Array<ApiReferenceEntry & {
        kind: 'resource' | 'body-model';
    }>;
    formats: Array<ApiReferenceEntry & {
        wireValue: string;
        sampleRates: number[];
        defaultSampleRate: number;
    }>;
    voices: Array<{
        id: string;
        name: string;
        languages: string[];
        notes?: string;
    }>;
    parameters: Array<{
        path: string;
        name: string;
        type: string;
        required: boolean;
        support: ApiSupport;
        clientField?: string;
        default?: string | number | boolean;
        min?: number;
        max?: number;
        notes?: string;
    }>;
    discovery: {
        models: string;
        voices: string;
    };
    response: {
        audioCode: number;
        completionCode: number;
        emptyCompletionData: boolean;
    };
    notes: string[];
}
export interface ApiReferenceEntry {
    id: string;
    name: string;
    support: ApiSupport;
    notes?: string;
}
export type ApiSupport = 'implemented' | 'partial' | 'unsupported';
export interface ProviderConnectionTestParams {
    operation?: 'chat' | MediaOperation;
    request?: MediaGenerationInput;
    provider: string;
    apiKey?: string;
    baseURL?: string;
    model?: string;
    protocol?: ApiProtocol;
    providerDefinition?: LLMProvider;
}
export type MediaGenerationInput = Omit<ImageGenerationRequest, 'signal'> | Omit<SpeechSynthesisRequest, 'signal'>;
export interface ImageGenerationRequest {
    operation: 'image.generate';
    model?: string;
    prompt: string;
    format: 'png' | 'jpeg' | 'webp';
    size?: string;
    quality?: string;
    count?: number;
    signal?: AbortSignal;
}
export interface SpeechSynthesisRequest {
    operation: 'speech.synthesize';
    model?: string;
    input: string;
    voice: string;
    format: 'mp3' | 'opus' | 'aac' | 'flac' | 'wav' | 'pcm';
    speed?: number;
    instructions?: string;
    signal?: AbortSignal;
}
export interface ConnectionTestResult {
    success: boolean;
    message: string;
    latency?: number;
    model?: string;
    operation?: 'chat' | MediaOperation;
    requestId?: string;
    code?: string;
    statusCode?: number;
    remoteCode?: string;
    stage?: 'validation' | 'transport' | 'response';
    transportCode?: string;
    assets?: Array<{
        mimeType: string;
        data: Uint8Array;
    }>;
}
export interface ProviderAuthorizationState {
    supported: boolean;
    status: 'signed-out' | 'pending' | 'authorized' | 'reauthorize' | 'error';
    account?: string;
    issue?: string;
    pending?: {
        id: string;
        url: string;
        callbackUri: string;
        expiresAt: number;
    };
}
export interface IConnectionService {
setModelDefault(operation: ModelOperation, id: string | null): Promise<void>;
setDefaultConnection(id: string | null): Promise<void>;
saveConnection(conn: LLMConnection): Promise<void>;
getProviderDefaults(): Record<string, LLMProvider>;
getProviderReferences?(): Record<string, ProviderApiReference>;
getPricingConfig?(): ModelPricingConfig;
saveProvider(provider: LLMProvider): Promise<void>;
testConnection(params: ProviderConnectionTestParams): Promise<ConnectionTestResult>;
listProviderModels(provider: LLMProvider): Promise<LLMModel[]>;
getHarnessConnections?(): Promise<HarnessExecutionConnection[]>;
getModelDefaults(): Promise<ModelDefaults>;
getConnections(): Promise<ConnectionMeta[]>;
getDefaultConnection(operation?: ModelOperation): Promise<ConnectionMeta | null>;
getFullConnection(id: string): Promise<LLMConnection | null>;
onChange(listener: () => void): () => void;
getProviders(): Array<LLMProvider & {
    hasApiKey?: boolean;
}>;
getFullProvider(id: string): LLMProvider | undefined | Promise<LLMProvider | undefined>;
getProviderAuthorization?(providerId: string): Promise<ProviderAuthorizationState>;
beginProviderAuthorization?(providerId: string): Promise<ProviderAuthorizationState>;
completeProviderAuthorization?(providerId: string, attemptId: string, callbackUrl: string): Promise<ProviderAuthorizationState>;
cancelProviderAuthorization?(providerId: string): Promise<ProviderAuthorizationState>;
disconnectProviderAuthorization?(providerId: string): Promise<ProviderAuthorizationState>;
}
export type MediaProbeExamples = Readonly<Partial<Record<MediaOperation, Readonly<{
    input: string;
}>>>>;
export interface LLMConfigFile {
    provider?: LLMProviderDef;
    providers?: LLMProviderDef[];
    connections?: LLMConnectionDef[];
    agents?: LLMAgentDef[];
    skills?: LLMSkillDef[];
    mcp?: LLMMCPDef;
    pricing?: ModelPricingEntry[];
}
export interface LLMProviderDef {
    credentialMode?: LLMProvider['credentialMode'];
    id: string;
    name: string;
    implementation: string;
    baseURL: string;
    apiKey?: string;
    icon?: string;
    authMethod?: 'bearer' | 'api-key' | 'query-param';
    supportsThinking?: boolean;
    requiresReferer?: boolean;
    isBuiltin?: boolean;
    enabled?: boolean;
    defaultTemperature?: number;
    defaultPath?: string;
    anthropicPath?: string;
    geminiPath?: string;
    chatPath?: string;
    modelsPath?: LLMProvider['modelsPath'];
    supportedProtocols?: LLMProvider['supportedProtocols'];
    defaultProtocol?: LLMProvider['defaultProtocol'];
    responsesPath?: string;
    responses?: {
        defaultThinkingEnabled?: boolean;
    };
    media?: LLMProvider['media'];
    connectionTestModel?: string;
    models: LLMModelDef[];
}
export interface LLMModelDef {
    id: string;
    name: string;
    icon?: string;
    preferredProtocol?: LLMModel['preferredProtocol'];
    category?: LLMModel['category'];
    operations?: LLMModel['operations'];
    supportedOperations?: LLMModel['supportedOperations'];
    reasoning?: LLMModel['reasoning'];
    reasoningByProtocol?: LLMModel['reasoningByProtocol'];
    capabilitiesKnown?: boolean;
    thinkingMode?: LLMModel['thinkingMode'];
    contextWindow?: number;
    maxOutput?: number;
    supportsVision?: boolean;
    supportsThinking?: boolean;
    supportsTools?: boolean;
    supportsAudio?: boolean;
    supportsVideo?: boolean;
    supportsStructuredOutput?: boolean;
    inputPricePerMillion?: number;
    outputPricePerMillion?: number;
}
export interface LLMConnectionDef {
    protocol?: LLMConnection['protocol'];
    baseURL?: string;
    enabled?: boolean;
    temperature?: number;
    metadata?: LLMConnection['metadata'];
    id: string;
    name: string;
    providerId: string;
    tiers?: Record<string, string>;
}
export interface LLMAgentDef extends Omit<AgentDefinition, 'type' | 'config' | 'interface' | 'createdAt' | 'modifiedAt'> {
    id: string;
    name: string;
    type?: string;
    icon?: string;
    description?: string;
    config: {
        systemPrompt?: string;
        maxHistoryLength?: number;
        temperature?: number;
        mcpServers?: string[];
        [key: string]: unknown;
    };
    tags?: string[];
    interface?: unknown;
}
export interface LLMSkillDef {
    id: string;
    name: string;
    description?: string;
    type?: string;
    enabled?: boolean;
    icon?: string;
    prompt?: string;
    instructions?: string;
    endpoint?: string;
    method?: string;
    headers?: Record<string, string>;
    command?: string;
    parameters?: Record<string, unknown>;
    mcpServerId?: string;
    mcpToolName?: string;
    triggerStrategy?: string;
    autoLoad?: boolean;
    priority?: number;
    globs?: string[];
    correctionLog?: string;
    disableModelInvocation?: boolean;
    metadata?: Record<string, unknown>;
    [key: string]: unknown;
}
export interface LLMMCPDef {
    servers: Array<{
        name: string;
        transport: 'stdio' | 'http';
        command?: string;
        args?: string[];
        url?: string;
        env?: Record<string, string>;
    }>;
    timeout?: number;
}
export type ConflictStrategy = 'skip' | 'overwrite' | 'rename';
export interface ConflictItem {
    type: 'provider' | 'connection' | 'agent' | 'skill';
    id: string;
    name: string;
}
export interface ImportStats {
    providers: number;
    connections: number;
    agents: number;
    skills: number;
    skipped: number;
}
export interface ConfigurationImportPort {
    previewConfigurationImport(config: LLMConfigFile): Promise<ConflictItem[]>;
    importConfiguration(config: LLMConfigFile, strategy: ConflictStrategy): Promise<ImportStats>;
}

export type LocaleKey = string;
export type PricingBasis = 'model'|'provider-default'|'global-default';
export interface DefaultConnectionDef {
 id:string;name:string;providerId:string;tiers?:Partial<Record<ModelTier,string>>;protocol?:ApiProtocol;
 baseURL?:string;enabled?:boolean;temperature?:number;metadata?:LLMConnection['metadata'];
}
