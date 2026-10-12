import * as vscode from 'vscode';
import { Logger } from '../../../Core/Logging/Logger';
import { getThinkingPartConstructor } from '../ThinkingPart';
import { NativeThinkingReporter } from './NativeThinkingReporter';
import { TextThinkingReporter } from './TextThinkingReporter';
import { ThinkingReporter } from './ThinkingReporter';

/**
 * Creates the reporter that fits the running client. Native thinking parts come
 * from the `languageModelThinkingPart` proposal, which older clients do not know
 * at all, so the capability is probed instead of assumed and the fenced text
 * block keeps the reasoning visible (and replayable) everywhere else.
 */
export class ThinkingReporterFactory {
	private strategyReported = false;

	constructor(private readonly logger: Logger) {}

	create(progress: vscode.Progress<vscode.LanguageModelResponsePart>): ThinkingReporter {
		const thinkingPart = getThinkingPartConstructor();
		this.reportStrategy(thinkingPart !== null);

		return thinkingPart
			? new NativeThinkingReporter(progress, thinkingPart)
			: new TextThinkingReporter(progress);
	}

	/**
	 * Reported once per session: it explains where the thinking text is shown and
	 * in which form the next turn gets the reasoning back.
	 */
	private reportStrategy(native: boolean): void {
		if (this.strategyReported) {
			return;
		}
		this.strategyReported = true;
		this.logger.debug(
			native
				? 'Reporting reasoning as native thinking parts.'
				: 'Reporting reasoning as a fenced text block; the proposal languageModelThinkingPart is not available.',
		);
	}
}
