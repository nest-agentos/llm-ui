import type { DefaultConnectionDef, PricingBasis, ApiProtocol, ConnectionMeta, CostRecord, ImageResizePolicy, LLMConfigFile, LLMConnectionDef, LLMModel, LLMProvider, LLMProviderDef, MCPServer, MediaModelCapabilities, MediaOperation, ModelPriceCatalog, ModelPricingConfig, ModelPricingEntry, ModelReferencePrice, ModelTier, ProviderPriceCatalog, ReasoningCapabilities } from './domain';
export interface SettingsRules {
    hasConnectionCredentials: (connection: Pick<ConnectionMeta, "credentialsReady" | "hasApiKey" | "providerId">) => boolean;
    modelForOperation: (connection: ConnectionMeta, provider: LLMProvider | undefined, operation: "chat" | "image.generate" | "speech.synthesize") => LLMModel | undefined;
    resolveChatModelForTier: (connection: Pick<ConnectionMeta, "tiers" | "model">, provider: Pick<LLMProvider, "models"> | undefined, tier: ModelTier) => LLMModel | undefined;
    resolveModelForTier: (conn: Pick<ConnectionMeta, "tiers" | "model">, tier: ModelTier) => string;
    getProviderDefaultProtocol: (provider: LLMProvider) => ApiProtocol;
    modelReasoning: (model: LLMModel | undefined, protocol?: ApiProtocol | undefined) => ReasoningCapabilities | undefined;
    getProviderProtocols: (provider: LLMProvider) => ApiProtocol[];
    fromConnectionDef: (conn: DefaultConnectionDef) => LLMConnectionDef;
    serializeLLMConfig: (config: LLMConfigFile) => string;
    aggregateCostRecords: (records: CostRecord[]) => {
        inputTokens: number;
        outputTokens: number;
        cacheWriteTokens: number;
        cacheReadTokens: number;
        cost: number;
        requests: number;
    };
    lookupPricingEntry: (config: ModelPricingConfig, providerId: string, actualModelId: string) => ModelPricingEntry | undefined;
    mcpConfiguration: (server: MCPServer) => MCPServer;
    mcpTimeoutMs: (server: Pick<MCPServer, "timeout" | "timeoutUnit">) => number;
    MODEL_OPERATIONS: readonly [
        "chat",
        "image.generate",
        "speech.synthesize"
    ];
    getPrimaryProtocol: (provider: Pick<LLMProvider, "implementation">) => ApiProtocol;
    exportBundleToLLM: (providers: LLMProvider[], connections: DefaultConnectionDef[], options?: {
        pricing?: ModelPricingEntry[] | undefined;
    } | undefined) => string;
    isImageResizePolicy: (value: unknown) => value is ImageResizePolicy;
    parseLLMConfig: (yamlContent: string) => LLMConfigFile;
    getProviderDefs: (config: LLMConfigFile) => LLMProviderDef[];
    isReasoningCapabilities: (value: unknown) => value is false | ReasoningCapabilities | undefined;
    API_PROTOCOLS: readonly ApiProtocol[];
    isMediaCatalog: (media: unknown, operations: unknown) => boolean;
    requireMediaCapabilities: (provider: LLMProvider, model: LLMModel, operation: MediaOperation) => MediaModelCapabilities;
    getProviderPriceCatalog: (catalog: ModelPriceCatalog | undefined, providerId: string) => ProviderPriceCatalog | undefined;
    resolveModelReferencePrice: (catalog: ModelPriceCatalog | undefined, providerId: string, modelId: string) => ModelReferencePrice | undefined;
    resolvePricingEntry: (config: ModelPricingConfig, providerId: string, modelId: string) => {
        entry: ModelPricingEntry;
        basis: PricingBasis;
    } | undefined;
}
