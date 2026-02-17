# Claude Code Conversations

VSCode extension that adds an always-visible past conversations panel for Claude Code.

## Features

- Browse past Claude Code conversations for the current workspace
- Real-time status indicators:
  - Spinning icon for conversations waiting for Claude's response
  - Warning icon for conversations waiting for tool permission
- Pin/unpin conversations for quick access
- Search/filter conversations by title or branch name
- Click to open a conversation — reuses existing tab if already open
- Keyboard-driven navigation (Vim-style `j`/`k`, `p` to toggle pin)

## Keybindings

| Key     | Action                          |
|---------|---------------------------------|
| `Cmd+8` | Focus past conversations panel  |
| `j`     | Move down in list               |
| `k`     | Move up in list                 |
| `Enter` | Open selected conversation      |
| `p`     | Toggle pin on selected item     |

## Development

```bash
npm install
npm run compile
```

Press `F5` in VSCode to launch the Extension Development Host.

## Release

This project uses [release-please](https://github.com/googleapis/release-please) for automated versioning and changelog generation. Commit messages must follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add new feature        → minor version bump
fix: fix a bug               → patch version bump
feat!: breaking change       → major version bump
chore: maintenance task      → no version bump
```

When commits are pushed to `main`, release-please automatically creates a Release PR with version bump and changelog updates. Merging the PR creates a Git tag and GitHub Release.
