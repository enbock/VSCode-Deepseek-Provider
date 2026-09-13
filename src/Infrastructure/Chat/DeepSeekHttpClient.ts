import { ChatClient } from '../../Core/Chat/ChatClient';
import { Configuration } from '../../Core/Configuration/Configuration';
import { Logger } from '../../Core/Logging/Logger';
import { ChatMessage, ToolCall } from '../../Core/Chat/ChatMessage';
import { ChatRequest } from '../../Core/Chat/ChatRequest';
import { ChatStreamChunk, TokenUsage } from '../../Core/Chat/ChatStreamChunk';
import { ApiError } from '../../Core/Chat/ApiError';
import { ConfigurationError } from '../../Core/Configuration/ConfigurationError';

interface WireToolCall {
	id: string;
	type: 'function';
	function: { name: string; arguments: string };
}

interface WireMessage {
	role: 'system' | 'user' | 'assistant' | 'tool';
	content: string | null;
	tool_calls?: WireToolCall[];
	tool_call_id?: string;
}

interface SseUsage {
	prompt_tokens?: number;
	completion_tokens?: number;
	total_tokens?: number;
	prompt_tokens_details?: { cached_tokens?: number } | null;
}

interface SseChunk {
	choices?: Array<{
		delta?: {
			content?: string | null;
			tool_calls?: Array<{
				index?: number;
				id?: string;
				function?: { name?: string; arguments?: string };
			}>;
		};
		finish_reason?: string | null;
	}>;
	usage?: SseUsage | null;
}

const SSE_DATA_PREFIX = 'data:';
const SSE_DONE = '[DONE]';

export class DeepSeekHttpClient implements ChatClient {
	constructor(
		private readonly configuration: Configuration,
		private readonly logger: Logger,
	) {}

	async *streamChat(
		request: ChatRequest,
		signal: AbortSignal,
	): ReturnOrThrowError<AsyncIterable<ChatStreamChunk>, ConfigurationError | ApiError | DOMException> {
		const apiKey = await this.configuration.getApiKey();
		if (!apiKey) {
			throw new ConfigurationError(
				'No DeepSeek API key configured. Run the "DeepSeek: Configure API Key" command.',
			);
		}

		const url = `${this.configuration.getBaseUrl()}/chat/completions`;
		this.logger.debug(`POST ${url} (model=${request.model})`);

		const response = await fetch(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${apiKey}`,
			},
			body: JSON.stringify(this.toWireRequest(request)),
			signal,
		});

		if (!response.ok) {
			throw await this.toApiError(response);
		}

		if (!response.body) {
			throw new ApiError('DeepSeek API returned an empty response body.', response.status);
		}

		yield* this.streamBody(response.body);
	}

	private toWireRequest(request: ChatRequest): object {
		const body: Record<string, unknown> = {
			model: request.model,
			stream: true,
			messages: request.messages.map((message) => this.toWireMessage(message)),
		};

		if (request.temperature !== undefined) {
			body.temperature = request.temperature;
		}

		if (request.maxTokens !== undefined) {
			body.max_tokens = request.maxTokens;
		}

		if (request.tools && request.tools.length > 0) {
			body.tools = request.tools.map((tool) => ({
				type: 'function',
				function: {
					name: tool.name,
					description: tool.description,
					parameters: tool.inputSchema ?? { type: 'object', properties: {} },
				},
			}));

			// DeepSeek follows OpenAI tool-choice semantics; only force 'none'
			// explicitly, otherwise leave the default (auto) behaviour.
			if (request.toolChoice === 'none') {
				body.tool_choice = 'none';
			}
		}

		return body;
	}

	private toWireMessage(message: ChatMessage): WireMessage {
		switch (message.role) {
			case 'assistant':
				return {
					role: 'assistant',
					content: message.content,
					...(message.toolCalls && message.toolCalls.length > 0
						? {
								tool_calls: message.toolCalls.map((call) => this.toWireToolCall(call)),
							}
						: {}),
				};
			case 'tool':
				return {
					role: 'tool',
					content: message.content,
					tool_call_id: message.toolCallId,
				};
			default:
				return {
					role: message.role as 'system' | 'user',
					content: message.content,
				};
		}
	}

	private toWireToolCall(call: ToolCall): WireToolCall {
		return {
			id: call.id,
			type: 'function',
			function: { name: call.name, arguments: call.arguments },
		};
	}

	private async *streamBody(body: ReadableStream<Uint8Array>): AsyncGenerator<ChatStreamChunk> {
		const reader = body.getReader();
		const decoder = new TextDecoder();
		let buffer = '';
		const pendingToolCalls = new Map<number, ToolCall>();

		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) {
					break;
				}
				buffer += decoder.decode(value, { stream: true });

				let newline = buffer.indexOf('\n');
				while (newline >= 0) {
					const line = buffer.slice(0, newline);
					buffer = buffer.slice(newline + 1);
					yield* this.handleSseLine(line, pendingToolCalls);
					newline = buffer.indexOf('\n');
				}
			}

			const tail = decoder.decode();
			if (tail.length > 0) {
				buffer += tail;
			}
			if (buffer.trim().length > 0) {
				yield* this.handleSseLine(buffer, pendingToolCalls);
			}
		} finally {
			reader.releaseLock();
		}

		// Emit each fully-accumulated tool call exactly once, after the stream
		// ends. Reporting the same callId on every delta would make VS Code treat
		// each fragment as a separate tool invocation, producing duplicate tool
		// results that DeepSeek then rejects ("Duplicate value for 'tool_call_id'").
		if (pendingToolCalls.size > 0) {
			yield { toolCalls: [...pendingToolCalls.values()] };
		}
	}

	private *handleSseLine(line: string, pendingToolCalls: Map<number, ToolCall>): Generator<ChatStreamChunk> {
		const trimmed = line.trim();
		if (!trimmed.startsWith(SSE_DATA_PREFIX)) {
			return;
		}
		const payload = trimmed.slice(SSE_DATA_PREFIX.length).trim();
		if (payload.length === 0 || payload === SSE_DONE) {
			return;
		}
		yield* this.parseChunk(payload, pendingToolCalls);
	}

	private *parseChunk(payload: string, pendingToolCalls: Map<number, ToolCall>): Generator<ChatStreamChunk> {
		let parsed: SseChunk;
		try {
			parsed = JSON.parse(payload) as SseChunk;
		} catch {
			this.logger.warn(`Skipping unparseable SSE payload: ${payload.slice(0, 120)}`);
			return;
		}

		// DeepSeek reports usage on the last chunk, which it also uses for the
		// finish marker, so read it before the choices check to keep a chunk
		// without choices from swallowing it.
		const usage = this.toTokenUsage(parsed.usage);
		if (usage) {
			yield { usage };
		}

		const choice = parsed.choices?.[0];
		if (!choice) {
			return;
		}

		if (choice.delta?.content) {
			yield { text: choice.delta.content };
		}

		for (const rawCall of choice.delta?.tool_calls ?? []) {
			const index = rawCall.index ?? 0;
			const existing = pendingToolCalls.get(index) ?? { id: '', name: '', arguments: '' };
			pendingToolCalls.set(index, {
				id: rawCall.id ?? existing.id,
				name: rawCall.function?.name ? existing.name + rawCall.function.name : existing.name,
				arguments: existing.arguments + (rawCall.function?.arguments ?? ''),
			});
		}

		if (choice.finish_reason) {
			// Tool-call deltas always precede the finish marker, so this is the
			// moment a call is complete. Flush once so the provider reports a
			// single LanguageModelToolCallPart per call.
			for (const call of pendingToolCalls.values()) {
				yield { toolCalls: [call] };
			}
			pendingToolCalls.clear();
			yield { finishReason: choice.finish_reason };
		}
	}

	/**
	 * VS Code only accepts a complete payload, so incomplete entries are dropped.
	 * DeepSeek reports usage on the final chunk of the stream only.
	 */
	private toTokenUsage(raw: SseUsage | null | undefined): TokenUsage | undefined {
		if (!raw) {
			return undefined;
		}
		const {
			prompt_tokens: promptTokens,
			completion_tokens: completionTokens,
			total_tokens: totalTokens,
		} = raw;
		if (
			typeof promptTokens !== 'number' ||
			typeof completionTokens !== 'number' ||
			typeof totalTokens !== 'number'
		) {
			return undefined;
		}
		return {
			promptTokens,
			completionTokens,
			totalTokens,
			cachedTokens: raw.prompt_tokens_details?.cached_tokens ?? 0,
		};
	}

	private async toApiError(response: Response): Promise<ApiError> {
		let detail = '';
		try {
			detail = (await response.text()).slice(0, 500);
		} catch {
			// The status code is still meaningful without the body.
		}
		const message = detail
			? `DeepSeek API error (${response.status}): ${detail}`
			: `DeepSeek API error (${response.status}) ${response.statusText}`.trim();
		return new ApiError(message, response.status);
	}
}
