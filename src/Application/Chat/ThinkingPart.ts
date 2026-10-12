import * as vscode from 'vscode';

/**
 * The shape VS Code uses for a chain-of-thought part. `LanguageModelThinkingPart`
 * is only declared by the proposed `languageModelThinkingPart` API, so it is not
 * part of the stable `@types/vscode` surface, but the extension host hands the
 * instances over anyway (the agent host converts replayed reasoning into them).
 */
export interface ThinkingPart {
	readonly value: string | string[];
}

export type ThinkingPartConstructor = new (
	value: string | string[],
	id?: string,
	metadata?: Record<string, unknown>,
) => ThinkingPart;

/**
 * Returns the class to build a thinking part with, or `null` when the running
 * client does not expose it. Probing instead of importing keeps the extension
 * working on clients that only know the stable API, and a client that refuses
 * proposed APIs when they are read falls back the same way.
 */
export function getThinkingPartConstructor(): ThinkingPartConstructor | null {
	try {
		const candidate = (vscode as unknown as { LanguageModelThinkingPart?: unknown })
			.LanguageModelThinkingPart;

		return typeof candidate === 'function' ? (candidate as ThinkingPartConstructor) : null;
	} catch {
		return null;
	}
}

/**
 * Returns the chain of thought carried by `part`, or `null` when the part holds
 * no reasoning. Empty reasoning counts as none: an empty string tells the caller
 * nothing and must not be mistaken for replayed thinking.
 */
export function readThinkingPart(part: unknown): string | null {
	if (!isThinkingPart(part)) {
		return null;
	}

	const text = Array.isArray(part.value) ? part.value.join('') : part.value;
	return text.length > 0 ? text : null;
}

function isThinkingPart(part: unknown): part is ThinkingPart {
	if (typeof part !== 'object' || part === null) {
		return false;
	}

	// Without the exported class a part is still recognised by its constructor
	// name: the extension host hands the instances over even when the proposal is
	// not enabled, and that name survives the extension host bundle.
	const partClass = getThinkingPartConstructor();
	const looksLikeThinking = partClass
		? part instanceof partClass
		: (part as { constructor?: { name?: string } }).constructor?.name ===
			'LanguageModelThinkingPart';

	if (!looksLikeThinking) {
		return false;
	}

	const value = (part as { value?: unknown }).value;
	return typeof value === 'string' || Array.isArray(value);
}
