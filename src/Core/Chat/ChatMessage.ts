export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

/** `arguments` is JSON-encoded so it can be forwarded verbatim to the API. */
export interface ToolCall {
	readonly id: string;
	readonly name: string;
	readonly arguments: string;
}

export interface ChatMessage {
	readonly role: ChatRole;
	readonly content: string | null;
	/**
	 * Thinking-mode chain of thought. DeepSeek requires it to be echoed back on
	 * assistant messages while tools are in play, so it is kept separate from
	 * `content` and re-sent as `reasoning_content`.
	 */
	readonly reasoningContent?: string | null;
	readonly toolCalls?: readonly ToolCall[];
	readonly toolCallId?: string;
}
