# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

VSCode extension that provides a sidebar panel for browsing, searching, and managing past Claude Code conversations. It reads JSONL session files from `~/.claude/projects/`, detects real-time waiting states, and integrates with VSCode's tab system for session reuse.

## Commands

```bash
npm run compile      # TypeScript compilation (tsc -p ./)
npm run watch        # Watch mode for development
npm test             # Run all tests (vitest run)
npx vitest run src/conversationParser.test.ts  # Run single test file
npx vitest run -t "test name pattern"          # Run specific test by name
```

**Debugging:** Press F5 in VSCode to launch the Extension Development Host.

## Architecture

```
extension.ts          → Entry point: registers commands, tree views, file watcher (500ms debounce), periodic refresh (5s)
conversationProvider.ts → TreeView data provider: groups pinned/unpinned, handles filtering, renders icons by state
conversationParser.ts  → Core logic: JSONL parsing, metadata extraction, stateless waiting detection
tabSessionTracker.ts   → Tab reuse: reads VSCode's state.vscdb via sqlite3, maps sessionId↔tab, focuses existing tabs
pinManager.ts          → Persistence: reads/writes ~/.claude/conversation-pins.json
types.ts               → Shared interfaces: ConversationMeta, JnsonlMessage, ContentBlock
```

### Key Design Decisions

- **Stateless waiting detection** (`readTailMetadata`): Reads only the last 16KB of a JSONL file and walks backwards to determine if a session is waiting for user input or tool permission. No external state or cache.
- **Fast metadata extraction** (`parseConversationFileFast`): Reads only the first 30 lines of each JSONL file for title/sessionId/model/branch. Estimates message count from file size (~2KB per message).
- **Stale session suppression**: Sessions with no file activity for 5+ minutes suppress waiting indicators.
- **Tool permission delay**: `isToolUseWaiting` only activates after 3000ms to prevent UI flashing during fast tool execution.

### JSONL File Format

Session files live at `~/.claude/projects/{encodedProjectDir}/*.jsonl`. Each line is a JSON object with `type` field: `"user"`, `"assistant"`, `"summary"`, `"custom-title"`, `"file-history-snapshot"`, `"queue-operation"`. Key fields on messages: `message.role`, `message.content` (string or ContentBlock[]), `message.stop_reason`, `isSidechain`, `isMeta`, `timestamp`.

## Conventions

- **Conventional commits** enforced by commitlint + husky: `feat:`, `fix:`, `refactor:`, `test:`, `chore:`, etc.
- **Strict TypeScript** mode enabled.
- **Release automation** via release-please (reads conventional commits for semver bumps and CHANGELOG generation).
- Test descriptions are written in Japanese.
