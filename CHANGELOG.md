# Changelog

## [0.6.1](https://github.com/aq-natsuki-fukazawa/vscode-claude-code-conversations/compare/claude-code-conversations-v0.6.0...claude-code-conversations-v0.6.1) (2026-02-20)


### Bug Fixes

* /clear後のセッションで既存タブが検出されず新規タブが開く問題を修正 ([29d7044](https://github.com/aq-natsuki-fukazawa/vscode-claude-code-conversations/commit/29d7044e5c47cf6160d4400e61ee878d454cf626))
* worktree切り替え後のブランチ表示が反映されない問題を修正 ([f2e1417](https://github.com/aq-natsuki-fukazawa/vscode-claude-code-conversations/commit/f2e1417db380f8b13424de79ff24a4135fcc818c))
* 既存タブがあるセッションをクリックすると新規タブが開く問題を修正 ([2e66229](https://github.com/aq-natsuki-fukazawa/vscode-claude-code-conversations/commit/2e6622975523e3c0084a4e0d94e2dbfc615d124b))
* 短いテキスト応答(output_tokens=1)で待機状態が残り続ける問題を修正 ([f1adf87](https://github.com/aq-natsuki-fukazawa/vscode-claude-code-conversations/commit/f1adf87b8f570ebeceee29b7283e099b31ecef62))

## [0.6.0](https://github.com/aq-natsuki-fukazawa/vscode-claude-code-conversations/compare/claude-code-conversations-v0.5.1...claude-code-conversations-v0.6.0) (2026-02-20)


### Features

* output_tokensベースの中間プレースホルダー検出 ([337204f](https://github.com/aq-natsuki-fukazawa/vscode-claude-code-conversations/commit/337204f961cdc34d20b6b81251af58f048dc145a))
* readTailMetadataのテスト追加とstaleセッションの待機表示抑制 ([992d760](https://github.com/aq-natsuki-fukazawa/vscode-claude-code-conversations/commit/992d7601cdbc1aa508dee6f0271d9f0e2bace5e9))
* セッションIDコピー・リネーム・削除コマンドを追加 ([d0edca5](https://github.com/aq-natsuki-fukazawa/vscode-claude-code-conversations/commit/d0edca57f7851322906fcc5aa47f74ddbc748189))


### Bug Fixes

* ツール待機アイコンをwarningからalertに変更 ([4615d56](https://github.com/aq-natsuki-fukazawa/vscode-claude-code-conversations/commit/4615d56c46752c559832863dda06fb33ea7a237c))

## [0.5.1](https://github.com/aq-natsuki-fukazawa/vscode-claude-code-conversations/compare/claude-code-conversations-v0.5.0...claude-code-conversations-v0.5.1) (2026-02-18)


### Bug Fixes

* readTailMetadataをステートレスな待機検出に簡素化 ([fd150bc](https://github.com/aq-natsuki-fukazawa/vscode-claude-code-conversations/commit/fd150bcfe7a8bdf1a6bccd6421b0ab811e296e83))

## [0.5.0](https://github.com/aq-natsuki-fukazawa/vscode-claude-code-conversations/compare/claude-code-conversations-v0.4.0...claude-code-conversations-v0.5.0) (2026-02-18)


### Features

* ファイルアクティビティのチェック機能を改善 ([d7a81a2](https://github.com/aq-natsuki-fukazawa/vscode-claude-code-conversations/commit/d7a81a2f33afa33ff2e24a5aaf5eefc2f5009999))

## [0.4.0](https://github.com/aq-natsuki-fukazawa/vscode-claude-code-conversations/compare/claude-code-conversations-v0.3.0...claude-code-conversations-v0.4.0) (2026-02-18)


### Features

* カスタムタイトル機能を追加 ([f0c2ae2](https://github.com/aq-natsuki-fukazawa/vscode-claude-code-conversations/commit/f0c2ae2ddaf8227f8b7a84c5d3d98caddb34f69a))

## [0.3.0](https://github.com/aq-natsuki-fukazawa/vscode-claude-code-conversations/compare/claude-code-conversations-v0.2.0...claude-code-conversations-v0.3.0) (2026-02-17)


### Features

* upload .vsix asset to GitHub Release ([b0c3c1d](https://github.com/aq-natsuki-fukazawa/vscode-claude-code-conversations/commit/b0c3c1dab2676a2e9ee64995ba43853e5ecd1ef7))


### Bug Fixes

* filter tool_use waiting to permission-requiring tools only ([#3](https://github.com/aq-natsuki-fukazawa/vscode-claude-code-conversations/issues/3)) ([be14d66](https://github.com/aq-natsuki-fukazawa/vscode-claude-code-conversations/commit/be14d661106abe94446b2ac774b1e0bdcbd2253c))

## [0.2.0](https://github.com/aq-natsuki-fukazawa/vscode-claude-code-conversations/compare/claude-code-conversations-v0.1.0...claude-code-conversations-v0.2.0) (2026-02-17)


### Features

* initial commit ([87f54c6](https://github.com/aq-natsuki-fukazawa/vscode-claude-code-conversations/commit/87f54c6d0717f02f8a73994a15e6de3cbade70c6))
