import { ChatRequest } from './ChatRequest';
import { ChatStreamChunk } from './ChatStreamChunk';
import { ApiError } from './ApiError';
import { ConfigurationError } from '../Configuration/ConfigurationError';

export interface ChatClient {
	streamChat(
		request: ChatRequest,
		signal: AbortSignal,
	): ReturnOrThrowError<AsyncIterable<ChatStreamChunk>, ConfigurationError | ApiError | DOMException>;

	/**
	 * Runs a request and resolves with the concatenated text content once the
	 * stream is exhausted. Intended for features that only need the final
	 * answer (completions, commit messages) rather than incremental output.
	 */
	complete(
		request: ChatRequest,
		signal: AbortSignal,
	): ReturnOrThrowError<Promise<string>, ConfigurationError | ApiError | DOMException>;
}
