import { ModelInfo } from './ModelInfo';

/**
 * Input and output are billed against the same 1M-token window, so the input
 * budget has to leave room for the largest completion the API accepts.
 */
const CONTEXT_WINDOW_TOKENS = 1_048_576;
const MAX_OUTPUT_TOKENS = 393_216;

export class ModelCatalog {
	private readonly models: readonly ModelInfo[] = [
		{
			id: 'deepseek-flash',
			name: 'DeepSeek Flash',
			family: 'deepseek-flash',
			version: 'v4.1',
			maxInputTokens: CONTEXT_WINDOW_TOKENS - MAX_OUTPUT_TOKENS,
			maxOutputTokens: MAX_OUTPUT_TOKENS,
			supportsToolCalling: true,
			supportsImageInput: false,
			tooltip: 'DeepSeek-V4.1-Flash: fast and low cost, for everyday tasks.',
		},
		{
			id: 'deepseek-v4-pro',
			name: 'DeepSeek V4 Pro',
			family: 'deepseek-v4-pro',
			version: 'v4-pro-0813',
			maxInputTokens: CONTEXT_WINDOW_TOKENS - MAX_OUTPUT_TOKENS,
			maxOutputTokens: MAX_OUTPUT_TOKENS,
			supportsToolCalling: true,
			supportsImageInput: false,
			tooltip: 'DeepSeek-V4-Pro: slower and more expensive, for harder reasoning.',
		},
	];

	getModels(): readonly ModelInfo[] {
		return this.models;
	}

	findById(id: string): ModelInfo | undefined {
		return this.models.find((model) => model.id === id);
	}
}
