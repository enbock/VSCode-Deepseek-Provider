# Display Thinking (Reasoning) Text During the Thinking Phase

## Overview
Reasoning models stream a "thinking" phase (the API field `reasoning_content`) before their final answer. The DeepSeek provider currently discards this content. This feature surfaces it in the Copilot chat as clearly-marked inline text so users can follow the model's reasoning while it is still thinking.

## User Story

As a developer using the DeepSeek provider in VS Code Copilot Chat, I want to see the model's thinking text appear in the chat while it is still thinking, so that I can follow what the model is working on before the final answer arrives.

#### Acceptance Criteria
- Given a request to a DeepSeek model that streams `reasoning_content`, when the first reasoning chunk arrives, then the chat shows a clearly visible "Thinking" label followed by the reasoning text.
- Given further reasoning chunks, when they arrive, then they are appended so the thinking text streams live during the thinking phase.
- Given the model then streams the final answer (`content`), when the first answer chunk arrives, then the answer is displayed after the thinking text, visually separated from it.
- Given a model response without `reasoning_content`, when the stream finishes, then no empty "Thinking" block is shown.
- Given the model calls tools after thinking, when the stream progresses, then the thinking text is shown before the tool calls.

## Out of Scope
- A native collapsible "thinking" UI (not available in the VS Code `LanguageModelChatProvider` API).
- A configuration setting to enable/disable the display (always on, per decision).
- Showing thinking text in inline completions or the commit-message command (they use `complete()`, which returns only the answer).

## Technical Design

### Overview

The thinking text travels end-to-end as a new, optional field on the existing
stream chunks, is forwarded to the chat view as ordinary `LanguageModelTextPart`s
(the only part type the API can render), and is fenced by two shared delimiters so
it can be removed again when VS Code echoes the assistant message back in the next
turn.

### 1. Wire format — `src/Infrastructure/Chat/DeepSeekHttpClient.ts`

The DeepSeek stream reports the thinking phase as `delta.reasoning_content`, which
arrives before `delta.content`. Today it is ignored.

- Extend the `SseChunk` wire interface:

  ```ts
  interface SseChunk {
  	choices?: Array<{
  		delta?: {
  			content?: string | null;
  			reasoning_content?: string | null;
  			tool_calls?: Array<{
  				index?: number;
  				id?: string;
  				function?: { name?: string; arguments?: string };
  			}>;
  		};
  		finish_reason?: string | null;
  	}>;
  	usage?: SseUsage | null;
  }
  ```

- In `parseChunk`, emit reasoning before content, right after the usage block:

  ```ts
  if (choice.delta?.reasoning_content) {
  	yield { reasoning: choice.delta.reasoning_content };
  }

  if (choice.delta?.content) {
  	yield { text: choice.delta.content };
  }
  ```

No change is needed in `complete()`: it already ignores anything but `chunk.text`,
so the commit-message command keeps returning only the answer.

### 2. Stream model — `src/Core/Chat/ChatStreamChunk.ts`

Add an optional reasoning field:

```ts
export interface ChatStreamChunk {
	readonly reasoning?: string;
	readonly text?: string;
	readonly toolCalls?: readonly ToolCall[];
	readonly finishReason?: string | null;
	readonly usage?: TokenUsage;
}
```

### 3. Shared delimiters — `src/Application/Chat/MessageConverter.ts`

The same strings are used to fence the thinking block when displaying it and to
strip it when an assistant message is echoed back. Export them once:

```ts
export const THINKING_LABEL = '**Thinking**\n\n';
export const THINKING_SEPARATOR = '\n\n---\n\n';
```

The label is rendered bold by the chat markdown renderer, and the separator renders
as a horizontal rule, giving a clear visual break between thinking and answer.

### 4. Provider streaming — `src/Application/Chat/DeepSeekChatProvider.ts`

In `provideLanguageModelChatResponse`, track whether the thinking block has already
been opened and whether the answer has already started, so the label and separator
are emitted exactly once:

```ts
let thinkingShown = false;
let answerStarted = false;

for await (const chunk of this.chatClient.streamChat(request, abortController.signal)) {
	if (chunk.reasoning) {
		if (!thinkingShown) {
			thinkingShown = true;
			progress.report(new vscode.LanguageModelTextPart(THINKING_LABEL));
		}
		progress.report(new vscode.LanguageModelTextPart(chunk.reasoning));
	}
	if (chunk.text) {
		if (thinkingShown && !answerStarted) {
			progress.report(new vscode.LanguageModelTextPart(THINKING_SEPARATOR));
		}
		answerStarted = true;
		progress.report(new vscode.LanguageModelTextPart(chunk.text));
	}
	for (const call of chunk.toolCalls ?? []) {
		progress.report(
			new vscode.LanguageModelToolCallPart(call.id, call.name, parseToolInput(call.arguments)),
		);
	}
	if (chunk.usage) {
		progress.report(this.toUsageReport(chunk.usage));
	}
}
```

This satisfies the acceptance criteria: the label appears once with the first
reasoning chunk, reasoning streams live, the separator appears before the first
answer chunk, no empty block is created when `reasoning_content` never arrives
(`thinkingShown` stays `false`), and reasoning precedes any tool calls because the
API always streams it first.

### 5. Multi-turn context — `src/Application/Chat/MessageConverter.ts`

Because the thinking text is reported as `LanguageModelTextPart`s, VS Code treats
it as part of the assistant's response and echoes it back as assistant `content` in
the next request. Sending the reasoning back as answer content would waste tokens
and can degrade later turns, so `convertAssistantMessage` splits the fenced block
off the text parts before building the `ChatMessage`:

```ts
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
```

The extracted reasoning is **not** discarded: it is carried on the `ChatMessage`
as the optional `reasoningContent` field (`src/Core/Chat/ChatMessage.ts`) so it can
be replayed on the wire. DeepSeek's thinking mode requires the chain of thought to
be passed back on every replayed assistant message whenever the request carries the
`tools` parameter — including turns where the model did not call a tool — and
rejects the request with HTTP 400 otherwise (`The reasoning_content in the thinking
mode must be passed back to the API`). Agent flows such as sub-agent tool calls hit
this on the request that follows the tool result, which is why dropping the block
broke them.

`splitThinking` returns `reasoning: null` when no thinking block is present, so
messages without reasoning omit the field entirely instead of sending an empty
string. If a turn produced only thinking (no separator), `content` becomes an
empty string and the message keeps `content: null` as before.

### 6. Wire replay — `src/Infrastructure/Chat/DeepSeekHttpClient.ts`

The assistant branch of `toWireMessage` forwards the preserved reasoning as the
`reasoning_content` field next to `content`/`tool_calls`:

```ts
case 'assistant':
	return {
		role: 'assistant',
		content: message.content,
		...(message.reasoningContent
			? { reasoning_content: message.reasoningContent }
			: {}),
		...(message.toolCalls && message.toolCalls.length > 0
			? { tool_calls: message.toolCalls.map((call) => this.toWireToolCall(call)) }
			: {}),
	};
```

`WireMessage` gains an optional `reasoning_content?: string | null`. The field is
only emitted when reasoning is present, so non-thinking turns and models keep the
plain OpenAI message shape.

### 7. Edge cases

- **Reasoning with no final text**: label and reasoning are shown; no separator is
  emitted. On the next turn the whole block is stripped and `content` is `null`.
- **Tool calls after reasoning**: the first assistant turn contains thinking text
  and tool calls but no answer text, so no separator is emitted. The converter
  separates the thinking (kept as `reasoningContent`) from the answer and keeps the
  tool calls; DeepSeek receives an assistant message carrying both `reasoning_content`
  and `tool_calls`, which is the shape its thinking-mode tool-call loop requires.
- **Usage chunk**: usage is already yielded before the choice content in
  `parseChunk`, and typically arrives on the final chunk, after all text; the new
  reasoning branch does not affect its ordering.
- **Empty reasoning deltas**: falsy `reasoning_content` values are skipped by the
  `if (chunk.reasoning)` guard, so no whitespace-only parts are reported.
- **Accepted risk**: if a model's own output literally contains the strings
  `**Thinking**` or the separator, the stripper could cut text. These delimiters
  are sufficiently specific and controlled by the provider, so this is considered
  an acceptable, low-probability trade-off for the lack of a dedicated reasoning
  part in the VS Code API.

## Implementation

Implemented the thinking-text feature exactly as specified in the Technical Design.

### Files changed
- `src/Infrastructure/Chat/DeepSeekHttpClient.ts` — added `reasoning_content?: string | null;` to the `SseChunk` `delta`, and in `parseChunk` yield `{ reasoning: choice.delta.reasoning_content }` after the usage block and before the content yield.
- `src/Core/Chat/ChatStreamChunk.ts` — added `readonly reasoning?: string;` as the first field of `ChatStreamChunk`.
- `src/Application/Chat/MessageConverter.ts` — exported `THINKING_LABEL` and `THINKING_SEPARATOR`; added `splitThinking` and applied it to the assembled `text` in `convertAssistantMessage` before building the returned `ChatMessage`, carrying the fenced reasoning on as `reasoningContent` instead of discarding it.
- `src/Application/Chat/DeepSeekChatProvider.ts` — imported `THINKING_LABEL`/`THINKING_SEPARATOR` and replaced the text-reporting block with the streaming logic that tracks `thinkingShown`/`answerStarted`, reports the label once, streams reasoning chunks, and reports the separator once before the first answer chunk. Tool-call and usage reporting are unchanged.

#### Follow-up fix — reasoning must be replayed

DeepSeek's thinking mode rejects a request that carries `tools` when a replayed
assistant message has dropped its `reasoning_content`
(`The reasoning_content in the thinking mode must be passed back to the API`,
HTTP 400), which broke every turn that followed a sub-agent tool call.
`stripThinking` was replaced by `splitThinking`, the reasoning is now kept on
`ChatMessage.reasoningContent`, and it is written back to the wire:

- `src/Core/Chat/ChatMessage.ts` — added the optional `reasoningContent` field.
- `src/Infrastructure/Chat/DeepSeekHttpClient.ts` — added `reasoning_content?: string | null` to `WireMessage` and emit it from the assistant branch of `toWireMessage`.

### Verification
- `npm run compile` (tsc -p ./) completed with exit code 0 and no TypeScript errors.
- A stubbed-`vscode` harness exercised the compiled `MessageConverter` and
  `DeepSeekHttpClient`: reasoning is captured from echoed assistant messages
  (with and without an answer), stripped from `content`, kept alongside tool calls,
  omitted when absent, and emitted as `reasoning_content` next to `tool_calls` on
  the wire. All checks passed.

### Deviations
- None.

