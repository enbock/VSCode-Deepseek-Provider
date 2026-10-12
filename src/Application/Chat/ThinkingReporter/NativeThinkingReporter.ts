import * as vscode from 'vscode';
import { ThinkingPartConstructor } from '../ThinkingPart';
import { ThinkingReporter } from './ThinkingReporter';

/**
 * Reports the chain of thought as native thinking parts. The chat view renders
 * them in its own collapsible section and hands them back on the next turn,
 * which is what lets the reasoning survive a long agent run.
 */
export class NativeThinkingReporter implements ThinkingReporter {
	constructor(
		private readonly progress: vscode.Progress<vscode.LanguageModelResponsePart>,
		private readonly thinkingPart: ThinkingPartConstructor,
	) {}

	reportReasoning(reasoning: string): void {
		// The response part union of the stable API predates thinking parts, but the
		// extension host accepts them and turns them into thinking content.
		this.progress.report(
			new this.thinkingPart(reasoning) as unknown as vscode.LanguageModelResponsePart,
		);
	}

	closeReasoning(): void {
		// Thinking parts are delimited by the parts around them, so there is no
		// marker to emit.
	}
}
