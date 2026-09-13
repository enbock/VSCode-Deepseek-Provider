import { ToolCall } from './ChatMessage';

export interface TokenUsage {
	readonly inputTokens: number;
	readonly outputTokens: number;
}

/**
 * A single increment of a streamed chat completion. Text and tool calls are
 * emitted separately; the final chunk carries the finish reason.
 */
export interface ChatStreamChunk {
	readonly text?: string;
	readonly toolCalls?: readonly ToolCall[];
	readonly finishReason?: string | null;
}
