import * as vscode from 'vscode';
import { ApiKeyStore } from '../../Core/Configuration/ApiKeyStore';
import { ModelCatalog } from '../../Core/Chat/ModelCatalog';

interface CommandOption {
	label: string;
	value: 'set' | 'clear' | 'model';
}

export class ManageCommand {
	constructor(
		private readonly apiKeyStore: ApiKeyStore,
		private readonly modelCatalog: ModelCatalog,
	) {}

	async run(): Promise<void> {
		const choice = await vscode.window.showQuickPick<CommandOption>(
			[
				{ label: '$(key) Set API Key', value: 'set' },
				{ label: '$(trash) Clear API Key', value: 'clear' },
				{ label: '$(list-selection) Select Default Model', value: 'model' },
			],
			{ placeHolder: 'DeepSeek configuration' },
		);
		if (!choice) {
			return;
		}

		switch (choice.value) {
			case 'set':
				await this.setApiKey();
				break;
			case 'clear':
				await this.clearApiKey();
				break;
			case 'model':
				await this.selectDefaultModel();
				break;
		}
	}

	private async setApiKey(): Promise<void> {
		const key = await vscode.window.showInputBox({
			title: 'DeepSeek API Key',
			prompt: 'Paste your DeepSeek API key. It is stored in VS Code Secret Storage.',
			password: true,
			ignoreFocusOut: true,
		});
		if (key === undefined) {
			return;
		}
		if (key.trim().length === 0) {
			void vscode.window.showWarningMessage('DeepSeek: the API key was empty; nothing was stored.');
			return;
		}
		await this.apiKeyStore.setApiKey(key.trim());
		void vscode.window.showInformationMessage('DeepSeek: API key saved securely.');
	}

	private async clearApiKey(): Promise<void> {
		await this.apiKeyStore.deleteApiKey();
		void vscode.window.showInformationMessage('DeepSeek: API key removed from secure storage.');
	}

	private async selectDefaultModel(): Promise<void> {
		const picked = await vscode.window.showQuickPick(
			this.modelCatalog.getModels().map((model) => ({
				label: model.name,
				description: model.id,
				value: model.id,
			})),
			{ placeHolder: 'Choose the default DeepSeek model' },
		);
		if (!picked) {
			return;
		}
		await vscode.workspace
			.getConfiguration('deepseek')
			.update('defaultModel', picked.value, vscode.ConfigurationTarget.Global);
		void vscode.window.showInformationMessage(`DeepSeek: default model set to ${picked.value}.`);
	}
}
