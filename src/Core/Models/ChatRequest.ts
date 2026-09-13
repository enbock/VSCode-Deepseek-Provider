import { ChatMessage } from './ChatMessage';

export interface ToolDefinition {
	readonly name: string;
	readonly description: string;
	readonly inputSchema?: object;
}

export type ToolChoiceMode = 'auto' | 'required' | 'none';

/**
 * A request to complete a chat conversation. The model-specific wire format
 * is produced by the infrastructure client, keeping this type API-agnostic.
 */
export interface ChatRequest {
	readonly model: string;
	readonly messages: readonly ChatMessage[];
	readonly temperature?: number;
	readonly maxTokens?: number;
	readonly tools?: readonly ToolDefinition[];
	readonly toolChoice?: ToolChoiceMode;
}
