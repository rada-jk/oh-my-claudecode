/**
 * Resolve the default model ID for a tier.
 *
 * Resolution order:
 * 1. Environment variable (OMC_MODEL_HIGH / OMC_MODEL_MEDIUM / OMC_MODEL_LOW)
 * 2. Built-in fallback
 *
 * User/project config overrides are applied later by the config loader
 * via deepMerge, so they take precedence over these defaults.
 */
export declare function getDefaultModelHigh(): string;
export declare function getDefaultModelMedium(): string;
export declare function getDefaultModelLow(): string;
/**
 * Get all default tier models as a record.
 * Each call reads current env vars, so changes are reflected immediately.
 */
export declare function getDefaultTierModels(): Record<'LOW' | 'MEDIUM' | 'HIGH', string>;
/**
 * Detect whether the user is running a non-Claude model provider.
 *
 * CC Switch and similar tools set CLAUDE_MODEL or ANTHROPIC_MODEL to a
 * non-Claude model ID (e.g. "glm-5", "MiniMax-Text-01", "kimi-k2").
 * When a custom ANTHROPIC_BASE_URL is set, the provider is likely not
 * Anthropic's native API.
 *
 * Returns true when OMC should avoid passing Claude-specific model tier
 * names (sonnet/opus/haiku) to the Agent tool.
 */
export declare function isNonClaudeProvider(): boolean;
//# sourceMappingURL=models.d.ts.map