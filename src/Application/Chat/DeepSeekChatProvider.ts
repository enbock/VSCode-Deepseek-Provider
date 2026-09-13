import * as vscode from 'vscode';
import { ChatClient } from '../../Core/Chat/ChatClient';
import { Configuration } from '../../Core/Configuration/Configuration';
import { Logger } from '../../Core/Logging/Logger';
import { ModelCatalog } from '../../Core/Chat/ModelCatalog';
import { TokenEstimator } from '../../Core/Chat/TokenEstimator';
import { ModelInfo } from '../../Core/Chat/ModelInfo';
import { ChatRequest, ToolChoiceMode, ToolDefinition } from '../../Core/Chat/ChatRequest';
import { TokenUsage } from '../../Core/Chat/ChatStreamChunk';
import { ChatProviderError } from './ChatProviderError';
import { parseToolInput, stringifyToolInput, toChatMessages } from './MessageConverter';

/**
 * MIME type of the data part the chat view reads to fill its context-usage
 * indicator and to feed prompt-token accounting. It is the same contract the
 * built-in BYOK providers use.
 */
const USAGE_DATA_PART_MIME = 'usage';

export class DeepSeekChatProvider
	implements vscode.LanguageModelChatProvider<vscode.LanguageModelChatInformation>
{
	constructor(
		private readonly chatClient: ChatClient,
		private readonly configuration: Configuration,
		private readonly modelCatalog: ModelCatalog,
		private readonly tokenEstimator: TokenEstimator,
		private readonly logger: Logger,
	) {}

	async provideLanguageModelChatInformation(
		_options: vscode.PrepareLanguageModelChatModelOptions,
		_token: vscode.CancellationToken,
	): Promise<vscode.LanguageModelChatInformation[]> {
		return this.orderedModels().map((model) => this.toVscodeInformation(model));
	}

	/**
	 * VS Code preselects the first entry when the user has no stored choice, so
	 * the model configured via `deepseek.defaultModel` is listed first.
	 */
	private orderedModels(): readonly ModelInfo[] {
		const models = this.modelCatalog.getModels();
		const preferred = this.modelCatalog.findById(this.configuration.getDefaultModel());
		if (!preferred) {
			return models;
		}
		return [preferred, ...models.filter((model) => model.id !== preferred.id)];
	}

	async provideLanguageModelChatResponse(
		model: vscode.LanguageModelChatInformation,
		messages: readonly vscode.LanguageModelChatRequestMessage[],
		options: vscode.ProvideLanguageModelChatResponseOptions,
		progress: vscode.Progress<vscode.LanguageModelResponsePart>,
		token: vscode.CancellationToken,
	): ReturnOrThrowError<Promise<void>, vscode.CancellationError | ChatProviderError> {
		const request: ChatRequest = {
			model: model.id,
			messages: toChatMessages(messages, this.configuration.getSystemPrompt()),
			temperature: this.configuration.getTemperature(),
			maxTokens: Math.min(this.configuration.getMaxOutputTokens(), model.maxOutputTokens),
			tools: this.toToolDefinitions(options.tools),
			toolChoice: this.toToolChoice(options.toolMode),
		};

		const abortController = new AbortController();
		const cancellationListener = token.onCancellationRequested(() => abortController.abort());

		try {
			for await (const chunk of this.chatClient.streamChat(request, abortController.signal)) {
				if (chunk.text) {
					progress.report(new vscode.LanguageModelTextPart(chunk.text));
				}
				for (const call of chunk.toolCalls ?? []) {
					progress.report(
						new vscode.LanguageModelToolCallPart(call.id, call.name, parseToolInput(call.arguments)),
					);
				}
				if (chunk.usage) {
					progress.report(this.toUsageReport(chunk.usage));
				}
			}
		} catch (error) {
			if (abortController.signal.aborted) {
				throw new vscode.CancellationError();
			}
			this.logger.error('DeepSeek chat request failed', error);
			throw new ChatProviderError('DeepSeek chat request failed.', error);
		} finally {
			cancellationListener.dispose();
		}
	}

	async provideTokenCount(
		_model: vscode.LanguageModelChatInformation,
		text: string | vscode.LanguageModelChatRequestMessage,
		_token: vscode.CancellationToken,
	): Promise<number> {
		if (typeof text === 'string') {
			return this.tokenEstimator.estimate(text);
		}

		return this.countContentTokens(text.content);
	}

	/**
	 * VS Code sizes the prompt and decides when the conversation has grown too
	 * large to keep from these numbers, so every part that reaches the API has to
	 * be counted - tool results in particular are usually what fills the window.
	 */
	private countContentTokens(rawParts: readonly unknown[]): number {
		let total = 0;
		for (const rawPart of rawParts) {
			total += this.countPartTokens(rawPart);
		}
		return total;
	}

	private countPartTokens(rawPart: unknown): number {
		if (rawPart instanceof vscode.LanguageModelTextPart) {
			return this.tokenEstimator.estimate(rawPart.value);
		}

		if (rawPart instanceof vscode.LanguageModelToolCallPart) {
			return (
				this.tokenEstimator.estimate(rawPart.name) +
				this.tokenEstimator.estimate(stringifyToolInput(rawPart.input))
			);
		}

		if (rawPart instanceof vscode.LanguageModelToolResultPart) {
			return this.countContentTokens(rawPart.content);
		}

		if (rawPart instanceof vscode.LanguageModelDataPart) {
			return this.countDataTokens(rawPart);
		}

		return 0;
	}

	/**
	 * None of the catalog models accept images, so binary parts only ever appear
	 * in tool results; they are approximated rather than decoded.
	 */
	private countDataTokens(part: vscode.LanguageModelDataPart): number {
		if (part.mimeType.startsWith('image/')) {
			return Math.ceil(part.data.byteLength / 750);
		}
		return this.tokenEstimator.estimate(new TextDecoder().decode(part.data));
	}

	/**
	 * Reporting the API's token accounting is what lets the chat view show how
	 * full the context window is; without it the indicator stays hidden.
	 */
	private toUsageReport(usage: TokenUsage): vscode.LanguageModelDataPart {
		return vscode.LanguageModelDataPart.json(
			{
				prompt_tokens: usage.promptTokens,
				completion_tokens: usage.completionTokens,
				total_tokens: usage.totalTokens,
				prompt_tokens_details: { cached_tokens: usage.cachedTokens },
			},
			USAGE_DATA_PART_MIME,
		);
	}

	private toVscodeInformation(model: ModelInfo): vscode.LanguageModelChatInformation {
		return {
			id: model.id,
			name: model.name,
			family: model.family,
			version: model.version,
			maxInputTokens: model.maxInputTokens,
			maxOutputTokens: model.maxOutputTokens,
			tooltip: model.tooltip,
			capabilities: {
				toolCalling: model.supportsToolCalling,
				imageInput: model.supportsImageInput,
			},
		};
	}

	private toToolDefinitions(tools?: readonly vscode.LanguageModelChatTool[]): ToolDefinition[] | undefined {
		if (!tools || tools.length === 0) {
			return undefined;
		}
		return tools.map((tool) => ({
			name: tool.name,
			description: tool.description,
			inputSchema: tool.inputSchema,
		}));
	}

	private toToolChoice(mode: vscode.LanguageModelChatToolMode): ToolChoiceMode {
		return mode === vscode.LanguageModelChatToolMode.Required ? 'required' : 'auto';
	}
}
