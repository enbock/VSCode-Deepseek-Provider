import * as vscode from 'vscode';
import { IChatClient } from '../../Core/Ports/IChatClient';
import { IConfiguration } from '../../Core/Ports/IConfiguration';
import { ILogger } from '../../Core/Ports/ILogger';
import { ModelCatalog } from '../../Core/Services/ModelCatalog';
import { TokenEstimator } from '../../Core/Services/TokenEstimator';
import { ModelInfo } from '../../Core/Models/ModelInfo';
import { ChatRequest, ToolChoiceMode, ToolDefinition } from '../../Core/Models/ChatRequest';
import { parseToolInput, toChatMessages } from './MessageConverter';

/**
 * Bridges the VS Code language-model API to the DeepSeek chat client.
 * This is the composition/controlling layer: it converts VS Code types into
 * core domain types, invokes the infrastructure client, and streams results
 * back as VS Code response parts.
 */
export class DeepSeekChatProvider
	implements vscode.LanguageModelChatProvider<vscode.LanguageModelChatInformation>
{
	constructor(
		private readonly chatClient: IChatClient,
		private readonly configuration: IConfiguration,
		private readonly modelCatalog: ModelCatalog,
		private readonly tokenEstimator: TokenEstimator,
		private readonly logger: ILogger,
	) {}

	async provideLanguageModelChatInformation(
		_options: vscode.PrepareLanguageModelChatModelOptions,
		_token: vscode.CancellationToken,
	): Promise<vscode.LanguageModelChatInformation[]> {
		return this.modelCatalog.getModels().map((model) => this.toVscodeInformation(model));
	}

	async provideLanguageModelChatResponse(
		model: vscode.LanguageModelChatInformation,
		messages: readonly vscode.LanguageModelChatRequestMessage[],
		options: vscode.ProvideLanguageModelChatResponseOptions,
		progress: vscode.Progress<vscode.LanguageModelResponsePart>,
		token: vscode.CancellationToken,
	): Promise<void> {
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
			this.logger.error('DeepSeek chat request failed', error);
			throw error;
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
