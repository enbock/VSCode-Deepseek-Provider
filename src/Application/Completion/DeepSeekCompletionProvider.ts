import * as vscode from 'vscode';
import { ChatClient } from '../../Core/Chat/ChatClient';
import { Configuration } from '../../Core/Configuration/Configuration';
import { Logger } from '../../Core/Logging/Logger';

/**
 * Maximum length of the text windows sent to the model. They keep requests
 * small and fast for an interaction that fires on every typing pause.
 */
const MAX_PREFIX_CHARS = 8_000;
const MAX_SUFFIX_CHARS = 2_000;

/**
 * The completion prompt must be unambiguous about starting at the cursor,
 * otherwise the model tends to repeat the last line it was shown.
 */
const SYSTEM_PROMPT = [
	'You are an AI code completion engine.',
	'Continue the code exactly at the cursor position.',
	'Return only the text to insert: no explanations, no markdown fences, no repetition of code that already exists before the cursor.',
].join(' ');

export class DeepSeekCompletionProvider implements vscode.InlineCompletionItemProvider {
	constructor(
		private readonly chatClient: ChatClient,
		private readonly configuration: Configuration,
		private readonly logger: Logger,
	) {}

	async provideInlineCompletionItems(
		document: vscode.TextDocument,
		position: vscode.Position,
		_context: vscode.InlineCompletionContext,
		token: vscode.CancellationToken,
	): Promise<vscode.InlineCompletionItem[] | undefined> {
		if (!this.configuration.isCompletionEnabled()) {
			return undefined;
		}

		const prefix = this.getPrefix(document, position);
		const suffix = this.getSuffix(document, position);
		if (prefix.trim().length === 0 && suffix.trim().length === 0) {
			return undefined;
		}

		const completion = await this.requestCompletion(document, prefix, suffix, token);
		if (!completion) {
			return undefined;
		}

		// Insert at the cursor: the prompt asks for a continuation of `prefix`,
		// so the generated text must not include what the user already typed.
		const range = new vscode.Range(position, position);
		return [new vscode.InlineCompletionItem(completion, range)];
	}

	private async requestCompletion(
		document: vscode.TextDocument,
		prefix: string,
		suffix: string,
		token: vscode.CancellationToken,
	): Promise<string | undefined> {
		const abortController = new AbortController();
		const cancellationListener = token.onCancellationRequested(() => abortController.abort());

		try {
			const raw = await this.chatClient.complete(
				{
					model: this.configuration.getCompletionModel(),
					messages: [
						{ role: 'system', content: SYSTEM_PROMPT },
						{ role: 'user', content: this.buildUserPrompt(document, prefix, suffix) },
					],
					temperature: this.configuration.getCompletionTemperature(),
					maxTokens: this.configuration.getCompletionMaxTokens(),
				},
				abortController.signal,
			);

			const completion = stripPrefixOverlap(prefix, cleanCompletion(raw));
			return completion.length > 0 ? completion : undefined;
		} catch (error) {
			// Inline completions are best-effort: a failed or cancelled request
			// must never surface an error notification while typing.
			if (!abortController.signal.aborted) {
				this.logger.debug(`DeepSeek completion request failed: ${String(error)}`);
			}
			return undefined;
		} finally {
			cancellationListener.dispose();
		}
	}

	private buildUserPrompt(document: vscode.TextDocument, prefix: string, suffix: string): string {
		return [
			`File language: ${document.languageId}.`,
			'',
			'<before-cursor>',
			prefix,
			'</before-cursor>',
			'',
			'<after-cursor>',
			suffix,
			'</after-cursor>',
			'',
			'Complete the code at the cursor. Output only the continuation.',
		].join('\n');
	}

	private getPrefix(document: vscode.TextDocument, position: vscode.Position): string {
		const startLine = Math.max(0, position.line - 300);
		const text = document.getText(new vscode.Range(new vscode.Position(startLine, 0), position));
		return text.length > MAX_PREFIX_CHARS ? text.slice(-MAX_PREFIX_CHARS) : text;
	}

	private getSuffix(document: vscode.TextDocument, position: vscode.Position): string {
		if (document.lineCount === 0 || position.line >= document.lineCount) {
			return '';
		}
		const endLine = Math.min(document.lineCount - 1, position.line + 100);
		const end = new vscode.Position(endLine, document.lineAt(endLine).text.length);
		const text = document.getText(new vscode.Range(position, end));
		return text.length > MAX_SUFFIX_CHARS ? text.slice(0, MAX_SUFFIX_CHARS) : text;
	}
}

/** Strips markdown fences and surrounding whitespace from a model answer. */
function cleanCompletion(raw: string): string {
	let text = raw.trim();

	const openingFence = text.match(/^```[^\n]*\n?/);
	if (openingFence) {
		text = text.slice(openingFence[0].length);
	}
	const closingFence = text.match(/\n?```\s*$/);
	if (closingFence) {
		text = text.slice(0, text.length - closingFence[0].length);
	}

	return text.trim();
}

/**
 * The completion is rendered as ghost text starting exactly at the cursor, but
 * models occasionally echo back a trailing chunk of the prefix. Strip the
 * longest such overlap (at least four characters) so the accepted result is
 * not duplicated.
 */
function stripPrefixOverlap(prefix: string, completion: string): string {
	const max = Math.min(prefix.length, completion.length, 40);
	for (let length = max; length >= 4; length--) {
		if (prefix.endsWith(completion.slice(0, length))) {
			return completion.slice(length);
		}
	}
	return completion;
}
