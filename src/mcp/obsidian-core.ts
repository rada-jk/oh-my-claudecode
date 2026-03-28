/**
 * Obsidian Core Business Logic - Shared between SDK and Standalone MCP servers
 *
 * This module contains all the business logic for Obsidian CLI integration:
 * - Constants and configuration
 * - CLI execution with timeout handling
 * - Vault configuration and auto-discovery
 * - Tool handler functions for each Obsidian operation
 *
 * This module is SDK-agnostic and can be imported by both:
 * - omc-tools-server.ts (in-process SDK MCP server)
 * - standalone-server.ts (stdio-based external process server)
 */

import { spawn } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';
import { detectObsidianCli } from './obsidian-detection.js';

// Constants
export const OBSIDIAN_TIMEOUT = 10000; // 10s - CLI should be fast
export const OBSIDIAN_MAX_OUTPUT = 500 * 1024; // 500KB output cap

/**
 * Simple stdout collector with size cap to prevent memory exhaustion.
 */
function createStdoutCollector(maxBytes: number) {
  let buffer = '';
  let size = 0;
  return {
    append(chunk: string) {
      if (size < maxBytes) {
        buffer += chunk.slice(0, maxBytes - size);
        size += chunk.length;
      }
    },
    toString() { return buffer; },
  };
}
const MAX_CONTENT_SIZE = 100 * 1024; // 100KB content limit
const MAX_STDERR = 64 * 1024; // 64KB stderr cap

// HIGH 2: 'delete' removed — destructive operations must not be exposed to agents.
// Use Obsidian UI or CLI directly for deletions.
const ALLOWED_SUBCOMMANDS = new Set([
  'search', 'read', 'create', 'append',
  'daily:read', 'daily:append', 'property:set', 'backlinks',
  'vault', 'version', 'files', 'help',
]);

type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

/**
 * Get the platform-specific path to Obsidian's app config file.
 */
function getObsidianAppConfigPath(): string {
  switch (process.platform) {
    case 'darwin':
      return join(homedir(), 'Library', 'Application Support', 'obsidian', 'obsidian.json');
    case 'win32':
      return join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'obsidian', 'obsidian.json');
    default: // linux and others
      return join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'obsidian', 'obsidian.json');
  }
}

/**
 * Validate a file path for safety (no absolute paths, traversal, or null bytes).
 * Returns an error message string if invalid, or null if valid.
 * HIGH 3: accepts allowedFolders as parameter instead of reading config internally.
 */
function validateFilePath(filePath: string, allowedFolders?: string[]): string | null {
  if (filePath.startsWith('/') || filePath.startsWith('\\') || /^[A-Za-z]:/.test(filePath)) {
    return 'Absolute paths are not allowed. Use vault-relative paths.';
  }
  if (filePath.includes('..')) {
    return 'Path traversal ("..") is not allowed.';
  }
  if (filePath.includes('\0')) {
    return 'Invalid characters in path.';
  }

  // Enforce allowedFolders if provided
  if (allowedFolders && allowedFolders.length > 0) {
    const normalizedPath = filePath.replace(/\\/g, '/');
    const isAllowed = allowedFolders.some(folder => {
      const normalizedFolder = folder.replace(/\\/g, '/');
      return normalizedPath.startsWith(normalizedFolder);
    });
    if (!isAllowed) {
      return `Access restricted: path must be within allowed folders (${allowedFolders.join(', ')}).`;
    }
  }

  return null;
}

/**
 * MEDIUM 2: Validate a note name (for create). Checks for null bytes and path separators
 * but NOT allowedFolders (name is not a path).
 */
function validateNoteName(name: string): string | null {
  if (name.includes('\0')) return 'Invalid characters in note name.';
  if (name.includes('/') || name.includes('\\')) {
    return 'Note name cannot contain path separators. Use "path" parameter for vault-relative location.';
  }
  return null;
}

/**
 * Get vault configuration from environment, OMC config, or auto-discovery.
 *
 * Resolution order:
 * 1. OMC_OBSIDIAN_VAULT env var (path) / OMC_OBSIDIAN_VAULT_NAME env var (name)
 * 2. ~/.claude/.omc-config.json obsidian section (vaultPath, vaultName)
 * 3. ~/Library/Application Support/obsidian/obsidian.json (auto-discovery)
 */
interface VaultConfig {
  vaultPath?: string;
  vaultName?: string;
  allowedFolders?: string[];
}

/**
 * MEDIUM 5: Reads config file once and extracts allowedFolders inline.
 * HIGH 5: Also exposes enabled state so handlers can check it.
 */
export function getVaultConfig(): VaultConfig {
  // Read .omc-config.json once for both allowedFolders and vault config
  let omcObsidianConfig: Record<string, unknown> | undefined;
  try {
    const omcConfigPath = join(homedir(), '.claude', '.omc-config.json');
    if (existsSync(omcConfigPath)) {
      const omcConfig = JSON.parse(readFileSync(omcConfigPath, 'utf-8'));
      omcObsidianConfig = omcConfig?.obsidian;
    }
  } catch { /* best-effort */ }

  // Extract allowedFolders from the single config read
  let allowedFolders: string[] | undefined;
  if (omcObsidianConfig) {
    const folders = omcObsidianConfig.allowedFolders;
    if (Array.isArray(folders) && folders.length > 0) allowedFolders = folders as string[];
  }

  // 1. Environment variables (highest priority)
  const envVault = process.env.OMC_OBSIDIAN_VAULT;
  const envVaultName = process.env.OMC_OBSIDIAN_VAULT_NAME;
  if (envVault || envVaultName) {
    return { vaultPath: envVault, vaultName: envVaultName, allowedFolders };
  }

  // 2. OMC config file (~/.claude/.omc-config.json)
  if (omcObsidianConfig) {
    // If explicitly disabled, return empty immediately — do NOT fall through to auto-discovery
    if (omcObsidianConfig.enabled === false) {
      return {};
    }
    if (omcObsidianConfig.vaultPath || omcObsidianConfig.vaultName) {
      return {
        vaultPath: omcObsidianConfig.vaultPath as string | undefined,
        vaultName: omcObsidianConfig.vaultName as string | undefined,
        allowedFolders,
      };
    }
  }

  // 3. Obsidian app config (auto-discovery, platform-aware)
  try {
    const obsidianConfigPath = getObsidianAppConfigPath();
    if (existsSync(obsidianConfigPath)) {
      const config = JSON.parse(readFileSync(obsidianConfigPath, 'utf-8'));
      const vaults = config?.vaults;
      if (vaults && typeof vaults === 'object') {
        const entries = Object.values(vaults) as Array<{ path?: string; open?: boolean }>;
        // Prefer the open vault, otherwise first entry
        const openVault = entries.find(v => v.open);
        const firstVault = openVault || entries[0];
        if (firstVault?.path) {
          return { vaultPath: firstVault.path, allowedFolders };
        }
      }
    }
  } catch {
    // Auto-discovery is best-effort
  }

  return {};
}

/**
 * HIGH 5: Check if Obsidian integration is explicitly disabled in config.
 */
function isObsidianEnabled(): boolean {
  try {
    const omcConfigPath = join(homedir(), '.claude', '.omc-config.json');
    if (existsSync(omcConfigPath)) {
      const omcConfig = JSON.parse(readFileSync(omcConfigPath, 'utf-8'));
      if (omcConfig?.obsidian?.enabled === false) return false;
    }
  } catch { /* best-effort */ }
  return true;
}

/**
 * Build CLI args with optional vault targeting.
 * IMPORTANT: Obsidian CLI requires vault= as the FIRST parameter, before the subcommand.
 * e.g. buildArgs('search', { query: 'test', limit: 10, vault: 'Dev' })
 * -> ['vault=Dev', 'search', 'query=test', 'limit=10']
 */
export function buildArgs(
  command: string,
  params: Record<string, string | number | boolean | undefined>
): string[] {
  const args: string[] = [];

  // vault= must come first (before the subcommand) per Obsidian CLI spec
  if (params.vault !== undefined && params.vault !== false) {
    args.push(`vault=${String(params.vault)}`);
  }

  // Then the subcommand
  args.push(command);

  // Then all other parameters
  for (const [key, value] of Object.entries(params)) {
    if (key === 'vault') continue; // already handled above
    if (value === undefined || value === false) continue;
    if (value === true) {
      args.push(key);
    } else if (key === 'content' && typeof value === 'string') {
      // Obsidian CLI uses \n for newline and \t for tab in content values.
      // spawn() passes this as a single argv entry, safe from shell injection.
      const escaped = value.replace(/\n/g, '\\n').replace(/\t/g, '\\t');
      args.push(`${key}=${escaped}`);
    } else {
      args.push(`${key}=${String(value)}`);
    }
  }
  return args;
}

/**
 * Execute an obsidian CLI command and return raw output.
 * Uses spawn with stdout collector pattern matching gemini-core.ts.
 */
export async function execObsidianCli(
  args: string[],
  timeout: number = OBSIDIAN_TIMEOUT
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  // Subcommand allowlist: extract first arg that isn't vault=
  const subcommand = args.find(a => !a.startsWith('vault='));
  if (subcommand && !ALLOWED_SUBCOMMANDS.has(subcommand)) {
    return {
      stdout: '',
      stderr: `Blocked subcommand: ${subcommand}. Only ${[...ALLOWED_SUBCOMMANDS].join(', ')} are allowed.`,
      exitCode: 1,
    };
  }

  return new Promise((resolve) => {
    const collector = createStdoutCollector(OBSIDIAN_MAX_OUTPUT);
    let stderr = '';
    let stderrSize = 0;

    const child = spawn('obsidian', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout,
      // shell: true needed on Windows for .cmd/.bat executables.
      // Safe: args are array-based, no shell interpretation risk.
      ...(process.platform === 'win32' ? { shell: true } : {}),
    });

    child.stdout.on('data', (chunk: Buffer) => {
      collector.append(chunk.toString());
    });

    child.stderr.on('data', (chunk: Buffer) => {
      const str = chunk.toString();
      if (stderrSize < MAX_STDERR) {
        stderr += str.slice(0, MAX_STDERR - stderrSize);
        stderrSize += str.length;
      }
    });

    child.on('close', (code) => {
      resolve({ stdout: collector.toString(), stderr, exitCode: code ?? 1 });
    });

    child.on('error', (err) => {
      resolve({ stdout: '', stderr: err.message, exitCode: 1 });
    });
  });
}

/**
 * Helper to resolve file/path parameter (tools accept either `file` or `path`)
 */
function resolveFilePath(args: { file?: string; path?: string }): string | undefined {
  return args.file ?? args.path;
}

/**
 * Helper to create an error result when CLI is not available
 */
function cliUnavailableError(installHint: string): ToolResult {
  return {
    content: [{ type: 'text', text: `Obsidian CLI is not available. ${installHint}` }],
    isError: true,
  };
}

/**
 * Helper to create an error result from CLI execution failure
 */
function cliErrorResult(stderr: string, stdout: string): ToolResult {
  const message = stderr.trim() || stdout.trim() || 'Unknown error';
  return {
    content: [{ type: 'text', text: `Obsidian CLI error: ${message}` }],
    isError: true,
  };
}

/**
 * Unified CLI result checker. Catches both non-zero exit codes
 * AND exit-code-0 errors where CLI writes "Error:" to stdout.
 *
 * Set contentMayStartWithError=true for read operations (read, daily:read)
 * where note content legitimately starts with "Error:" — in those cases,
 * only exitCode is checked, not stdout prefix.
 */
function checkCliResult(
  result: { stdout: string; stderr: string; exitCode: number },
  contentMayStartWithError = false
): ToolResult | null {
  if (result.exitCode !== 0) return cliErrorResult(result.stderr, result.stdout);
  if (!contentMayStartWithError && result.stdout.startsWith('Error:')) {
    return { content: [{ type: 'text', text: result.stdout.trim() }], isError: true };
  }
  return null;
}

/**
 * HIGH 5: Guard that returns an error ToolResult if Obsidian is disabled.
 * Returns null when enabled (callers should proceed).
 */
function checkEnabled(): ToolResult | null {
  if (!isObsidianEnabled()) {
    return { content: [{ type: 'text', text: 'Obsidian integration is disabled in configuration.' }], isError: true };
  }
  return null;
}

/**
 * Helper to resolve vault parameter, falling back to auto-discovery.
 * Obsidian CLI accepts vault name (not path) via vault= parameter.
 *
 * SECURITY: When a vault is explicitly configured (via env var or .omc-config.json),
 * the agent-provided vault parameter is intentionally ignored. This prevents agents
 * from accessing vaults they shouldn't (e.g., a "Personal" vault with private data).
 * The vault tool parameter only takes effect when NO vault is configured.
 */
/**
 * Validate vault name to prevent shell metacharacter injection on Windows.
 * Only allows alphanumeric, spaces, hyphens, underscores.
 */
function validateVaultName(name: string): string | null {
  if (!/^[a-zA-Z0-9\s\-_]+$/.test(name)) {
    return 'Invalid vault name: only alphanumeric characters, spaces, hyphens, and underscores are allowed.';
  }
  return null;
}

/**
 * HIGH 4: Returns { vault, error } instead of silently swallowing validation errors.
 * When validation fails, callers get an explicit error message to return to the agent.
 */
function resolveVaultOrError(vault?: string): { vault?: string; error?: string } {
  const config = getVaultConfig();
  const configuredVault = config.vaultName || (config.vaultPath ? basename(config.vaultPath) : undefined);

  // If a vault is explicitly configured, always use it (ignore agent-provided vault)
  const resolved = configuredVault || vault;
  if (resolved) {
    const validationError = validateVaultName(resolved);
    if (validationError) return { error: validationError };
    return { vault: resolved };
  }

  // No vault specified — CLI uses default
  return { vault: undefined };
}

/**
 * Search notes in Obsidian vault by keyword.
 */
export async function handleObsidianSearch(
  args: { query: string; limit?: number; vault?: string }
): Promise<ToolResult> {
  const disabled = checkEnabled();
  if (disabled) return disabled;

  const detection = detectObsidianCli();
  if (!detection.available) return cliUnavailableError(detection.installHint);

  const { vault, error: vaultError } = resolveVaultOrError(args.vault);
  if (vaultError) return { content: [{ type: 'text', text: `Error: ${vaultError}` }], isError: true };

  const cliArgs = buildArgs('search', {
    query: args.query,
    limit: args.limit,
    vault,
  });

  const result = await execObsidianCli(cliArgs);
  const cliError = checkCliResult(result);
  if (cliError) return cliError;

  // CRITICAL 2: Filter search results against allowedFolders
  const config = getVaultConfig();
  if (config.allowedFolders?.length && result.stdout) {
    const lines = result.stdout.split('\n').filter(line =>
      line.trim() === '' || config.allowedFolders!.some(f => line.startsWith(f))
    );
    return { content: [{ type: 'text', text: lines.join('\n') || 'No results found.' }] };
  }

  return { content: [{ type: 'text', text: result.stdout || 'No results found.' }] };
}

/**
 * Read the full content of an Obsidian note.
 */
export async function handleObsidianRead(
  args: { file?: string; path?: string; vault?: string }
): Promise<ToolResult> {
  const disabled = checkEnabled();
  if (disabled) return disabled;

  const detection = detectObsidianCli();
  if (!detection.available) return cliUnavailableError(detection.installHint);

  const filePath = resolveFilePath(args);
  if (!filePath) {
    return { content: [{ type: 'text', text: 'Error: file or path parameter is required.' }], isError: true };
  }
  const config = getVaultConfig();
  const pathError = validateFilePath(filePath, config.allowedFolders);
  if (pathError) {
    return { content: [{ type: 'text', text: `Error: ${pathError}` }], isError: true };
  }

  const { vault, error: vaultError } = resolveVaultOrError(args.vault);
  if (vaultError) return { content: [{ type: 'text', text: `Error: ${vaultError}` }], isError: true };

  const cliArgs = buildArgs('read', {
    file: filePath,
    vault,
  });

  const result = await execObsidianCli(cliArgs);
  const cliError = checkCliResult(result, true); // contentMayStartWithError: note content can start with "Error:"
  if (cliError) return cliError;
  return { content: [{ type: 'text', text: result.stdout || '(empty note)' }] };
}

/**
 * Create a new note in Obsidian vault.
 * Silent by default (does not open in Obsidian UI when `open` is not specified).
 */
export async function handleObsidianCreate(
  args: { name: string; path?: string; content?: string; template?: string; overwrite?: boolean; vault?: string }
): Promise<ToolResult> {
  const disabled = checkEnabled();
  if (disabled) return disabled;

  const detection = detectObsidianCli();
  if (!detection.available) return cliUnavailableError(detection.installHint);

  // MEDIUM 2: Validate name as a note title, not a file path
  const nameError = validateNoteName(args.name);
  if (nameError) {
    return { content: [{ type: 'text', text: `Error: ${nameError}` }], isError: true };
  }
  const config = getVaultConfig();
  // When allowedFolders is configured, path is required to enforce folder boundary
  if (config.allowedFolders?.length && !args.path) {
    return { content: [{ type: 'text', text: `Error: path parameter is required when allowedFolders is configured (${config.allowedFolders.join(', ')}).` }], isError: true };
  }
  // Validate optional path against allowedFolders
  if (args.path) {
    const pathError = validateFilePath(args.path, config.allowedFolders);
    if (pathError) {
      return { content: [{ type: 'text', text: `Error: ${pathError}` }], isError: true };
    }
  }
  // Validate optional template (no allowedFolders restriction — templates may live anywhere)
  if (args.template) {
    const templateError = validateFilePath(args.template);
    if (templateError) {
      return { content: [{ type: 'text', text: `Error: ${templateError}` }], isError: true };
    }
  }

  if (args.content) {
    if (args.content.length > MAX_CONTENT_SIZE) {
      return { content: [{ type: 'text', text: 'Error: content exceeds 100KB limit.' }], isError: true };
    }
  }

  const { vault, error: vaultError } = resolveVaultOrError(args.vault);
  if (vaultError) return { content: [{ type: 'text', text: `Error: ${vaultError}` }], isError: true };

  const cliArgs = buildArgs('create', {
    name: args.name,
    path: args.path,
    content: args.content,
    template: args.template,
    overwrite: args.overwrite,
    vault,
  });

  const result = await execObsidianCli(cliArgs);
  const cliError = checkCliResult(result);
  if (cliError) return cliError;
  return { content: [{ type: 'text', text: result.stdout || `Note "${args.name}" created.` }] };
}

/**
 * Append content to an existing Obsidian note.
 */
export async function handleObsidianAppend(
  args: { file?: string; path?: string; content: string; vault?: string }
): Promise<ToolResult> {
  const disabled = checkEnabled();
  if (disabled) return disabled;

  const detection = detectObsidianCli();
  if (!detection.available) return cliUnavailableError(detection.installHint);

  const filePath = resolveFilePath(args);
  if (!filePath) {
    return { content: [{ type: 'text', text: 'Error: file or path parameter is required.' }], isError: true };
  }
  const config = getVaultConfig();
  const pathError = validateFilePath(filePath, config.allowedFolders);
  if (pathError) {
    return { content: [{ type: 'text', text: `Error: ${pathError}` }], isError: true };
  }
  if (!args.content) {
    return { content: [{ type: 'text', text: 'Error: content parameter is required.' }], isError: true };
  }
  if (args.content.length > MAX_CONTENT_SIZE) {
    return { content: [{ type: 'text', text: 'Error: content exceeds 100KB limit.' }], isError: true };
  }

  const { vault, error: vaultError } = resolveVaultOrError(args.vault);
  if (vaultError) return { content: [{ type: 'text', text: `Error: ${vaultError}` }], isError: true };

  const cliArgs = buildArgs('append', {
    file: filePath,
    content: args.content,
    vault,
  });

  const result = await execObsidianCli(cliArgs);
  const cliError = checkCliResult(result);
  if (cliError) return cliError;
  return { content: [{ type: 'text', text: result.stdout || `Content appended to "${filePath}".` }] };
}

/**
 * Read today's daily note from Obsidian.
 */
export async function handleObsidianDailyRead(
  args: { vault?: string }
): Promise<ToolResult> {
  const disabled = checkEnabled();
  if (disabled) return disabled;

  const detection = detectObsidianCli();
  if (!detection.available) return cliUnavailableError(detection.installHint);

  const { vault, error: vaultError } = resolveVaultOrError(args.vault);
  if (vaultError) return { content: [{ type: 'text', text: `Error: ${vaultError}` }], isError: true };

  const cliArgs = buildArgs('daily:read', { vault });

  const result = await execObsidianCli(cliArgs);
  const cliError = checkCliResult(result, true); // contentMayStartWithError: daily note content can start with "Error:"
  if (cliError) return cliError;
  return { content: [{ type: 'text', text: result.stdout || '(empty daily note)' }] };
}

/**
 * Append content to today's daily note.
 * HIGH 1: supports inline flag for inline appending.
 * Note: allowedFolders not enforced — daily note path is determined by Obsidian vault config, not agent input.
 */
export async function handleObsidianDailyAppend(
  args: { content: string; inline?: boolean; vault?: string }
): Promise<ToolResult> {
  const disabled = checkEnabled();
  if (disabled) return disabled;

  const detection = detectObsidianCli();
  if (!detection.available) return cliUnavailableError(detection.installHint);

  if (!args.content) {
    return { content: [{ type: 'text', text: 'Error: content parameter is required.' }], isError: true };
  }
  if (args.content.length > MAX_CONTENT_SIZE) {
    return { content: [{ type: 'text', text: 'Error: content exceeds 100KB limit.' }], isError: true };
  }

  const { vault, error: vaultError } = resolveVaultOrError(args.vault);
  if (vaultError) return { content: [{ type: 'text', text: `Error: ${vaultError}` }], isError: true };

  const cliArgs = buildArgs('daily:append', {
    content: args.content,
    inline: args.inline,
    vault,
  });

  const result = await execObsidianCli(cliArgs);
  const cliError = checkCliResult(result);
  if (cliError) return cliError;
  return { content: [{ type: 'text', text: result.stdout || 'Content appended to daily note.' }] };
}

/**
 * Set a frontmatter property on an Obsidian note.
 */
export async function handleObsidianPropertySet(
  args: { file?: string; path?: string; name: string; value: string; type?: string; vault?: string }
): Promise<ToolResult> {
  const disabled = checkEnabled();
  if (disabled) return disabled;

  const detection = detectObsidianCli();
  if (!detection.available) return cliUnavailableError(detection.installHint);

  const filePath = resolveFilePath(args);
  if (!filePath) {
    return { content: [{ type: 'text', text: 'Error: file or path parameter is required.' }], isError: true };
  }
  const config = getVaultConfig();
  const pathError = validateFilePath(filePath, config.allowedFolders);
  if (pathError) {
    return { content: [{ type: 'text', text: `Error: ${pathError}` }], isError: true };
  }

  const { vault, error: vaultError } = resolveVaultOrError(args.vault);
  if (vaultError) return { content: [{ type: 'text', text: `Error: ${vaultError}` }], isError: true };

  const cliArgs = buildArgs('property:set', {
    file: filePath,
    name: args.name,
    value: args.value,
    type: args.type,
    vault,
  });

  const result = await execObsidianCli(cliArgs);
  const cliError = checkCliResult(result);
  if (cliError) return cliError;
  return { content: [{ type: 'text', text: result.stdout || `Property "${args.name}" set on "${filePath}".` }] };
}

/**
 * Get Obsidian CLI help output for command discovery.
 * Agents can use this to learn about all available CLI commands.
 */
export async function handleObsidianHelp(): Promise<ToolResult> {
  const disabled = checkEnabled();
  if (disabled) return disabled;

  const detection = detectObsidianCli();
  if (!detection.available) return cliUnavailableError(detection.installHint);

  const result = await execObsidianCli(['help']);
  const cliError = checkCliResult(result);
  if (cliError) return cliError;
  return { content: [{ type: 'text', text: result.stdout || 'No help available.' }] };
}

/**
 * List notes that link to a given note (backlinks).
 */
export async function handleObsidianBacklinks(
  args: { file?: string; path?: string; vault?: string }
): Promise<ToolResult> {
  const disabled = checkEnabled();
  if (disabled) return disabled;

  const detection = detectObsidianCli();
  if (!detection.available) return cliUnavailableError(detection.installHint);

  const filePath = resolveFilePath(args);
  if (!filePath) {
    return { content: [{ type: 'text', text: 'Error: file or path parameter is required.' }], isError: true };
  }
  const config = getVaultConfig();
  const pathError = validateFilePath(filePath, config.allowedFolders);
  if (pathError) {
    return { content: [{ type: 'text', text: `Error: ${pathError}` }], isError: true };
  }

  const { vault, error: vaultError } = resolveVaultOrError(args.vault);
  if (vaultError) return { content: [{ type: 'text', text: `Error: ${vaultError}` }], isError: true };

  const cliArgs = buildArgs('backlinks', {
    file: filePath,
    vault,
  });

  const result = await execObsidianCli(cliArgs);
  const cliError = checkCliResult(result);
  if (cliError) return cliError;

  // CRITICAL 2: Filter backlinks results against allowedFolders
  if (config.allowedFolders?.length && result.stdout) {
    const lines = result.stdout.split('\n').filter(line =>
      line.trim() === '' || config.allowedFolders!.some(f => line.startsWith(f))
    );
    return { content: [{ type: 'text', text: lines.join('\n') || 'No backlinks found.' }] };
  }

  return { content: [{ type: 'text', text: result.stdout || 'No backlinks found.' }] };
}
