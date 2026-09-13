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
	readonly toolCalls?: readonly ToolCall[];
	readonly toolCallId?: string;
}
