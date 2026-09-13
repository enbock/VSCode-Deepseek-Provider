/**
 * Port for logging. Kept intentionally small so that any concrete sink
 * (output channel, console, file) can satisfy it.
 */
export interface ILogger {
	info(message: string): void;
	warn(message: string): void;
	error(message: string, error?: unknown): void;
	debug(message: string): void;
}
