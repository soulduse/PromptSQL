# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

PromptSQL is an AI-powered MySQL client built with Tauri 2.x. It features a React/TypeScript frontend with a Rust backend for database operations and AI integrations.

## Development Commands

```bash
# Start development server (frontend + Tauri)
npm run tauri dev

# Build for production
npm run tauri build

# Type check
npx tsc

# Rust-only commands (run from src-tauri/)
cargo check    # Type check Rust code
cargo test     # Run Rust tests
```

### App Process Management

**Important**: The app binary name is `PromptSQL` (not `ai-db`).

When restarting the dev server, first check if the app is already running:
```bash
# Check running processes
pgrep -fl "PromptSQL"

# If running, kill it first, then start
pkill -f "PromptSQL" && npm run tauri dev

# If not running, just start
npm run tauri dev
```

**Do NOT** run `npm run tauri dev` in background while another instance is running - this causes duplicate app windows.

## Architecture

### Frontend (React + TypeScript)
- **Entry**: `src/main.tsx` → `src/App.tsx`
- **State Management**: Zustand stores in `src/stores/`
  - `connectionStore.ts` - MySQL connection state
  - `tabStore.ts` - Tab management and query execution
  - `aiStore.ts` - AI panel and chat state
  - `historyStore.ts` - Query history
- **Components**: `src/components/` organized by feature
  - `ai/` - AI chat panel, messages, code blocks
  - `connection/` - Connection modal, welcome screen
  - `table/` - Table views (content, structure, info)
  - `schema/` - Table list, info panel, export modals
  - `editor/` - Monaco-based query editor
- **i18n**: `src/i18n/locales/` with en, ko, ja, zh translations

### Backend (Rust/Tauri)
- **Entry**: `src-tauri/src/main.rs` → `src-tauri/src/lib.rs`
- **Commands**: `src-tauri/src/commands.rs` - All Tauri IPC commands
- **Database**: `src-tauri/src/db/` - MySQL connection via sqlx
- **AI Module**: `src-tauri/src/ai/`
  - `providers/` - OpenAI, Anthropic, Gemini, Ollama implementations
  - `streaming.rs` - SSE streaming for AI responses
  - `conversations.rs` - Chat history persistence
  - `rag.rs` - RAG indexing for schema context
  - `router.rs` - Model routing logic
  - `prompt.rs` - System prompts
- **Storage**: `src-tauri/src/storage/` - Connection and history persistence

### Frontend-Backend Communication
Commands are invoked via `invoke()` from `@tauri-apps/api/core`. AI streaming uses Tauri events with `listen()`.

## Key Patterns

- **Tab-based UI**: Each database connection opens in a tab with its own state
- **AI Chat Panel**: Toggleable with Cmd+K, supports schema mentions with `@table_name`
- **Query Editor**: Monaco editor with SQL syntax highlighting
- **Multi-provider AI**: Supports OpenAI, Anthropic, Gemini, and Ollama with streaming responses

## Styling

Tailwind CSS with dark/light mode support. Theme classes are toggled on `document.documentElement`.

## Internationalization (i18n) Guidelines

- **Never hardcode text** in components. Always use `useTranslation()` hook and `t()` function
- **Supported languages**: en, ko, ja, zh (located in `src/i18n/locales/`)
- **When adding new text**: Add keys to ALL language files (en.json, ko.json, ja.json, zh.json)
- **Default language**: English (en.json) - if unsure of translations, write English values as placeholders
- **Key naming**: Use dot notation for nested keys (e.g., `connection.failed`, `table.noData`)
