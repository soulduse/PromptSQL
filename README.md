# PromptSQL

An AI-powered MySQL client built with Tauri 2.x, React, and Rust.

<!-- ![PromptSQL Screenshot](docs/screenshot.png) -->

## Features

- **AI-Powered SQL Assistant** -- Chat with AI to generate and explain SQL queries
- **AUTO Mode** -- AI analyzes your schema and executes queries directly
- **Schema-Aware RAG** -- AI understands your database structure through `@table_name` mentions
- **Multi-Tab Interface** -- Work with multiple database connections simultaneously
- **Query Editor** -- Monaco-based SQL editor with syntax highlighting
- **Table Management** -- Browse, edit, and manage table data, structure, and indexes
- **Dark/Light Mode** -- Full theme support
- **Multi-Language** -- English, Korean, Japanese, and Chinese

## Supported AI Providers

- **OpenAI** -- GPT-4o, GPT-4o mini
- **Anthropic** -- Claude Sonnet, Claude Haiku
- **Google Gemini** -- Gemini Pro, Gemini Flash
- **Ollama** -- Local models (no API key required)

All API keys are stored securely in your system's native keychain (macOS Keychain, Windows Credential Manager, Linux Secret Service).

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 19, TypeScript, Tailwind CSS |
| Backend | Rust, Tauri 2.x |
| Database | MySQL (via mysql_async) |
| AI | Multi-provider SSE streaming |
| State | Zustand |
| Editor | Monaco Editor |

## Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [Rust](https://www.rust-lang.org/tools/install) (1.77.2+)
- [Tauri Prerequisites](https://v2.tauri.app/start/prerequisites/)

## Getting Started

```bash
# Clone the repository
git clone https://github.com/soulduse/PromptSQL.git
cd PromptSQL

# Install frontend dependencies
npm install

# Start development server
npm run tauri dev
```

## Building

```bash
npm run tauri build
```

The built application will be in `src-tauri/target/release/bundle/`.

## AI Provider Setup

1. Open Settings (gear icon)
2. Select your AI provider
3. Enter your API key
4. Choose a model

For Ollama, no API key is needed -- just make sure your Ollama server is running locally.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
