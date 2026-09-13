export interface Logger {
	info(message: string): void;
	warn(message: string, error?: unknown): void;
	error(message: string, error?: unknown): void;
	debug(message: string): void;
}
