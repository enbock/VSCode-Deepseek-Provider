import * as path from 'path';
import * as vscode from 'vscode';
import { ChatClient } from '../../Core/Chat/ChatClient';
import { Configuration } from '../../Core/Configuration/Configuration';
import { Logger } from '../../Core/Logging/Logger';

/** Keep the diff small enough that prompt + completion fit comfortably. */
const MAX_DIFF_CHARS = 50_000;

const SYSTEM_PROMPT = [
	'You are an expert at writing git commit messages.',
	'Generate a concise, single-line commit message in Conventional Commits format (type(scope): subject), using the imperative mood.',
	'Output only the commit message: no markdown, no code fences, no explanation.',
].join(' ');

/** Minimal surface of the built-in `vscode.git` extension API we rely on. */
interface GitRepository {
	readonly rootUri: vscode.Uri;
	readonly inputBox: vscode.SourceControlInputBox;
	diffCached(): Promise<string>;
	diffWithHEAD(): Promise<string>;
}

interface GitApi {
	readonly repositories: GitRepository[];
}

interface GitExtension {
	getAPI(version: 1): GitApi;
}

export class GenerateCommitMessageCommand {
	constructor(
		private readonly chatClient: ChatClient,
		private readonly configuration: Configuration,
		private readonly logger: Logger,
	) {}

	async run(): Promise<void> {
		const repository = await this.findRepository();
		if (!repository) {
			void vscode.window.showWarningMessage('DeepSeek: no Git repository found in the workspace.');
			return;
		}

		const diff = await this.getDiff(repository);
		if (!diff.trim()) {
			void vscode.window.showWarningMessage('DeepSeek: no staged or unstaged changes to describe.');
			return;
		}

		try {
			const message = await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: 'DeepSeek: generating commit message…',
				},
				async (_progress, token) => this.generate(diff, token),
			);

			if (!message) {
				void vscode.window.showWarningMessage('DeepSeek: the model returned an empty commit message.');
				return;
			}

			repository.inputBox.value = message;
		} catch (error) {
			if (error instanceof vscode.CancellationError) {
				return;
			}
			this.logger.error('DeepSeek commit message generation failed', error);
			void vscode.window.showErrorMessage(
				`DeepSeek: could not generate a commit message. ${error instanceof Error ? error.message : ''}`,
			);
		}
	}

	private async generate(diff: string, token: vscode.CancellationToken): Promise<string> {
		const abortController = new AbortController();
		const cancellationListener = token.onCancellationRequested(() => abortController.abort());

		try {
			const truncated =
				diff.length > MAX_DIFF_CHARS
					? `${diff.slice(0, MAX_DIFF_CHARS)}\n… (diff truncated)`
					: diff;

			const raw = await this.chatClient.complete(
				{
					model: this.configuration.getDefaultModel(),
					messages: [
						{ role: 'system', content: SYSTEM_PROMPT },
						{ role: 'user', content: `Write a commit message for the following diff:\n\n<diff>\n${truncated}\n</diff>` },
					],
					temperature: this.configuration.getTemperature(),
					maxTokens: 256,
				},
				abortController.signal,
			);

			return cleanCommitMessage(raw);
		} catch (error) {
			if (abortController.signal.aborted) {
				throw new vscode.CancellationError();
			}
			throw error;
		} finally {
			cancellationListener.dispose();
		}
	}

	private async getDiff(repository: GitRepository): Promise<string> {
		const staged = await repository.diffCached();
		if (staged.trim()) {
			return staged;
		}
		// Nothing is staged yet; describe the working-tree changes instead so
		// the command is still useful before `git add`.
		return repository.diffWithHEAD();
	}

	private async findRepository(): Promise<GitRepository | undefined> {
		const extension = vscode.extensions.getExtension<GitExtension>('vscode.git');
		if (!extension) {
			return undefined;
		}
		if (!extension.isActive) {
			try {
				await extension.activate();
			} catch {
				return undefined;
			}
		}

		const repositories = extension.exports?.getAPI(1)?.repositories ?? [];
		if (repositories.length === 0) {
			return undefined;
		}

		const activeDocument = vscode.window.activeTextEditor?.document;
		if (activeDocument) {
			const activePath = activeDocument.uri.fsPath;
			const match = repositories.find((repository) => this.isUnderRoot(activePath, repository.rootUri.fsPath));
			if (match) {
				return match;
			}
		}

		return repositories[0];
	}

	private isUnderRoot(filePath: string, root: string): boolean {
		return filePath === root || filePath.startsWith(root.endsWith(path.sep) ? root : `${root}${path.sep}`);
	}
}

/** Reduces the model answer to the subject line, dropping fences and blanks. */
function cleanCommitMessage(raw: string): string {
	let text = raw.trim();

	const openingFence = text.match(/^```[^\n]*\n?/);
	if (openingFence) {
		text = text.slice(openingFence[0].length);
	}
	const closingFence = text.match(/\n?```\s*$/);
	if (closingFence) {
		text = text.slice(0, text.length - closingFence[0].length);
	}

	const firstLine = text
		.split(/\r?\n/)
		.map((line) => line.trim())
		.find((line) => line.length > 0);

	return firstLine ?? '';
}
