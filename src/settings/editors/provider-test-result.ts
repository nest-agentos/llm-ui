import type { SettingsRuntime } from '../runtime';
import type { ConnectionTestResult } from '../contracts/domain';
/** Render business status and actionable diagnostics consistently for every probe. */
export function providerTestResult(runtime: SettingsRuntime, result: ConnectionTestResult): string {
    const operation = result.operation === 'image.generate' ? dependencies(runtime).t('model.capability.imageGeneration')
        : result.operation === 'speech.synthesize' ? dependencies(runtime).t('model.capability.speechSynthesis') : dependencies(runtime).t('provider.test.chatOperation');
    return [dependencies(runtime).t(result.success ? 'provider.protocol.verified' : 'provider.protocol.failed'), result.message,
        operation, result.model && dependencies(runtime).t('provider.test.model', { model: result.model }),
        result.stage && dependencies(runtime).t(`provider.test.stage.${result.stage}`), result.statusCode !== undefined && `HTTP ${result.statusCode}`,
        result.code, result.transportCode, result.remoteCode, result.latency !== undefined && `${result.latency} ms`,
        result.requestId, !result.success && failureHint(runtime, result)].filter(value => value !== undefined && value !== false && value !== '').join(' · ');
}
function failureHint(runtime: SettingsRuntime, result: ConnectionTestResult): string | undefined {
    if (result.code === 'NETWORK_ERROR')
        return dependencies(runtime).t('provider.test.networkHint');
    if (result.code === 'TIMEOUT')
        return dependencies(runtime).t('provider.test.timeoutHint');
    if (result.statusCode === 401 || result.statusCode === 403)
        return dependencies(runtime).t('provider.test.credentialsHint');
    if (result.statusCode === 404)
        return dependencies(runtime).t('provider.test.endpointHint');
    if (result.statusCode === 429)
        return dependencies(runtime).t('provider.test.rateLimitHint');
    if (result.statusCode !== undefined && result.statusCode >= 500)
        return dependencies(runtime).t('provider.test.serverHint');
}
function createDependencies(runtime: SettingsRuntime) { return { t: runtime.presentation.t }; }
export function bind(runtime: SettingsRuntime) { return { providerTestResult: providerTestResult.bind(null, runtime) }; }

const dependencyCache = new WeakMap<SettingsRuntime, ReturnType<typeof createDependencies>>();
function dependencies(runtime: SettingsRuntime) {
    let value = dependencyCache.get(runtime);
    if (!value) { value = createDependencies(runtime); dependencyCache.set(runtime, value); }
    return value;
}
