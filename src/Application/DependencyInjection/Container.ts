import * as vscode from 'vscode';
import { DeepSeekHttpClient } from '../../Infrastructure/Api/DeepSeekHttpClient';
import { VscodeConfiguration } from '../../Infrastructure/Configuration/VscodeConfiguration';
import { OutputChannelLogger } from '../../Infrastructure/Logging/OutputChannelLogger';
import { ModelCatalog } from '../../Core/Services/ModelCatalog';
import { TokenEstimator } from '../../Core/Services/TokenEstimator';
import { DeepSeekChatProvider } from '../UseCases/DeepSeekChatProvider';
import { ManageCommand } from '../UseCases/ManageCommand';

export interface Container {
	readonly provider: DeepSeekChatProvider;
	readonly manageCommand: ManageCommand;
	dispose(): void;
}

/**
 * Manual composition root. Wires the core services to their infrastructure
 * adapters and exposes the application-level use cases.
 */
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
