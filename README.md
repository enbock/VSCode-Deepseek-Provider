# DeepSeek Model Provider for VS Code

Bring your own DeepSeek cloud API key to GitHub Copilot Chat in VS Code.

This extension registers a **language model chat provider** (`deepseek`) so that
GitHub Copilot can use the [DeepSeek API](https://api-docs.deepseek.com) as a
model backend. It also adds two extra ways to use DeepSeek outside Copilot Chat:

- **Inline code completions** (ghost text) powered by DeepSeek.
- A **`DeepSeek: Generate Commit Message`** command that fills the Source
  Control input box with a message describing your staged (or working-tree)
  changes.

## Requirements

- VS Code `1.137.0` or newer.
- A [DeepSeek API key](https://platform.deepseek.com/api_keys).

## Setup

### Store the API key in Secret Storage (recommended)

This is the secure path: the key never lands in `settings.json`, so it does not
travel with Settings Sync, backups, or shared profiles.

1. Install the extension.
2. Open the Command Palette (`Ctrl+Shift+P`) and run
   **DeepSeek: Configure API Key** (`deepseek.manage`).
3. Choose **`$(key) Set API Key`** and paste your DeepSeek API key into the
   masked input field. The value is trimmed before it is stored; an empty input
   is rejected and stores nothing.
4. In Copilot Chat, pick one of the DeepSeek models from the model picker.
   The list is loaded from the API's `GET /models` endpoint; if that call fails
   the built-in catalog (`deepseek-flash` / `deepseek-v4-pro`) is offered instead.

The key is saved through VS Code's `SecretStorage` API under the key
`deepseek.apiKey`. On Windows it is encrypted with DPAPI and stored in the
profile's `state.vscdb` — you cannot (and should not) edit it by hand.

- **Where it lives:** per VS Code profile, not in your settings file. Other
  profiles do not see it, and Settings Sync does not synchronize it.
- **Change it:** run the command again and choose **Set API Key**; the new
  value overwrites the old one.
- **Remove it:** choose **`$(trash) Clear API Key`**. This removes the Secret
  Storage entry only — it does not touch any other key source (see below).

### Alternative: `DEEPSEEK_API_KEY` environment variable

Set the `DEEPSEEK_API_KEY` environment variable and skip the command entirely.
The key is resolved in this order, first match wins:

1. **Secret Storage** (the `deepseek.manage` command)
2. **`DEEPSEEK_API_KEY`** environment variable
3. **`deepseek.apiKey`** in `settings.json` (not recommended)

The environment variable must be visible to the VS Code **extension host**, so
set it before launching VS Code (on Windows: set it for your user account or
start VS Code from a shell that exports it) and restart VS Code after changing
it — a window reload is not always enough. The variable applies to every
profile.

If a key exists in both Secret Storage and `DEEPSEEK_API_KEY`, Secret Storage
wins. **Clear API Key** only removes the Secret Storage entry — if
`DEEPSEEK_API_KEY` is still set, it keeps being used. Pick one source and use
the other one as a deliberate fallback, not both with different values.

You can also store the key in `settings.json` (not recommended):

```json
"deepseek.apiKey": "sk-..."
```

## Configuration

| Setting                  | Default                  | Description                              |
| ------------------------ | ------------------------ | ---------------------------------------- |
| `deepseek.apiKey`        | `""`                     | API key (prefer Secret Storage or `DEEPSEEK_API_KEY`). |
| `deepseek.baseUrl`       | `https://api.deepseek.com` | OpenAI-compatible base URL.           |
| `deepseek.defaultModel`  | `deepseek-flash`         | Model preselected in the picker.         |
| `deepseek.temperature`   | `0.7`                    | Sampling temperature.                    |
| `deepseek.maxOutputTokens` | `8192`                 | Max tokens generated per response.       |
| `deepseek.enableCompletions` | `true`               | Enable inline (ghost text) completions.  |
| `deepseek.completionModel` | `deepseek-flash`       | Model used for inline completions.       |
| `deepseek.completionTemperature` | `0`             | Sampling temperature for completions.    |
| `deepseek.completionMaxTokens` | `256`             | Max tokens generated per completion.     |

## Models

The model picker is populated from the API's model list (`GET /models`), so
models released after this extension shipped show up automatically. The built-in
catalog supplies the display name, token limits, and capabilities for known
models:

| Model             | Use for                                              |
| ----------------- | ---------------------------------------------------- |
| `deepseek-flash`  | Fast, low cost; everyday chat and agent work.        |
| `deepseek-v4-pro` | Slower, pricier; harder reasoning and long context.  |

Models the catalog does not know yet are still listed with conservative
defaults. If the API call fails or returns an empty list, the provider falls
back to the catalog above. Both catalog models accept a 1M-token context window
and support tool calling. `deepseek.defaultModel` only decides which entry the
model picker preselects — you can still switch models at any time in Copilot Chat.

## Context window usage

The provider reports the token accounting DeepSeek returns for every response, so
Copilot Chat can show how full the context window is and warn you before it
overflows.

* The **context usage indicator** in the chat input shows the share of the
  1,048,576-token window used by the last request. It turns yellow at 75% and red
  at 90%. Select it for a breakdown of what filled the prompt — system
  instructions, tool definitions, messages, files and tool results.
* **Automatic compaction**: Copilot sizes the prompt against an input budget of
  786,432 tokens (the 1M window minus the 393,216 tokens DeepSeek may generate).
  Once a conversation grows past that budget, older turns are summarized into a
  shorter history instead of being sent in full. You can also trigger this
  manually with `/compact` in the chat input.

`deepseek.maxOutputTokens` (default `8192`) caps how many tokens any single
response may generate; it does not change the size of the context window shown by
the indicator.

## Inline code completions

When `deepseek.enableCompletions` is `true` (the default), the extension registers
an inline completion provider that offers DeepSeek-generated ghost text while you
type. It sends a small window of the code before and after the cursor to
`deepseek.completionModel` and inserts the continuation at the cursor.

- Toggle it off with `"deepseek.enableCompletions": false`.
- The completion model, temperature, and response length are controlled by
  `deepseek.completionModel`, `deepseek.completionTemperature`, and
  `deepseek.completionMaxTokens`.
- Completions are best-effort: a failed or cancelled request simply produces no
  ghost text instead of an error notification.


## Commit messages

Run **DeepSeek: Generate Commit Message** from the Command Palette
(`Ctrl+Shift+P`) to describe the current repository's changes:

- Staged changes (`git diff --cached`) are used when present.
- Otherwise the working-tree changes are used, so the command still works before
  `git add`.
- The generated message follows the Conventional Commits format
  (`type(scope): subject`) and is written into the Source Control input box,
  ready to review and commit.

Copilot Chat's own sparkle button in the Source Control view also uses DeepSeek
when a DeepSeek model is the model selected in the chat model picker; the
command above is a standalone alternative that does not require Copilot Chat.

The command needs a Git repository open in the workspace and uses the built-in
Git extension to read the diff — no additional setup beyond the API key.

## Troubleshooting

Run **`DeepSeek: Check Setup`** from the Command Palette. It reports at a glance:

- whether an API key was found (Secret Storage, `DEEPSEEK_API_KEY`, or settings),
- whether editor inline suggestions and `deepseek.enableCompletions` are on,
- which model completions use,
- whether GitHub Copilot is enabled (it can supply its own completions when you
  are signed in, which is easy to confuse with DeepSeek's),
- whether the built-in Git extension is available for commit messages,
- the configured base URL.

DeepSeek completions and commit messages only need the DeepSeek API key — no
GitHub sign-in. The chat view itself is GitHub Copilot's UI and always requires
a GitHub account.

## Development

```bash
npm install
npm run compile     # one-off build
npm run watch       # watch mode (used by F5)
npm run package     # build the .vsix
```

Press `F5` to launch an Extension Development Host.

## Architecture

The code follows Clean Architecture with folders grouped by responsibility
(bounded context). Interfaces are named without an `I` prefix.

- `src/Core` — domain models, business services, and ports.
  - `Chat/` — chat request/response types, the `ChatClient` port, the
    `ApiError` failure type, the `ModelInfo`/`ModelCatalog` model knowledge,
    and the `TokenEstimator` service.
  - `Configuration/` — the `Configuration` and `ApiKeyStore` ports plus
    `ConfigurationError`.
  - `Logging/` — the `Logger` port.
- `src/Application` — orchestration; depends only on `src/Core`.
  - `Chat/` — the `DeepSeekChatProvider`, the `ChatProviderError` failure type,
    and the VS Code message converter.
  - `Completion/` — the `DeepSeekCompletionProvider` inline completion provider.
  - `CommitMessage/` — the `GenerateCommitMessageCommand` use case.
  - `Configuration/` — the `ManageCommand` use case.
  - `Diagnostics/` — the `CheckSetupCommand` use case.
  - `Composition/` — the manual DI container
    (`src/Application/Composition/Container.ts`).
- `src/Infrastructure` — adapters implementing the domain ports.
  - `Chat/` — the DeepSeek HTTP/SSE client (streaming and non-streaming).
  - `Configuration/` — VS Code settings and secret storage.
  - `Logging/` — the output channel logger.

Global type declarations live in `src/global.d.ts`. The `ReturnOrThrowError`
helper documents which errors a call may throw without changing its return
type — for example:

```ts
streamChat(request, signal): ReturnOrThrowError<AsyncIterable<ChatStreamChunk>, ApiError>;
```

Each layer translates failures of the layer below into its own error type
rather than forwarding them: `DeepSeekChatProvider` catches
`ConfigurationError`, `ApiError`, and transport failures and rethrows a single
[`ChatProviderError`](src/Application/Chat/ChatProviderError.ts) with the
original error attached as `cause`. Cancellation is not a failure and is
reported as `vscode.CancellationError`.

## License

[MIT](LICENSE)
