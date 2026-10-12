import * as vscode from 'vscode';
import { ChatMessage, ToolCall } from '../../Core/Chat/ChatMessage';
import { readThinkingPart } from './ThinkingPart';

export const THINKING_LABEL = '**Thinking**\n\n';
export const THINKING_SEPARATOR = '\n\n---\n\n';

type ChatPart =
	| vscode.LanguageModelTextPart
	| vscode.LanguageModelToolCallPart
	| vscode.LanguageModelToolResultPart
	| vscode.LanguageModelDataPart;

export function stringifyToolInput(input: object): string {
	try {
		return JSON.stringify(input);
	} catch {
		return '{}';
	}
}

/** Falls back to an empty object so one malformed call cannot break the stream. */
export function parseToolInput(json: string): object {
	try {
		const value: unknown = JSON.parse(json);
		return typeof value === 'object' && value !== null ? (value as object) : {};
	} catch {
		return {};
	}
}

/** Tool results become separate `tool` messages, as the wire format requires. */
export function toChatMessages(
	messages: readonly vscode.LanguageModelChatRequestMessage[],
	systemPrompt?: string,
): ChatMessage[] {
	const result: ChatMessage[] = [];
	// DeepSeek (unlike OpenAI) requires tool-call IDs to be unique across the
	// entire conversation. Defensively dedupe both assistant tool calls and tool
	// results so a replayed or duplicated part can never produce a rejected call.
	const seenToolCallIds = new Set<string>();
	const seenToolResultIds = new Set<string>();

	if (systemPrompt) {
		result.push({ role: 'system', content: systemPrompt });
	}

	for (const message of messages) {
		if (message.role === vscode.LanguageModelChatMessageRole.Assistant) {
			result.push(convertAssistantMessage(message, seenToolCallIds));
		} else {
			convertUserMessage(message, result, seenToolResultIds);
		}
	}

	return result;
}

function convertAssistantMessage(
	message: vscode.LanguageModelChatRequestMessage,
	seenToolCallIds: Set<string>,
): ChatMessage {
	let text = '';
	let replayedReasoning = '';
	const toolCalls: ToolCall[] = [];

	for (const rawPart of message.content) {
		const thinking = readThinkingPart(rawPart);
		if (thinking !== null) {
			replayedReasoning += thinking;
			continue;
		}

		const part = rawPart as ChatPart;
		if (part instanceof vscode.LanguageModelTextPart) {
			text += part.value;
		} else if (part instanceof vscode.LanguageModelToolCallPart) {
			if (seenToolCallIds.has(part.callId)) {
				continue;
			}
			seenToolCallIds.add(part.callId);
			toolCalls.push({
				id: part.callId,
				name: part.name,
				arguments: stringifyToolInput(part.input),
			});
		}
	}

	const { content, reasoning } = splitThinking(text);
	// Reasoning arrives by one of two routes: natively as a thinking part when
	// the agent host replays it, or inside the fenced block the provider streamed
	// for the chat view. DeepSeek concatenates whatever is passed back into the
	// context, so both sources are kept.
	const reasoningContent = [replayedReasoning, reasoning]
		.filter((value): value is string => value !== null && value.length > 0)
		.join('\n\n');

	return {
		role: 'assistant',
		content: content.length > 0 ? content : null,
		// DeepSeek's thinking mode rejects a request carrying `tools` when a
		// replayed assistant turn drops its `reasoning_content`, so the chain of
		// thought is carried back instead of being discarded.
		...(reasoningContent.length > 0 ? { reasoningContent } : {}),
		...(toolCalls.length > 0 ? { toolCalls } : {}),
	};
}

/**
 * Splits the fenced thinking block out of an echoed assistant message. Returns
 * `null` reasoning when no thinking block is present so callers can omit the
 * field rather than send an empty string.
 */
function splitThinking(text: string): { content: string; reasoning: string | null } {
	const start = text.indexOf(THINKING_LABEL);
	if (start < 0) {
		return { content: text, reasoning: null };
	}
	const after = start + THINKING_LABEL.length;
	const sep = text.indexOf(THINKING_SEPARATOR, after);
	if (sep < 0) {
		return { content: '', reasoning: text.slice(after) };
	}
	return {
		content: text.slice(sep + THINKING_SEPARATOR.length),
		reasoning: text.slice(after, sep),
	};
}

function convertUserMessage(
	message: vscode.LanguageModelChatRequestMessage,
	result: ChatMessage[],
	seenToolResultIds: Set<string>,
): void {
	let text = '';

	for (const rawPart of message.content) {
		const part = rawPart as ChatPart;
		if (part instanceof vscode.LanguageModelTextPart) {
			text += part.value;
		} else if (part instanceof vscode.LanguageModelToolResultPart) {
			if (seenToolResultIds.has(part.callId)) {
				continue;
			}
			seenToolResultIds.add(part.callId);
			result.push({
				role: 'tool',
				content: extractToolResultText(part),
				toolCallId: part.callId,
			});
		}
	}

	if (text.length > 0) {
		result.push({ role: 'user', content: text });
	}
}

function extractToolResultText(part: vscode.LanguageModelToolResultPart): string {
	let text = '';
	for (const raw of part.content) {
		const inner = raw as vscode.LanguageModelTextPart | vscode.LanguageModelDataPart;
		if (inner instanceof vscode.LanguageModelTextPart) {
			text += inner.value;
		}
	}
	return text;
}
