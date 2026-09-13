import { ChatMessage } from './ChatMessage';

export interface ToolDefinition {
	readonly name: string;
	readonly description: string;
	readonly inputSchema?: object;
}

export type ToolChoiceMode = 'auto' | 'required' | 'none';

export interface ChatRequest {
	readonly model: string;
	readonly messages: readonly ChatMessage[];
	readonly temperature?: number;
	readonly maxTokens?: number;
	readonly tools?: readonly ToolDefinition[];
	readonly toolChoice?: ToolChoiceMode;
}
