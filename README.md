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

The code follows Clean Architecture:

- `src/Core` — domain models, business services, and ports (interfaces).
- `src/Infrastructure` — DeepSeek HTTP/SSE client, VS Code configuration and
  secret storage, logging.
- `src/Application` — provider orchestration and the manual DI container
  (`src/Application/DependencyInjection/Container.ts`).

## License

[MIT](LICENSE)
