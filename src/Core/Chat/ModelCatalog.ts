import { ModelInfo } from './ModelInfo';

/**
 * Input and output are billed against the same 128K-token window, so the input
 * budget has to leave room for the largest completion the API accepts.
 */
const CONTEXT_WINDOW_TOKENS = 131_072;
const MAX_OUTPUT_TOKENS = 8_192;

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

	/**
	 * Maps the raw IDs reported by the API back to ModelInfo entries. Known IDs
	 * keep their curated catalog metadata; unknown IDs (models released after
	 * this extension shipped) get conservative defaults so the chat view can
	 * still offer them.
	 */
	resolve(ids: readonly string[]): readonly ModelInfo[] {
		return ids.map((id) => this.findById(id) ?? this.toFallbackModel(id));
	}

	private toFallbackModel(id: string): ModelInfo {
		return {
			id,
			name: id,
			family: id,
			version: '',
			maxInputTokens: CONTEXT_WINDOW_TOKENS - MAX_OUTPUT_TOKENS,
			maxOutputTokens: MAX_OUTPUT_TOKENS,
			supportsToolCalling: true,
			supportsImageInput: false,
		};
	}
}
