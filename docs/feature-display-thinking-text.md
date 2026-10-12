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
- A collapsible "thinking" UI of our own: the provider only decides which part type
  carries the reasoning. On clients that know thinking parts (proposed
  `languageModelThinkingPart` API) the chat view renders its own collapsible section;
  everywhere else the reasoning stays plain markdown text.
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

The provider does not decide which part type carries the reasoning: it asks the
`ThinkingReporterFactory` for a reporter and streams the chain of thought through it.
The reporter has to be closed before anything else is streamed, otherwise the answer
text of a merged assistant turn is replayed as part of the reasoning:

```ts
const thinkingReporter = this.thinkingReporterFactory.create(progress);

for await (const chunk of this.chatClient.streamChat(request, abortController.signal)) {
	if (chunk.reasoning) {
		thinkingReporter.reportReasoning(chunk.reasoning);
	}
	if (chunk.text) {
		thinkingReporter.closeReasoning();
		progress.report(new vscode.LanguageModelTextPart(chunk.text));
	}
	for (const call of chunk.toolCalls ?? []) {
		thinkingReporter.closeReasoning();
		progress.report(
			new vscode.LanguageModelToolCallPart(call.id, call.name, parseToolInput(call.arguments)),
		);
	}
	if (chunk.usage) {
		progress.report(this.toUsageReport(chunk.usage));
	}
}
```

#### Emitting the reasoning — `src/Application/Chat/ThinkingReporter/`

Two strategies implement one small interface:

```ts
interface ThinkingReporter {
	reportReasoning(reasoning: string): void;
	closeReasoning(): void;
}
```

- `NativeThinkingReporter` reports `new LanguageModelThinkingPart(reasoning)`. The
  chat view renders it in its own collapsible section and hands the part back on the
  next turn, so the reasoning does not depend on the text of the turn surviving.
  `closeReasoning` has nothing to report because the surrounding parts delimit the
  reasoning.
- `TextThinkingReporter` is the fallback: it reports `THINKING_LABEL` once, streams
  the reasoning as text and reports `THINKING_SEPARATOR` once when the reasoning is
  closed. Section 5 recovers the reasoning from that block again.

`ThinkingReporterFactory.create(progress)` picks the strategy by probing the running
client instead of assuming the proposed API:

```ts
const thinkingPart = getThinkingPartConstructor();

return thinkingPart
	? new NativeThinkingReporter(progress, thinkingPart)
	: new TextThinkingReporter(progress);
```

`LanguageModelThinkingPart` is only declared by the proposed
`languageModelThinkingPart` API, so it is missing from the stable `@types/vscode`
surface; `src/vscode.proposed.languageModelThinkingPart.d.ts` vendors the official
Microsoft declaration so the call type-checks. The probe reads the class through a
cast inside a `try`/`catch`, so a client that does not expose it - or refuses
proposed APIs when they are read - falls back to the fenced text block instead of
failing the request. `package.json` deliberately does not declare the proposal:
current clients expose the class unconditionally, so declaring it would only add an
error-level log line on installs that do not allow proposed APIs, without changing
behaviour. `NativeThinkingReporter` casts the part to
`vscode.LanguageModelResponsePart` because the stable response-part union predates
thinking parts. The factory is created once in the composition root
(`src/Application/Composition/Container.ts`) and injected into the provider.

Both strategies satisfy the acceptance criteria: the label appears once with the
first reasoning chunk, reasoning streams live, the separator appears before the
first answer chunk or tool call, no empty block is created when `reasoning_content`
never arrives (the fenced reporter stays unopened), and reasoning precedes any tool
calls because the API always streams it first.

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

The fenced block is only one of the two routes reasoning takes back to the
provider. The agent host replays reasoning as a native thinking part instead, so
`convertAssistantMessage` asks `readThinkingPart` (`src/Application/Chat/ThinkingPart.ts`)
first and keeps whatever the part carries, then falls back to the fenced block.
Both sources are concatenated, because DeepSeek appends whatever is passed back to
the reasoning context.

`splitThinking` returns `reasoning: null` when no thinking block is present, so
messages without reasoning omit the field entirely instead of sending an empty
string at this layer. If a turn produced only thinking, `content` becomes an empty
string and the message keeps `content: null` as before.

### 6. Wire replay — `src/Infrastructure/Chat/DeepSeekHttpClient.ts`

The assistant branch of `toWireMessage` forwards the preserved reasoning as the
`reasoning_content` field next to `content`/`tool_calls`:

```ts
case 'assistant': {
	const reasoningContent = message.reasoningContent ?? '';
	return {
		role: 'assistant',
		content: message.content,
		...(carriesTools || reasoningContent.length > 0 ? { reasoning_content: reasoningContent } : {}),
		...(message.toolCalls && message.toolCalls.length > 0
			? { tool_calls: message.toolCalls.map((call) => this.toWireToolCall(call)) }
			: {}),
	};
}
```

`WireMessage` gains an optional `reasoning_content?: string | null`. Starting from
the introduction of the `tools` parameter, DeepSeek requires the field on **every**
replayed assistant message of that request, so `toWireRequest` computes
`carriesTools` once and passes it down: with tools present the field is always
written, using an empty string when the chain of thought is no longer available
(e.g. after a compaction). Without tools the field is only written when reasoning
is actually present, so non-thinking turns and models keep the plain OpenAI message
shape. A single `logger.debug` line reports how many turns needed the placeholder.

### 7. Edge cases

- **Reasoning with no final text**: label and reasoning are shown; the separator is
  emitted before the trailing tool call (or not at all when the turn ends after the
  reasoning). On the next turn the whole block is stripped and `content` is `null`.
- **Tool calls after reasoning**: the first assistant turn contains thinking text
  and tool calls but no answer text. The block is closed before the tool call is
  reported, so a replayed turn can never merge its answer into the reasoning. The
  converter separates the thinking (kept as `reasoningContent`) from the answer and
  keeps the tool calls; DeepSeek receives an assistant message carrying both
  `reasoning_content` and `tool_calls`, which is the shape its thinking-mode
  tool-call loop requires.
- **Reasoning that is no longer recoverable**: an assistant turn replayed without
  thinking part and without the fenced block (turns from another model, compacted
  history) still receives `reasoning_content: ""` when the request carries tools, so
  the 400 cannot come back.
- **Usage chunk**: usage is already yielded before the choice content in
  `parseChunk`, and typically arrives on the final chunk, after all text; the new
  reasoning branch does not affect its ordering.
- **Empty reasoning deltas**: falsy `reasoning_content` values are skipped by the
  `if (chunk.reasoning)` guard, so no whitespace-only parts are reported.
- **Client without native thinking parts**: the fenced text block keeps the
  reasoning visible in the chat and replayable on the next turn, so nothing is lost
  on clients that do not expose the proposal.
- **Thinking parts with an array value**: the agent host merges consecutive thinking
  parts of one assistant turn into a single part whose `value` is an array, so
  `readThinkingPart` joins the entries instead of treating the part as unreadable.
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
- `src/Application/Chat/DeepSeekChatProvider.ts` — imported `THINKING_LABEL`/`THINKING_SEPARATOR` and replaced the text-reporting block with the streaming logic that tracks `thinkingShown`/`thinkingClosed`, reports the label once, streams reasoning chunks, and reports the separator once before the first answer chunk or tool call. Tool-call and usage reporting are otherwise unchanged.

#### Follow-up fix — reasoning must be replayed

DeepSeek's thinking mode rejects a request that carries `tools` when a replayed
assistant message has dropped its `reasoning_content`
(`The reasoning_content in the thinking mode must be passed back to the API`,
HTTP 400), which broke every turn that followed a sub-agent tool call.
`stripThinking` was replaced by `splitThinking`, the reasoning is now kept on
`ChatMessage.reasoningContent`, and it is written back to the wire:

- `src/Core/Chat/ChatMessage.ts` — added the optional `reasoningContent` field.
- `src/Infrastructure/Chat/DeepSeekHttpClient.ts` — added `reasoning_content?: string | null` to `WireMessage` and emit it from the assistant branch of `toWireMessage`.

#### Follow-up fix — reasoning lost on long sub-agent runs

Long agent runs still failed with the same 400 whenever a replayed turn had no
recoverable reasoning left: the agent host delivers reasoning as a native thinking
part instead of the fenced text block, and compacted or foreign turns carry
neither. The following changes close that gap:

- `src/Application/Chat/ThinkingPart.ts` (new) — `readThinkingPart` duck-types a
  message part as a thinking part (`instanceof` when the proposed API is present,
  otherwise `constructor.name`) and returns its text, or `null` when the part is
  not reasoning. Array values are joined, empty reasoning is treated as absent.
  `getThinkingPartConstructor` exposes the same probe for the emitting side.
- `src/Application/Chat/ThinkingReporter/` (new) — `ThinkingReporter` (interface),
  `NativeThinkingReporter` (reports `LanguageModelThinkingPart`s),
  `TextThinkingReporter` (the fenced text fallback) and `ThinkingReporterFactory`,
  which probes the class once per request and logs the chosen strategy once per
  session.
- `src/Application/Chat/MessageConverter.ts` — `convertAssistantMessage` collects
  reasoning from thinking parts and from the fenced block and stores the
  combination on `reasoningContent`.
- `src/Application/Chat/DeepSeekChatProvider.ts` — the reasoning is streamed through
  the reporter instead of a text block owned by the provider, which also closes it
  before tool calls so a merged assistant message on the next turn cannot lose its
  answer text to the reasoning split; `countPartTokens` counts replayed reasoning so
  the context window estimate stays correct.
- `src/Application/Composition/Container.ts` — creates the `ThinkingReporterFactory`
  and injects it into the provider.
- `src/Application/Chat/DeepSeekHttpClient.ts` — with `tools` in the request the
  assistant branch always writes `reasoning_content`, falling back to `''` when the
  chain of thought is gone, and logs one debug line per request that needed the
  placeholder.
- `src/vscode.proposed.languageModelThinkingPart.d.ts` (new) — the official
  Microsoft declaration of the proposed `languageModelThinkingPart` API, vendored
  because the installed `@types/vscode` does not declare the class yet.

### Verification
- `npm run compile` (tsc -p ./) completed with exit code 0 and no TypeScript errors.
- A stubbed-`vscode` harness exercised the compiled `MessageConverter`,
  `DeepSeekHttpClient` and `DeepSeekChatProvider`, with and without the stub
  exporting `LanguageModelThinkingPart`:

  1. a thinking part is recognised by its constructor name when the client does not
     export the class;
  2. a replayed assistant turn with reasoning and tool calls writes
     `reasoning_content` and `tool_calls` on the wire;
  3. a turn whose reasoning is gone still gets `reasoning_content: ''` - only when
     the request carries tools - and exactly one debug line is logged;
  4. an empty thinking part is ignored instead of replayed as reasoning;
  5. an exported class is detected through `instanceof`;
  6. with the class available the provider streams native thinking parts and no
     fenced text, and the parts come back as the turn's `reasoningContent`; without
     it the fenced text block is streamed before the tool call and the reasoning is
     recovered from it on the next turn.

  All checks passed.

### Deviations
- None.

