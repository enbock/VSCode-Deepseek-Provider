import { ChatRequest } from '../Models/ChatRequest';
import { ChatStreamChunk } from '../Models/ChatStreamChunk';

/**
 * Port for the remote language-model API. Implementations translate a
 * {@link ChatRequest} into the provider-specific wire format and stream the
 * response back as an asynchronous sequence of {@link ChatStreamChunk}.
 */
export interface IChatClient {
	streamChat(request: ChatRequest, signal: AbortSignal): AsyncIterable<ChatStreamChunk>;
}
