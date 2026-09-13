# DeepSeek Model Provider for VS Code

Bring your own DeepSeek cloud API key to GitHub Copilot Chat in VS Code.

This extension registers a **language model chat provider** (`deepseek`) so that
GitHub Copilot can use the [DeepSeek API](https://api-docs.deepseek.com) as a
model backend.

## Requirements

- VS Code `1.137.0` or newer.
- A [DeepSeek API key](https://platform.deepseek.com/api_keys).

## Setup

1. Install the extension.
2. Run the command **DeepSeek: Configure API Key** (`deepseek.manage`) and
   choose **Set API Key**. The key is stored in VS Code **Secret Storage**, not
   in your settings file.
3. In Copilot Chat, pick one of the DeepSeek models
   (`deepseek-chat` / `deepseek-reasoner`) from the model picker.

You can optionally store the key in `settings.json` instead (not recommended):

```json
"deepseek.apiKey": "sk-..."
```

## Configuration

| Setting                  | Default                  | Description                              |
| ------------------------ | ------------------------ | ---------------------------------------- |
| `deepseek.apiKey`        | `""`                     | API key (prefer Secret Storage).         |
| `deepseek.baseUrl`       | `https://api.deepseek.com` | OpenAI-compatible base URL.           |
| `deepseek.defaultModel`  | `deepseek-chat`          | Model used when none is selected.        |
| `deepseek.temperature`   | `0.7`                    | Sampling temperature.                    |
| `deepseek.maxOutputTokens` | `8192`                 | Max tokens generated per response.       |

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
  - `Configuration/` — the `ManageCommand` use case.
  - `Composition/` — the manual DI container
    (`src/Application/Composition/Container.ts`).
- `src/Infrastructure` — adapters implementing the domain ports.
  - `Chat/` — the DeepSeek HTTP/SSE client.
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
