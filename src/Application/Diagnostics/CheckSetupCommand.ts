import * as vscode from 'vscode';
import { Configuration } from '../../Core/Configuration/Configuration';

interface SetupCheck {
	readonly label: string;
	readonly ok: boolean;
	readonly detail: string;
}

const GIT_EXTENSION_ID = 'vscode.git';

export class CheckSetupCommand {
	constructor(private readonly configuration: Configuration) {}

	async run(): Promise<void> {
		const checks: SetupCheck[] = [
			await this.checkApiKey(),
			this.checkInlineSuggestions(),
			this.checkCompletionToggle(),
			this.checkCompletionModel(),
			this.checkCopilotState(),
			this.checkGitExtension(),
			this.checkBaseUrl(),
		];

		const okCount = checks.filter((check) => check.ok).length;
		const headline = `DeepSeek setup: ${okCount}/${checks.length} checks passed`;

		const detail = checks.map((check) => this.format(check)).join('\n\n');

		void vscode.window.showInformationMessage(headline, {
			modal: false,
			detail,
		});
	}

	private async checkApiKey(): Promise<SetupCheck> {
		const key = await this.configuration.getApiKey();
		return {
			label: 'DeepSeek API key',
			ok: Boolean(key),
			detail: key
				? 'An API key was found (Secret Storage, DEEPSEEK_API_KEY, or deepseek.apiKey).'
				: 'No API key found. Run "DeepSeek: Configure API Key", or set DEEPSEEK_API_KEY / deepseek.apiKey.',
		};
	}

	private checkInlineSuggestions(): SetupCheck {
		const enabled = vscode.workspace
			.getConfiguration('editor')
			.get<boolean>('inlineSuggest.enabled') ?? true;
		return {
			label: 'Editor inline suggestions',
			ok: enabled,
			detail: enabled
				? 'editor.inlineSuggest.enabled is true.'
				: 'Set "editor.inlineSuggest.enabled": true, otherwise ghost text is never shown.',
		};
	}

	private checkCompletionToggle(): SetupCheck {
		const enabled = this.configuration.isCompletionEnabled();
		return {
			label: 'DeepSeek completions',
			ok: enabled,
			detail: enabled
				? 'deepseek.enableCompletions is true.'
				: 'Set "deepseek.enableCompletions": true to enable DeepSeek ghost text.',
		};
	}

	private checkCompletionModel(): SetupCheck {
		const model = this.configuration.getCompletionModel();
		return {
			label: 'Completion model',
			ok: true,
			detail: `Completions use "${model}" (deepseek.completionModel).`,
		};
	}

	private checkCopilotState(): SetupCheck {
		const value = vscode.workspace.getConfiguration('github.copilot').get<boolean>('enable');
		const copilotEnabled = value !== false;
		return {
			label: 'GitHub Copilot',
			ok: true,
			detail: copilotEnabled
				? 'Copilot is enabled and may supply its own completions (requires GitHub sign-in). DeepSeek completions do not require sign-in. To test DeepSeek alone, set "github.copilot.enable": false.'
				: 'Copilot is disabled; only DeepSeek completions are active.',
		};
	}

	private checkGitExtension(): SetupCheck {
		const extension = vscode.extensions.getExtension(GIT_EXTENSION_ID);
		const gitEnabled = vscode.workspace.getConfiguration('git').get<boolean>('enabled') ?? true;
		const ok = Boolean(extension) && gitEnabled;
		return {
			label: 'Git (for commit messages)',
			ok,
			detail: ok
				? 'The built-in Git extension is available for "DeepSeek: Generate Commit Message".'
				: 'The built-in Git extension is unavailable or "git.enabled" is false, so commit-message generation will not work.',
		};
	}

	private checkBaseUrl(): SetupCheck {
		return {
			label: 'Base URL',
			ok: true,
			detail: `Requests go to "${this.configuration.getBaseUrl()}" (deepseek.baseUrl).`,
		};
	}

	private format(check: SetupCheck): string {
		const marker = check.ok ? '✓' : '✗';
		return `${marker} ${check.label}\n${check.detail}`;
	}
}
