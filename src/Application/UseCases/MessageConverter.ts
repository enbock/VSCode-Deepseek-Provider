import * as vscode from 'vscode';
import { ChatMessage, ToolCall } from '../../Core/Models/ChatMessage';

/** Union of the stable VS Code chat parts we understand. */
type ChatPart =
	| vscode.LanguageModelTextPart
	| vscode.LanguageModelToolCallPart
	| vscode.LanguageModelToolResultPart
	| vscode.LanguageModelDataPart;

/**
 * Serializes a tool-call input object to a JSON string for the wire format.
 * Falls back to an empty object when the input is not stringifiable.
 */
export function stringifyToolInput(input: object): string {
	try {
		return JSON.stringify(input);
	} catch {
		return '{}';
	}
}

/**
 * Parses a JSON string received from the model into an object. Falls back to
 * an empty object on malformed payloads so a single bad tool call cannot break
 * the whole stream.
 */
export function parseToolInput(json: string): object {
	try {
		const value: unknown = JSON.parse(json);
		return typeof value === 'object' && value !== null ? (value as object) : {};
	} catch {
		return {};
	}
}

/**
 * Converts VS Code chat request messages into the API-agnostic chat message
 * model. Tool results are emitted as their own `tool` messages because the
 * OpenAI-compatible wire format requires them to be separate entries.
 */
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
	const toolCalls: ToolCall[] = [];

	for (const rawPart of message.content) {
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

	return {
		role: 'assistant',
		content: text.length > 0 ? text : null,
		...(toolCalls.length > 0 ? { toolCalls } : {}),
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
