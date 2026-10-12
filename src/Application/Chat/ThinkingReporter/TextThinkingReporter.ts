import * as vscode from 'vscode';
import { THINKING_LABEL, THINKING_SEPARATOR } from '../MessageConverter';
import { ThinkingReporter } from './ThinkingReporter';

/**
 * Reports the chain of thought as a fenced text block. This is the fallback for
 * clients that do not take native thinking parts: the block is readable markdown
 * and the provider recovers the reasoning from it when the client echoes the
 * turn back.
 */
export class TextThinkingReporter implements ThinkingReporter {
	private started = false;
	private closed = false;

	constructor(private readonly progress: vscode.Progress<vscode.LanguageModelResponsePart>) {}

	reportReasoning(reasoning: string): void {
		if (!this.started) {
			this.started = true;
			this.progress.report(new vscode.LanguageModelTextPart(THINKING_LABEL));
		}
		this.progress.report(new vscode.LanguageModelTextPart(reasoning));
	}

	closeReasoning(): void {
		if (this.started && !this.closed) {
			this.progress.report(new vscode.LanguageModelTextPart(THINKING_SEPARATOR));
		}
		this.closed = true;
	}
}
