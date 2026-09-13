export interface ApiKeyStore {
	setApiKey(key: string): Promise<void>;
	deleteApiKey(): Promise<void>;
}
