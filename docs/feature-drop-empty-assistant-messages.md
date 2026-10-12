# Drop Empty Assistant Messages

## Overview
Prevent invalid assistant messages from being sent to the DeepSeek API when an agent continues a conversation. This keeps sub-agent requests working when replayed history contains an assistant turn with neither text nor a tool call.

## User Story

As a user of the DeepSeek provider, I want empty assistant messages without text or tool calls to be omitted from the conversation history, so that sub-agent requests do not fail DeepSeek API validation.

#### Acceptance Criteria
- Given an assistant message containing only reasoning, when the conversation history is converted for the API, then it is not sent as an invalid assistant message.
- Given an assistant message containing text or tool calls, when the conversation history is converted for the API, then it is preserved.
- Given a sub-agent continuation whose replayed history contains an empty assistant message, when the request is sent, then it does not fail with DeepSeek's “content or tool_calls must be set” validation error.

## Out of Scope
- Changing how reasoning content or tool calls are generated, displayed, or replayed.

## Technical Design

### Design
- **Component to change — `src/Application/Chat/MessageConverter.ts`:** Keep filtering at the application boundary that converts VS Code request messages into the provider's `ChatMessage[]` history. Have assistant conversion indicate that no message should be emitted when, after extracting both native thinking parts and fenced thinking text, it has no non-empty text content and no tool calls. `toChatMessages` should append only converted assistant messages that are not omitted.
- **Existing data flow:** `DeepSeekChatProvider.provideLanguageModelChatResponse` calls `toChatMessages` to populate `ChatRequest.messages`; `DeepSeekHttpClient.toWireRequest` serializes those messages for the API. Filtering before a `ChatMessage` is created ensures reasoning-only and otherwise empty turns never reach the wire, including when `toWireRequest` would otherwise add `reasoning_content: ""` for a request with tools.
- **Preservation rules:** Keep assistant messages with content or at least one tool call unchanged, including their reasoning metadata. Do not trim or rewrite non-empty text. Leave user, system, and tool-result conversion unchanged. An empty or reasoning-only assistant message with no tool calls is omitted regardless of whether its reasoning arrived as a thinking part or a fenced block.
- **Key decision:** Omit at `MessageConverter`, rather than filtering in `DeepSeekHttpClient`. This keeps API-history conversion semantics in the application layer, avoids constructing invalid core messages, and lets all outgoing chat requests benefit. Rejected filtering only in the HTTP adapter because it would place conversation-history policy in infrastructure and allow invalid entries to persist in intermediate requests.
- **Test approach:** Cover assistant conversion for reasoning-only/empty messages, text-only messages, tool-call-only messages, and mixed text/tool-call messages. Add a regression at the request boundary to verify an omitted turn is absent from the serialized message list while preserved assistant messages remain. The repository currently has no project test script or test files, so select the smallest compatible test approach rather than assuming an existing test framework.

### Feasibility
- **Verdict: feasible with caveats**
- **Risks and blockers:** The change is localized and the current `ChatMessage` and wire-message contracts already support the required behavior. The repository has no visible test infrastructure; automated regression coverage will require selecting or introducing a test approach. Confirm that approach before implementing tests. A loose interpretation of “empty” could accidentally drop whitespace or meaningful text, so test and implement omission based on zero-length content after the existing thinking split, not trimming.
- **Open questions:** Which lightweight test runner/mocking approach should be used for VS Code API-dependent message conversion? If none is established outside the checked-in project, add only the minimum setup needed for these focused tests.
- **Acceptance-criteria assessment:** The criteria are compatible with the current flow. Reasoning-only assistant turns (native or fenced) and turns with no text or tool calls should be omitted; assistant turns with text or tool calls must remain. No acceptance criterion appears impossible.

### Task Breakdown
- [x] **Task 1 — Omit empty assistant turns in API-history conversion (S)** — Depends on: none. Update `convertAssistantMessage` in `MessageConverter.ts` to represent an omitted assistant result when converted content is empty and no tool calls were collected; have `toChatMessages` skip that result. Determine emptiness after `splitThinking` so native and fenced reasoning-only parts are covered. Preserve all messages with non-empty content or tool calls and leave other roles unchanged.
- [x] **Task 2 — Add focused conversion regression tests (M)** — Depends on: Task 1. Add tests for native reasoning-only, fenced reasoning-only, and otherwise empty assistant messages being omitted, plus text-only, tool-call-only, and mixed text/tool-call assistant messages being preserved. Use the smallest test setup compatible with the repository; the current package scripts expose compile/watch/package only, with no test runner configured.
- [x] **Task 3 — Verify serialized continuation history (M)** — Depends on: Tasks 1–2. Add or extend a boundary-level regression that builds a request containing an empty/reasoning-only replayed assistant turn, passes it through the existing request serialization path, and asserts that no invalid assistant object is sent while valid assistant text and tool calls remain. Include a request carrying tools to exercise the existing `reasoning_content` handling.
- [ ] **Task 4 — Run project validation (S)** — Depends on: Tasks 1–3. Run the focused tests and `npm run compile`; confirm no changes are needed to the core message model or HTTP wire schema.

### Suggested Implementation Order
Implement omission in `MessageConverter` first because it is the single conversion boundary used by provider requests. Add focused unit coverage, then a serialized-request regression for the sub-agent continuation case, and finally run tests and TypeScript compilation. Resolve the test-runner question before adding test dependencies.

## Implementation Notes

### Task 1
- `convertAssistantMessage` now returns no result when `splitThinking` leaves empty content and no tool calls were collected; `toChatMessages` skips that result.
- Assistant content is checked by length without trimming, and user/system/tool-result conversion is unchanged.

### Task 2
- Added six focused `node:test` regression cases for omitted reasoning-only/empty turns and preserved text/tool-call combinations.
- Added an npm test script that compiles TypeScript before running tests. The tests mock only the VS Code language-model part classes needed to exercise `MessageConverter`.

### Task 3
- Extended the existing `node:test` setup with a serialized-request regression using `DeepSeekHttpClient.streamChat` and a mocked fetch boundary.
- Verified reasoning-only replay is absent from the serialized request while text and tool-call assistant messages remain valid; a tools-carrying request also confirms the serialized assistant messages include `reasoning_content`.
