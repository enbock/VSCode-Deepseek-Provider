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
const { DeepSeekHttpClient } = require('../out/Infrastructure/Chat/DeepSeekHttpClient.js');

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

test('serializes replayed assistant history without empty assistant messages when tools are present', async () => {
	const request = {
		model: 'deepseek-chat',
		messages: toChatMessages([
			assistant(new LanguageModelThinkingPart('reasoning without an answer')),
			assistant(new LanguageModelTextPart('answer')),
			assistant(new LanguageModelToolCallPart('call-1', 'lookup', { query: 'value' })),
		]),
		tools: [{ name: 'lookup', description: 'Look up a value' }],
	};
	const originalFetch = global.fetch;
	let serializedRequest;

	global.fetch = async (_input, options) => {
		serializedRequest = JSON.parse(options.body);
		return {
			ok: true,
			status: 200,
			body: new ReadableStream({
				start(controller) {
					controller.enqueue(new TextEncoder().encode('data: [DONE]\n'));
					controller.close();
				},
			}),
		};
	};

	try {
		const client = new DeepSeekHttpClient(
			{
				getApiKey: async () => 'test-api-key',
				getBaseUrl: () => 'https://api.example.test',
			},
			{ debug() {}, warn() {}, error() {} },
		);

		for await (const _chunk of client.streamChat(request, new AbortController().signal)) {
		}
	} finally {
		global.fetch = originalFetch;
	}

	const assistantMessages = serializedRequest.messages.filter((message) => message.role === 'assistant');
	assert.deepEqual(assistantMessages, [
		{
			role: 'assistant',
			content: 'answer',
			reasoning_content: '',
		},
		{
			role: 'assistant',
			content: null,
			reasoning_content: '',
			tool_calls: [
				{
					id: 'call-1',
					type: 'function',
					function: { name: 'lookup', arguments: '{"query":"value"}' },
				},
			],
		},
	]);
	assert.equal(
		assistantMessages.every(
			(message) =>
				(typeof message.content === 'string' && message.content.length > 0) ||
				(message.tool_calls?.length ?? 0) > 0,
		),
		true,
	);
	assert.equal(serializedRequest.tools.length, 1);
});
