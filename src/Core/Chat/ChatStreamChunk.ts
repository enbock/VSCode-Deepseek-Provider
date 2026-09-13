import { ToolCall } from './ChatMessage';

export interface TokenUsage {
	readonly inputTokens: number;
	readonly outputTokens: number;
}

export interface ChatStreamChunk {
	readonly text?: string;
	readonly toolCalls?: readonly ToolCall[];
	readonly finishReason?: string | null;
}
