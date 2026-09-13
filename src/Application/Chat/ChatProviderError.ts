export class ChatProviderError extends Error {
	constructor(message: string, cause?: unknown) {
		super(cause instanceof Error ? `${message} ${cause.message}` : message, { cause });
		this.name = 'ChatProviderError';
	}
}
