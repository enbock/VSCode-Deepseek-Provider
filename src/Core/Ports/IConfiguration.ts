/**
 * Port for reading user and extension configuration. Implementations are
 * responsible for resolving secrets such as the API key.
 */
export interface IConfiguration {
	getApiKey(): Promise<string | undefined>;
	getBaseUrl(): string;
	getDefaultModel(): string;
	getTemperature(): number;
	getMaxOutputTokens(): number;
	getSystemPrompt(): string | undefined;
}
