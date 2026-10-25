# Project Agent Guidelines

Apply the `karpathy-guidelines` skill when writing, reviewing, debugging, or
refactoring code in this repository. Read
[the full skill](.agents/skills/karpathy-guidelines/SKILL.md) before starting
those tasks.

Source: [forrestchang/andrej-karpathy-skills](https://github.com/forrestchang/andrej-karpathy-skills),
installed locally in `.agents/skills/karpathy-guidelines/`.

## Working principles

1. **Think before coding.** Explain assumptions and meaningful tradeoffs.
   Resolve ambiguity that affects the implementation before making changes.
2. **Keep solutions simple.** Implement the requested behavior with the least
   necessary complexity. Avoid speculative features and unnecessary abstractions.
3. **Keep changes focused.** Follow existing conventions. Only edit code needed
   for the task, and remove unused code introduced by your own changes.
4. **Verify the outcome.** Define observable success criteria, use a short plan
   for multi-step work, and run checks appropriate to the change. Report what
   was verified and any remaining limitations.

Use proportionate judgment for trivial changes.

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
