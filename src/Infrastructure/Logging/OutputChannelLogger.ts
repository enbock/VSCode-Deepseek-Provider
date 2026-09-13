import * as vscode from 'vscode';
import { Logger } from '../../Core/Logging/Logger';

export class OutputChannelLogger implements Logger {
	private readonly channel: vscode.OutputChannel;

	constructor() {
		this.channel = vscode.window.createOutputChannel('DeepSeek Provider');
	}

	info(message: string): void {
		this.channel.appendLine(`[info] ${message}`);
	}

	warn(message: string): void {
		this.channel.appendLine(`[warn] ${message}`);
	}

	error(message: string, error?: unknown): void {
		const detail = error instanceof Error ? ` ${error.message}` : '';
		this.channel.appendLine(`[error] ${message}${detail}`);
	}

	debug(message: string): void {
		this.channel.appendLine(`[debug] ${message}`);
	}

	dispose(): void {
		this.channel.dispose();
	}
}
