import * as vscode from 'vscode';
import { createContainer } from './Application/DependencyInjection/Container';

export function activate(context: vscode.ExtensionContext): void {
	const container = createContainer(context);

	context.subscriptions.push(
		vscode.lm.registerLanguageModelChatProvider('deepseek', container.provider),
		vscode.commands.registerCommand('deepseek.manage', () => container.manageCommand.run()),
		{ dispose: () => container.dispose() },
	);
}

export function deactivate(): void {
	// All resources are released through the extension context subscriptions.
}
