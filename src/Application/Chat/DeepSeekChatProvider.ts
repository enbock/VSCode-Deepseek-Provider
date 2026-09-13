import * as vscode from 'vscode';
import { ChatClient } from '../../Core/Chat/ChatClient';
import { Configuration } from '../../Core/Configuration/Configuration';
import { Logger } from '../../Core/Logging/Logger';
import { ModelCatalog } from '../../Core/Chat/ModelCatalog';
import { TokenEstimator } from '../../Core/Chat/TokenEstimator';
import { ModelInfo } from '../../Core/Chat/ModelInfo';
import { ChatRequest, ToolChoiceMode, ToolDefinition } from '../../Core/Chat/ChatRequest';
import { ChatProviderError } from './ChatProviderError';
import { parseToolInput, toChatMessages } from './MessageConverter';

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

		let total = 0;
		for (const rawPart of text.content) {
			const part = rawPart as vscode.LanguageModelTextPart | vscode.LanguageModelDataPart;
			if (part instanceof vscode.LanguageModelTextPart) {
				total += this.tokenEstimator.estimate(part.value);
			}
		}
		return total;
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
