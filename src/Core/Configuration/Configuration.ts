export interface Configuration {
	getApiKey(): Promise<string | undefined>;
	getBaseUrl(): string;
	getDefaultModel(): string;
	getTemperature(): number;
	getMaxOutputTokens(): number;
	getSystemPrompt(): string | undefined;
	isCompletionEnabled(): boolean;
	getCompletionModel(): string;
	getCompletionTemperature(): number;
	getCompletionMaxTokens(): number;
}
