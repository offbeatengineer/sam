---
name: playwright-cli
description: Browser automation using Playwright CLI. Use for web navigation, form filling, screenshots, and any task requiring browser interaction. Login sessions persist across tasks.
metadata:
  author: sam
  version: "1.0"
---

# Playwright CLI Browser Automation

Automate browsers using the `playwright-cli` command-line tool.

## Installation

The CLI must be installed globally:
```bash
npm install -g @playwright/cli@latest
```

## Configuration

Always use the Sam session name and config file:
```bash
playwright-cli --session sam --config ~/.sam/playwright-cli.json <command>
```

**Important:** Always include `--session sam` in your commands. This ensures:
- All Sam tasks share the same browser session
- Login sessions persist across tasks
- User data is stored at `~/.sam/playwright/`

## Downloads

All browser downloads are automatically saved to:
```
~/.sam/playwright/downloads/
```

After triggering a download in the browser, the file will be available at this location. Use standard file system commands to access or move downloaded files.

## Core Commands

### Navigation
```bash
playwright-cli open <url>           # Open URL
playwright-cli session-stop sam # Stop session
playwright-cli go-back              # Navigate back
playwright-cli go-forward           # Navigate forward
playwright-cli reload               # Refresh page
```

### Interaction
```bash
playwright-cli click <ref>          # Click element
playwright-cli type <text>          # Type text (use after focusing)
playwright-cli fill <ref> <text>    # Fill input field
playwright-cli press <key>          # Press key (Enter, Tab, etc.)
playwright-cli check <ref>          # Check checkbox
playwright-cli uncheck <ref>        # Uncheck checkbox
playwright-cli select <ref> <val>   # Select dropdown option
playwright-cli hover <ref>          # Hover over element
```

### Output
```bash
playwright-cli screenshot           # Full page screenshot
playwright-cli screenshot <ref>     # Element screenshot
playwright-cli pdf                  # Generate PDF
```

### Tab Management
```bash
playwright-cli tab-list             # List all tabs
playwright-cli tab-new [url]        # Open new tab
playwright-cli tab-close [index]    # Close tab
playwright-cli tab-select <index>   # Switch to tab
```

### DevTools
```bash
playwright-cli console              # Show console logs
playwright-cli network              # Show network requests
```

## Element References

Elements are referenced by their accessibility snapshot ref numbers. First get the page state:
```bash
playwright-cli snapshot             # Get accessibility tree with refs
```

Then use the ref number:
```bash
playwright-cli click [12]           # Click element with ref 12
playwright-cli fill [5] "hello"     # Fill input ref 5
```

## Options

```bash
--session <name>                    # Session name (always use "sam")
--headed                            # Show browser window (CLI default is headless)
--config <path>                     # Config file (use ~/.sam/playwright-cli.json)
```

Note: The Sam config sets `headless: false`, so browsers are visible by default.

## Workflow Example

1. Open a page and get its structure:
   ```bash
   playwright-cli --session sam --config ~/.sam/playwright-cli.json open https://example.com
   playwright-cli snapshot
   ```

2. Interact based on refs from snapshot:
   ```bash
   playwright-cli fill [3] "username"
   playwright-cli fill [5] "password"
   playwright-cli click [7]
   ```

3. Capture result:
   ```bash
   playwright-cli screenshot
   ```

4. Stop the session when done:
   ```bash
   playwright-cli session-stop sam
   ```

Note: After `open`, subsequent commands use the active "sam" session - no need to repeat `--session` or `--config`.

## Best Practices

1. **Always snapshot first** - Get element refs before interacting
2. **Check results** - Screenshot or snapshot after actions to verify
3. **Handle waits** - The CLI waits for navigation automatically
4. **Sessions persist** - Login once, stay logged in across all Sam tasks
5. **Always stop session when done** - Run `playwright-cli session-stop sam` when you're finished with browser tasks. Failing to stop the session will cause subsequent playwright commands to fail

## Authentication & Login

Some actions require user authentication (e.g., accessing internal portals, corporate tools).

**When you encounter a login page:**
1. Ask the user: "This page requires authentication. Please log in manually in the browser window, then let me know when you're done."
2. Wait for user confirmation before continuing
3. After login, sessions persist - you won't need to log in again for this site

**Example interaction:**
```
AI: I've opened the portal but it requires authentication. Please log in manually in the browser window and let me know when you're done.
User: Done, I'm logged in now.
AI: Great! Let me continue with the task...
```
