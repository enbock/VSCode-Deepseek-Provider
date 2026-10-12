const assert = require('node:assert/strict');
const Module = require('node:module');
const { test } = require('node:test');

class LanguageModelTextPart {
	constructor(value) {
		this.value = value;
	}
}

class LanguageModelToolCallPart {
	constructor(callId, name, input) {
		this.callId = callId;
		this.name = name;
		this.input = input;
	}
}

class LanguageModelThinkingPart {
	constructor(value) {
		this.value = value;
	}
}

const vscode = {
	LanguageModelChatMessageRole: {
		Assistant: 1,
		User: 2,
	},
	LanguageModelTextPart,
	LanguageModelToolCallPart,
	LanguageModelThinkingPart,
};

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
	if (request === 'vscode') {
		return vscode;
	}
	return originalLoad.call(this, request, parent, isMain);
};

const { toChatMessages } = require('../out/Application/Chat/MessageConverter.js');
Module._load = originalLoad;

function assistant(...content) {
	return {
		role: vscode.LanguageModelChatMessageRole.Assistant,
		content,
	};
}

test('omits assistant messages containing only native reasoning', () => {
	assert.deepEqual(toChatMessages([assistant(new LanguageModelThinkingPart('reasoning'))]), []);
});

test('omits assistant messages containing only fenced reasoning', () => {
	assert.deepEqual(
		toChatMessages([
			assistant(new LanguageModelTextPart('**Thinking**\n\nreasoning\n\n---\n\n')),
		]),
		[],
	);
});

test('omits otherwise empty assistant messages', () => {
	assert.deepEqual(toChatMessages([assistant()]), []);
});

test('preserves text-only assistant messages', () => {
	assert.deepEqual(toChatMessages([assistant(new LanguageModelTextPart('answer'))]), [
		{ role: 'assistant', content: 'answer' },
	]);
});

test('preserves tool-call-only assistant messages', () => {
	assert.deepEqual(
		toChatMessages([
			assistant(new LanguageModelToolCallPart('call-1', 'lookup', { query: 'value' })),
		]),
		[
			{
				role: 'assistant',
				content: null,
				toolCalls: [
					{
						id: 'call-1',
						name: 'lookup',
						arguments: '{"query":"value"}',
					},
				],
			},
		],
	);
});

test('preserves mixed text and tool-call assistant messages', () => {
	assert.deepEqual(
		toChatMessages([
			assistant(
				new LanguageModelTextPart('answer'),
				new LanguageModelToolCallPart('call-1', 'lookup', { query: 'value' }),
			),
		]),
		[
			{
				role: 'assistant',
				content: 'answer',
				toolCalls: [
					{
						id: 'call-1',
						name: 'lookup',
						arguments: '{"query":"value"}',
					},
				],
			},
		],
	);
});
