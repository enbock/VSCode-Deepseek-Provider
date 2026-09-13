import * as vscode from 'vscode';
import { Configuration } from '../../Core/Configuration/Configuration';
import { ApiKeyStore } from '../../Core/Configuration/ApiKeyStore';

const SECRET_KEY = 'deepseek.apiKey';

export class VscodeConfiguration implements Configuration, ApiKeyStore {
	constructor(private readonly secrets: vscode.SecretStorage) {}

	async getApiKey(): Promise<string | undefined> {
		const stored = await this.secrets.get(SECRET_KEY);
		if (stored) {
			return stored;
		}
		const configured = this.config().get<string>('apiKey');
		return configured || undefined;
	}

	async setApiKey(key: string): Promise<void> {
		await this.secrets.store(SECRET_KEY, key);
	}

	async deleteApiKey(): Promise<void> {
		await this.secrets.delete(SECRET_KEY);
	}

	getBaseUrl(): string {
		const configured = this.config().get<string>('baseUrl');
		return (configured || 'https://api.deepseek.com').replace(/\/+$/, '');
	}

	getDefaultModel(): string {
		return this.config().get<string>('defaultModel') || 'deepseek-flash';
	}

	getTemperature(): number {
		return this.config().get<number>('temperature') ?? 0.7;
	}

	getMaxOutputTokens(): number {
		return this.config().get<number>('maxOutputTokens') ?? 8192;
	}

	getSystemPrompt(): string | undefined {
		const prompt = this.config().get<string>('systemPrompt');
		return prompt || undefined;
	}

	private config(): vscode.WorkspaceConfiguration {
		return vscode.workspace.getConfiguration('deepseek');
	}
}
