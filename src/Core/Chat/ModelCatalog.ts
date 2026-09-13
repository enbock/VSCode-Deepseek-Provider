import { ModelInfo } from './ModelInfo';

export class ModelCatalog {
	private readonly models: readonly ModelInfo[] = [
		{
			id: 'deepseek-chat',
			name: 'DeepSeek Chat',
			family: 'deepseek-chat',
			version: 'v3',
			maxInputTokens: 128000,
			maxOutputTokens: 8192,
			supportsToolCalling: true,
			supportsImageInput: false,
			tooltip: 'DeepSeek-V3 general purpose chat model.',
		},
		{
			id: 'deepseek-reasoner',
			name: 'DeepSeek Reasoner',
			family: 'deepseek-reasoner',
			version: 'r1',
			maxInputTokens: 128000,
			maxOutputTokens: 65536,
			supportsToolCalling: false,
			supportsImageInput: false,
			tooltip: 'DeepSeek-R1 reasoning model.',
		},
	];

	getModels(): readonly ModelInfo[] {
		return this.models;
	}

	findById(id: string): ModelInfo | undefined {
		return this.models.find((model) => model.id === id);
	}
}
