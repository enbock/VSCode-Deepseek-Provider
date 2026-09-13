import * as vscode from 'vscode';
import { DeepSeekHttpClient } from '../../Infrastructure/Chat/DeepSeekHttpClient';
import { VscodeConfiguration } from '../../Infrastructure/Configuration/VscodeConfiguration';
import { OutputChannelLogger } from '../../Infrastructure/Logging/OutputChannelLogger';
import { ModelCatalog } from '../../Core/Chat/ModelCatalog';
import { TokenEstimator } from '../../Core/Chat/TokenEstimator';
import { DeepSeekChatProvider } from '../Chat/DeepSeekChatProvider';
import { ManageCommand } from '../Configuration/ManageCommand';

export interface Container {
	readonly provider: DeepSeekChatProvider;
	readonly manageCommand: ManageCommand;
	dispose(): void;
}

export function createContainer(context: vscode.ExtensionContext): Container {
	const logger = new OutputChannelLogger();
	const configuration = new VscodeConfiguration(context.secrets);
	const chatClient = new DeepSeekHttpClient(configuration, logger);
	const modelCatalog = new ModelCatalog();
	const tokenEstimator = new TokenEstimator();

	const provider = new DeepSeekChatProvider(
		chatClient,
		configuration,
		modelCatalog,
		tokenEstimator,
		logger,
	);
	const manageCommand = new ManageCommand(configuration, modelCatalog);

	return {
		provider,
		manageCommand,
		dispose() {
			logger.dispose();
		},
	};
}
