---
name: configure-obsidian
description: Configure Obsidian vault integration for persistent knowledge management
triggers:
  - "configure obsidian"
  - "setup obsidian"
  - "obsidian integration"
  - "obsidian vault"
---

# Configure Obsidian Integration

Set up Obsidian vault integration so OMC agents can read, write, and search notes in your Obsidian vault. Requires Obsidian 1.12.4+ with CLI enabled.

## How This Skill Works

This is an interactive configuration skill. Walk the user through setup by asking questions with AskUserQuestion. The result is stored as environment variables or in `~/.claude/.omc-config.json`.

## Step 1: Detect Obsidian CLI

```bash
# Check if obsidian CLI is available
if command -v obsidian &> /dev/null; then
  VERSION=$(obsidian version 2>&1 | head -1)
  echo "OBSIDIAN_DETECTED=true"
  echo "OBSIDIAN_VERSION=$VERSION"
else
  echo "OBSIDIAN_DETECTED=false"
fi
```

If Obsidian CLI is not detected, inform the user:

```
Obsidian CLI not found. To enable it:
1. Install Obsidian from https://obsidian.md (version 1.12.4+)
2. Open Obsidian → Settings → General → Command Line Interface
3. Click "Register CLI"
4. Restart your terminal
```

Then stop — do not proceed without CLI.

## Step 2: Discover Vaults

```bash
# List available vaults from Obsidian config
obsidian vault 2>&1
```

Parse the output to get vault names and paths. Present them to the user:

**Question via AskUserQuestion:** "Which vault should OMC use for knowledge storage?"

Show discovered vaults as numbered options. If the user has multiple vaults, recommend using a dedicated "Dev" vault to keep personal notes separate.

## Step 3: Validate Vault Access

Run a connectivity test:

```bash
# Test read access
obsidian files total vault="<selected-vault>" 2>&1

# Test search
obsidian search query="test" limit=1 vault="<selected-vault>" 2>&1
```

If tests fail, report the error and suggest:
- Ensure Obsidian app is running
- Check that the vault is open in Obsidian
- Try restarting Obsidian

## Step 4: Configure Allowed Folders (Optional)

**Question via AskUserQuestion:** "Should OMC agents be restricted to specific folders in your vault? (Recommended: yes)"

If yes, ask which folders. Suggest defaults:
- `OMC/` — Agent-generated content
- `Projects/` — Project-specific notes
- `Research/` — Analysis and research reports

## Step 5: Save Configuration

### Option A: Environment Variable (Simple)

```bash
# Add to shell profile — vault path for auto-discovery
echo 'export OMC_OBSIDIAN_VAULT="<vault-path>"' >> ~/.zshrc

# Optional: explicit vault name (used for CLI vault= parameter)
echo 'export OMC_OBSIDIAN_VAULT_NAME="<vault-name>"' >> ~/.zshrc
```

### Option B: Config File (Full)

Write to `~/.claude/.omc-config.json` (this is what the configure skill writes):

```bash
CONFIG_FILE="$HOME/.claude/.omc-config.json"

# Read existing config or create empty
if [ -f "$CONFIG_FILE" ]; then
  EXISTING=$(cat "$CONFIG_FILE")
else
  EXISTING="{}"
fi

# Merge obsidian config
echo "$EXISTING" | jq --arg vaultPath "<vault-path>" --arg vaultName "<vault-name>" '. + {
  "obsidian": {
    "enabled": true,
    "vaultPath": $vaultPath,
    "vaultName": $vaultName,
    "allowedFolders": ["OMC/", "Projects/", "Research/"]
  }
}' > "$CONFIG_FILE"
```

### Configuration Resolution Order

The runtime resolves vault configuration in this order:
1. `OMC_OBSIDIAN_VAULT` / `OMC_OBSIDIAN_VAULT_NAME` env vars (highest priority)
2. `~/.claude/.omc-config.json` obsidian section (`vaultPath`, `vaultName`)
3. Auto-discovery from `~/Library/Application Support/obsidian/obsidian.json` (prefers open vault)

### Disabling

To disable Obsidian tools without removing configuration:
```bash
export OMC_DISABLE_TOOLS=obsidian
```

## Step 6: Test Integration

Run a full round-trip test:

```bash
# Create a test note (uses path to respect allowedFolders)
obsidian create name="OMC-Integration-Test" path="OMC/" content="# Test Note\n\nCreated by OMC configure-obsidian skill." vault="<vault>"

# Read it back
obsidian read file="OMC/OMC-Integration-Test.md" vault="<vault>"

# Search for it
obsidian search query="OMC-Integration-Test" vault="<vault>"

# Clean up (manual — delete is not exposed to agents for safety)
# Delete the test note via Obsidian UI or CLI directly
```

If all steps succeed, show:

```
✓ Obsidian integration configured successfully!

Vault: <vault-name> (<vault-path>)
Version: <version>
Tools available: obsidian_search, obsidian_read, obsidian_create, obsidian_append,
                 obsidian_daily_read, obsidian_daily_append, obsidian_property_set,
                 obsidian_backlinks

Environment variable alternative (add to ~/.zshrc):
  export OMC_OBSIDIAN_VAULT="<vault-path>"

Agents can now use Obsidian tools via mcp__t__obsidian_*
```

## Step 7: Install Content Authorship Skills (Optional)

kepano (Obsidian CEO) provides official skills that teach Claude how to write proper Obsidian content. These complement the MCP tools by adding knowledge of Obsidian-specific syntax.

**Ask via AskUserQuestion:** "Would you like to install Obsidian content authorship skills? These teach Claude proper wikilink syntax, callout formatting, Bases queries, and Canvas diagrams. (Recommended: yes)"

If yes, install the following skills (NOT obsidian-cli — it conflicts with the MCP tools):

```bash
# Install content authorship skills from kepano/obsidian-skills
# Note: obsidian-cli SKILL.md is excluded — MCP tools handle CLI operations
claude mcp add-skill kepano/obsidian-skills/obsidian-markdown
claude mcp add-skill kepano/obsidian-skills/obsidian-bases
claude mcp add-skill kepano/obsidian-skills/json-canvas
```

If the marketplace approach is available:
```bash
/plugin marketplace add kepano/obsidian-skills
```

Then selectively enable only content skills (NOT obsidian-cli):
- obsidian-markdown ✓ (wikilinks, callouts, properties, embeds)
- obsidian-bases ✓ (DB views, filters, formulas)
- json-canvas ✓ (visual diagrams)
- obsidian-cli ✗ (excluded — MCP tools provide this with security guardrails)
- defuddle ✗ (optional, separate from Obsidian integration)

If the user declines, note:
```
Skipped. You can install content skills later:
  /plugin marketplace add kepano/obsidian-skills
See: https://github.com/kepano/obsidian-skills
```

## Step 8: Show Quick Start Guide

After successful configuration, display:

```markdown
## Quick Start

### Search your vault
Agents can search notes: `obsidian_search(query="architecture")`

### Create notes from agents
Scientist reports can be saved: `obsidian_create(name="Research Report", content="...")`

### Daily notes
Append to daily note: `obsidian_daily_append(content="- Completed feature X")`

### Content Skills
If not installed during setup, add content authorship skills:
  /plugin marketplace add kepano/obsidian-skills
Note: Only obsidian-markdown, obsidian-bases, and json-canvas are recommended.
The obsidian-cli skill is not needed when MCP tools are active.

### Write Obsidian-native content
If content skills are installed, agents will use:
- Wikilinks `[[Note Name]]` for internal references (not markdown links)
- Callouts `> [!info]` for highlighted information
- Properties (YAML frontmatter) with `tags`, `created`, `status`
- Bases views for data aggregation
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Unable to connect to main process" | Restart Obsidian app, then retry |
| CLI not found after install | Run `obsidian` once to register, restart terminal |
| Empty search results | Ensure vault has notes and Obsidian is running |
| Permission denied | Check vault path permissions |
| Timeout errors | Obsidian may be updating; wait and retry |
