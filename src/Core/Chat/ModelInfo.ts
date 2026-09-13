export interface ModelInfo {
	readonly id: string;
	readonly name: string;
	readonly family: string;
	readonly version: string;
	readonly maxInputTokens: number;
	readonly maxOutputTokens: number;
	readonly supportsToolCalling: boolean;
	readonly supportsImageInput: boolean;
	readonly tooltip?: string;
}
