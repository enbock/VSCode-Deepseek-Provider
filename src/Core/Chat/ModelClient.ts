import { ApiError } from './ApiError';
import { ConfigurationError } from '../Configuration/ConfigurationError';

/**
 * A model as reported by the API's model-listing endpoint. DeepSeek only
 * guarantees an `id` here; everything else (names, token limits, capabilities)
 * comes from the local catalog.
 */
export interface RemoteModel {
	readonly id: string;
}

export interface ModelClient {
	/**
	 * Lists the models the API currently exposes. The chat provider treats this
	 * as the source of truth and falls back to the built-in catalog when the
	 * API is unreachable or returns an empty list.
	 */
	listModels(
		signal: AbortSignal,
	): ReturnOrThrowError<
		Promise<readonly RemoteModel[]>,
		ConfigurationError | ApiError | DOMException
	>;
}
