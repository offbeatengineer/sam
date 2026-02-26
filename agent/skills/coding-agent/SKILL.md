---
name: coding-agent
description: Delegate coding tasks to Pi Coding Agent via tmux. Use when a task requires focused code generation, refactoring, or file modifications in a specific directory.
---

# Coding Agent (Pi via tmux)

Delegate coding work to `pi` — a CLI coding agent with read, bash, edit, and write tools. Run it inside `tmux` so it doesn't block your session.

## Prerequisites

```bash
npm install -g @mariozechner/pi-coding-agent
```

## Starting a session

Always run Pi inside tmux. Use a descriptive session name.

```bash
# Start Pi in a project directory
tmux new-session -d -s coding -c ~/Projects/myapp 'pi'

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

Poll periodically until Pi finishes (you'll see the `>` prompt again).

## Multi-turn conversation

Once Pi finishes a task, send follow-ups into the same session. Pi remembers all prior context.

```bash
# Send a follow-up
tmux send-keys -t coding 'Now add refresh token support' Enter

# And another
tmux send-keys -t coding 'Add tests for the refresh token flow' Enter
```

## Read-only mode

For code review or analysis without modifications:

```bash
tmux new-session -d -s review -c ~/Projects/myapp 'pi --tools read,grep,find,ls'
tmux send-keys -t review 'Review the error handling in src/api/' Enter
```

## Ending a session

```bash
# Gracefully exit Pi, then the tmux session closes automatically
tmux send-keys -t coding '/exit' Enter

# Or force-kill the session
tmux kill-session -t coding
```

## Rules

1. **Always use `tmux`** — never run Pi directly, it will block your session.
2. **Always set `-c` (working directory)** when creating the tmux session — Pi works on the files around it.
3. **Send follow-ups to the same session** — Pi remembers all prior context within a session.
4. **Poll `capture-pane` to track progress** — check if Pi is still working or waiting for input.
5. **Don't do Pi's job** — if you delegate a coding task, let Pi handle it. Don't manually patch files that Pi should be editing.
6. **Report back** — after Pi finishes, summarize what it did for the user.
