import { ChatRequest } from './ChatRequest';
import { ChatStreamChunk } from './ChatStreamChunk';
import { ApiError } from './ApiError';
import { ConfigurationError } from '../Configuration/ConfigurationError';

export interface ChatClient {
	streamChat(
		request: ChatRequest,
		signal: AbortSignal,
	): ReturnOrThrowError<AsyncIterable<ChatStreamChunk>, ConfigurationError | ApiError | DOMException>;
}
