/**
 * Port for writing the API key to secure storage.
 */
export interface IApiKeyStore {
	setApiKey(key: string): Promise<void>;
	deleteApiKey(): Promise<void>;
}
