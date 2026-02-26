# Sam AI

A lightweight AI assistant built on [pi-coding-agent](https://github.com/mariozechner/pi-coding-agent). Sam is a Discord bot that provides an AI assistant in chat channels with access to filesystem tools, web search, and autonomous goal pursuit.

## Features

- **AI-powered assistance** - Powered by Claude and other models via pi-coding-agent
- **Filesystem tools** - Read, write, edit, bash, grep, find, ls
- **Web capabilities** - Web search and fetch
- **Autonomous goals** - Give Sam a high-level goal and he'll keep working on it
- **Pulse check-ins** - Periodic autonomous work cycles
- **Multi-platform ready** - ChatChannel interface for adding other platforms

## Installation

```bash
npm install -g sam-ai
```

## Configuration

1. Copy the example config:

```bash
cp config.yaml.example config.yaml
```

2. Edit `config.yaml` with your settings:
   - Discord bot token
   - Allowed channels
   - Workspace directory
   - Model configuration

3. Set environment variables (or use `.env`):

```bash
export DISCORD_TOKEN="your-bot-token"
export MODEL_API_KEY="your-api-key"
```

## Usage

```bash
# Run the bot
sam

# Or with custom config path
sam --config /path/to/config.yaml
```

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run in development mode
npm run dev
```

## Giving Sam Goals

You can give Sam high-level goals and he'll work on them autonomously:

```
@Sam I want you to build an app like letterly.app
```

Sam will:
1. Acknowledge the goal
2. Store it in `goal.md`
3. Start working on it
4. Continue making progress on each pulse cycle

## Architecture

- `src/index.ts` - Entry point
- `src/agent-factory.ts` - Creates pi-coding-agent sessions
- `src/dispatcher.ts` - Routes messages between channels and agents
- `src/channels/` - Chat platform integrations (Discord, Pulse)

## License

MIT
