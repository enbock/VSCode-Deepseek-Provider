import { ToolCall } from './ChatMessage';

/** Token accounting the API reports for a single completion. */
export interface TokenUsage {
	readonly promptTokens: number;
	readonly completionTokens: number;
	readonly totalTokens: number;
	readonly cachedTokens: number;
}

export interface ChatStreamChunk {
	readonly text?: string;
	readonly toolCalls?: readonly ToolCall[];
	readonly finishReason?: string | null;
	readonly usage?: TokenUsage;
}
