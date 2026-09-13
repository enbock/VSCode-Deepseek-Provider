export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

/**
 * A tool call request produced by the model. `arguments` is kept as a JSON
 * string so that it can be forwarded verbatim to OpenAI-compatible APIs.
 */
export interface ToolCall {
	readonly id: string;
	readonly name: string;
	readonly arguments: string;
}

/**
 * A single chat message in an OpenAI-compatible wire format. The extra
 * fields only apply to the `tool` and `assistant` roles respectively.
 */
export interface ChatMessage {
	readonly role: ChatRole;
	readonly content: string | null;
	readonly toolCalls?: readonly ToolCall[];
	readonly toolCallId?: string;
}
