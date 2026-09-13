/**
 * Raised when the extension is not configured correctly (e.g. missing API key).
 */
export class ConfigurationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ConfigurationError';
	}
}

/**
 * Raised when the remote API returns an error status or an unparseable payload.
 */
export class ApiError extends Error {
	readonly statusCode?: number;

	constructor(message: string, statusCode?: number) {
		super(message);
		this.name = 'ApiError';
		this.statusCode = statusCode;
	}
}
