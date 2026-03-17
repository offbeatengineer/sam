---
name: coding-agent
description: Delegate coding tasks to Claude Code via tmux. Use when a task requires focused code generation, refactoring, or file modifications in a specific directory. Also use this to implement, update, or refactor Kit functionality.
---

# Coding Agent (Claude Code via tmux)

Delegate coding work to `claude` — a CLI coding agent with read, bash, edit, and write tools. Run it inside `tmux` so it doesn't block your session.

## Starting a session

Always run Claude Code inside tmux. Use a descriptive session name.

```bash
# Start Claude Code in a project directory
tmux new-session -d -s coding -c ~/Projects/myapp 'claude --dangerously-skip-permissions'

# Send the first task
tmux send-keys -t coding 'Add input validation to the signup form' Enter
```

## Checking progress

```bash
# Read the current screen
tmux capture-pane -t coding -p

# Read with scrollback (last 500 lines)
tmux capture-pane -t coding -p -S -500
```

Poll periodically until Claude finishes (you'll see the `>` prompt again).

## Multi-turn conversation

Once Claude finishes a task, send follow-ups into the same session. Claude remembers all prior context.

```bash
# Send a follow-up
tmux send-keys -t coding 'Now add refresh token support' Enter

# And another
tmux send-keys -t coding 'Add tests for the refresh token flow' Enter
```

## Read-only mode

For code review or analysis without modifications:

```bash
tmux new-session -d -s review -c ~/Projects/myapp 'claude --allowedTools Read,Grep,Glob --dangerously-skip-permissions'
tmux send-keys -t review 'Review the error handling in src/api/' Enter
```

## Ending a session

```bash
# Gracefully exit Claude, then the tmux session closes automatically
tmux send-keys -t coding '/exit' Enter

# Or force-kill the session
tmux kill-session -t coding
```

## Kit development

When delegating kit work to Claude:

1. **Set the working directory to the kit**: `tmux new-session -d -s kit-<kitId> -c ~/.sam/kits/<kitId> 'claude --dangerously-skip-permissions'`
   - Claude will auto-discover `~/.sam/kits/AGENTS.md` in the parent directory for UI/backend/database guidelines
2. **After Claude finishes**, call `build` then `reload` via the `manage_kit` tool to make changes live
3. The kit scaffold is pre-configured for **shadcn/ui** — Claude can add components via `bunx shadcn@latest add <component>`

## Rules

1. **Always use `tmux`** — never run Claude directly, it will block your session.
2. **Always set `-c` (working directory)** when creating the tmux session — Claude works on the files around it.
3. **Send follow-ups to the same session** — Claude remembers all prior context within a session.
4. **Poll `capture-pane` to track progress** — check if Claude is still working or waiting for input.
5. **Don't do Claude's job** — if you delegate a coding task, let Claude handle it. Don't manually patch files that Claude should be editing.
6. **Report back** — after Claude finishes, summarize what it did for the user.
