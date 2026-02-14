---
name: coding-agent
description: Delegate coding tasks to Pi Coding Agent in non-interactive mode. Use when a task requires focused code generation, refactoring, or file modifications in a specific directory.
---

# Coding Agent (Pi non-interactive mode)

Delegate coding work to `pi` — a CLI coding agent with read, bash, edit, and write tools. Use its **non-interactive mode** (`-p`) so it runs the task and exits cleanly.

## Prerequisites

```bash
npm install -g @mariozechner/pi-coding-agent
```

## One-shot task

```bash
pi -p "Your task description"
```

Pi runs in the current working directory, executes the task, prints output, and exits.

## Working directory

Use `cd` to scope Pi to a specific project:

```bash
cd ~/Projects/myapp && pi -p "Add input validation to the signup form"
```

## Multi-turn sessions

Pi saves sessions automatically. Use `--continue` (`-c`) to pick up where you left off:

```bash
# First turn — start the task
cd ~/Projects/myapp && pi -p "Refactor the auth module to use JWT"

# Second turn — continue the same session with follow-up
cd ~/Projects/myapp && pi -c -p "Now add refresh token support"

# Third turn — continue again
cd ~/Projects/myapp && pi -c -p "Add tests for the refresh token flow"
```

Each `-c` resumes the most recent session in that directory, so Pi remembers all prior context (files read, edits made, decisions taken).

## Choosing a model

```bash
# Use a specific provider and model
pi --provider anthropic --model claude-sonnet-4-20250514 -p "Your task"

# Shorthand: provider/model
pi --model openai/gpt-4o -p "Your task"

# With thinking level
pi --model sonnet:high -p "Solve this complex problem"
```

## Read-only mode

For code review or analysis without modifications:

```bash
pi --tools read,grep,find,ls -p "Review the error handling in src/api/"
```

## Session management

```bash
# Continue most recent session
pi -c -p "Follow-up prompt"

# Use a specific session directory (useful for isolating projects)
pi --session-dir /tmp/my-task -p "Start a task"
pi --session-dir /tmp/my-task -c -p "Continue it"

# Ephemeral — don't save session at all
pi --no-session -p "Quick one-off question"
```

## Rules

1. **Always use `-p`** — Sam cannot run interactive terminal programs.
2. **Always `cd` to the target directory first** — Pi works on the files around it.
3. **Use `-c` for follow-ups** — don't repeat context the agent already knows.
4. **Don't do Pi's job** — if you delegate a coding task, let Pi handle it. Don't manually patch files that Pi should be editing.
5. **Report back** — after Pi finishes, summarize what it did for the user.
