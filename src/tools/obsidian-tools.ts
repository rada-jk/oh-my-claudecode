/**
 * Obsidian MCP Tools
 *
 * Provides 9 tools for reading, writing, and searching Obsidian vault notes.
 * All tools delegate to obsidian-core.ts handlers (no business logic here).
 */

import { z } from 'zod';
import { ToolDefinition } from './types.js';
import {
  handleObsidianSearch,
  handleObsidianRead,
  handleObsidianCreate,
  handleObsidianAppend,
  handleObsidianDailyRead,
  handleObsidianDailyAppend,
  handleObsidianPropertySet,
  handleObsidianBacklinks,
  handleObsidianHelp,
} from '../mcp/obsidian-core.js';

// ============================================================================
// obsidian_search - Search notes by keyword
// ============================================================================

export const obsidianSearchTool: ToolDefinition<{
  query: z.ZodString;
  limit: z.ZodOptional<z.ZodNumber>;
  vault: z.ZodOptional<z.ZodString>;
}> = {
  name: 'obsidian_search',
  description: 'Search notes in Obsidian vault by keyword. Returns matching note paths.',
  annotations: { readOnlyHint: true },
  schema: {
    query: z.string().describe('Search query string'),
    limit: z.number().int().min(1).max(100).optional().describe('Max results (default: CLI default)'),
    vault: z.string().optional().describe('Vault name override'),
  },
  handler: async (args) => {
    return handleObsidianSearch(args);
  },
};

// ============================================================================
// obsidian_read - Read a note
// ============================================================================

export const obsidianReadTool: ToolDefinition<{
  file: z.ZodOptional<z.ZodString>;
  path: z.ZodOptional<z.ZodString>;
  vault: z.ZodOptional<z.ZodString>;
}> = {
  name: 'obsidian_read',
  description: 'Read the full content of an Obsidian note by file path.',
  annotations: { readOnlyHint: true },
  schema: {
    file: z.string().optional().describe('Note file path (vault-relative). Required if path not provided.'),
    path: z.string().optional().describe('Alias for file parameter. Required if file not provided.'),
    vault: z.string().optional().describe('Vault name override'),
  },
  handler: async (args) => {
    return handleObsidianRead(args);
  },
};

// ============================================================================
// obsidian_create - Create a new note
// ============================================================================

export const obsidianCreateTool: ToolDefinition<{
  name: z.ZodString;
  path: z.ZodOptional<z.ZodString>;
  content: z.ZodOptional<z.ZodString>;
  template: z.ZodOptional<z.ZodString>;
  overwrite: z.ZodOptional<z.ZodBoolean>;
  vault: z.ZodOptional<z.ZodString>;
}> = {
  name: 'obsidian_create',
  description: 'Create a new note in the Obsidian vault. Silent by default (does not open in Obsidian UI).',
  annotations: { destructiveHint: false },
  schema: {
    name: z.string().describe('Note name (without .md extension)'),
    path: z.string().optional().describe('Full vault-relative file path (e.g. "Projects/my-note.md"). When provided with name, path determines file location.'),
    content: z.string().optional().describe('Note content (markdown)'),
    template: z.string().optional().describe('Template name to use'),
    overwrite: z.boolean().optional().describe('Overwrite if note exists'),
    vault: z.string().optional().describe('Vault name override'),
  },
  handler: async (args) => {
    return handleObsidianCreate(args);
  },
};

// ============================================================================
// obsidian_append - Append to a note
// ============================================================================

export const obsidianAppendTool: ToolDefinition<{
  file: z.ZodOptional<z.ZodString>;
  path: z.ZodOptional<z.ZodString>;
  content: z.ZodString;
  vault: z.ZodOptional<z.ZodString>;
}> = {
  name: 'obsidian_append',
  description: 'Append content to an existing Obsidian note.',
  annotations: { destructiveHint: false },
  schema: {
    file: z.string().optional().describe('Note file path (vault-relative). Required if path not provided.'),
    path: z.string().optional().describe('Alias for file parameter. Required if file not provided.'),
    content: z.string().describe('Content to append'),
    vault: z.string().optional().describe('Vault name override'),
  },
  handler: async (args) => {
    return handleObsidianAppend(args);
  },
};

// ============================================================================
// obsidian_daily_read - Read daily note
// ============================================================================

export const obsidianDailyReadTool: ToolDefinition<{
  vault: z.ZodOptional<z.ZodString>;
}> = {
  name: 'obsidian_daily_read',
  description: 'Read today\'s daily note from Obsidian.',
  annotations: { readOnlyHint: true },
  schema: {
    vault: z.string().optional().describe('Vault name override'),
  },
  handler: async (args) => {
    return handleObsidianDailyRead(args);
  },
};

// ============================================================================
// obsidian_daily_append - Append to daily note
// ============================================================================

export const obsidianDailyAppendTool: ToolDefinition<{
  content: z.ZodString;
  inline: z.ZodOptional<z.ZodBoolean>;
  vault: z.ZodOptional<z.ZodString>;
}> = {
  name: 'obsidian_daily_append',
  description: 'Append content to today\'s daily note.',
  annotations: { destructiveHint: false },
  schema: {
    content: z.string().describe('Content to append to daily note'),
    inline: z.boolean().optional().describe('Append inline (same line) instead of new line'),
    vault: z.string().optional().describe('Vault name override'),
  },
  handler: async (args) => {
    return handleObsidianDailyAppend(args);
  },
};

// ============================================================================
// obsidian_property_set - Set frontmatter property
// ============================================================================

export const obsidianPropertySetTool: ToolDefinition<{
  file: z.ZodOptional<z.ZodString>;
  path: z.ZodOptional<z.ZodString>;
  name: z.ZodString;
  value: z.ZodString;
  type: z.ZodOptional<z.ZodEnum<['text', 'list', 'number', 'checkbox', 'date', 'datetime']>>;
  vault: z.ZodOptional<z.ZodString>;
}> = {
  name: 'obsidian_property_set',
  description: 'Set a frontmatter property on an Obsidian note.',
  annotations: { destructiveHint: false, idempotentHint: true },
  schema: {
    file: z.string().optional().describe('Note file path (vault-relative). Required if path not provided.'),
    path: z.string().optional().describe('Alias for file parameter. Required if file not provided.'),
    name: z.string().describe('Property name'),
    value: z.string().describe('Property value'),
    type: z.enum(['text', 'list', 'number', 'checkbox', 'date', 'datetime']).optional().describe('Property type (default: text)'),
    vault: z.string().optional().describe('Vault name override'),
  },
  handler: async (args) => {
    return handleObsidianPropertySet(args);
  },
};

// ============================================================================
// obsidian_backlinks - List backlinks
// ============================================================================

export const obsidianBacklinksTool: ToolDefinition<{
  file: z.ZodOptional<z.ZodString>;
  path: z.ZodOptional<z.ZodString>;
  vault: z.ZodOptional<z.ZodString>;
}> = {
  name: 'obsidian_backlinks',
  description: 'List notes that link to a given note (backlinks).',
  annotations: { readOnlyHint: true },
  schema: {
    file: z.string().optional().describe('Note file path (vault-relative). Required if path not provided.'),
    path: z.string().optional().describe('Alias for file parameter. Required if file not provided.'),
    vault: z.string().optional().describe('Vault name override'),
  },
  handler: async (args) => {
    return handleObsidianBacklinks(args);
  },
};

// ============================================================================
// obsidian_help - Show CLI help
// ============================================================================

export const obsidianHelpTool: ToolDefinition<Record<string, never>> = {
  name: 'obsidian_help',
  description: 'Show Obsidian CLI help output for command discovery.',
  annotations: { readOnlyHint: true },
  schema: {},
  handler: async () => {
    return handleObsidianHelp();
  },
};

/**
 * All Obsidian tools for registration
 */
export const obsidianTools = [
  obsidianSearchTool,
  obsidianReadTool,
  obsidianCreateTool,
  obsidianAppendTool,
  obsidianDailyReadTool,
  obsidianDailyAppendTool,
  obsidianPropertySetTool,
  obsidianBacklinksTool,
  obsidianHelpTool,
];
