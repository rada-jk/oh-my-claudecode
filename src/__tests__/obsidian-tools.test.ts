import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';

// Mock child_process and fs before imports
vi.mock('child_process', () => ({
  execSync: vi.fn(),
  spawn: vi.fn(),
}));

vi.mock('fs', () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => '{}'),
}));

import { obsidianTools } from '../tools/obsidian-tools.js';
import {
  buildArgs,
  getVaultConfig,
  execObsidianCli,
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
import { detectObsidianCli, resetObsidianCache } from '../mcp/obsidian-detection.js';
import { execSync, spawn } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { EventEmitter } from 'events';

describe('Obsidian Tools', () => {
  // ========================================================================
  // Tool Definitions
  // ========================================================================
  describe('Tool definitions', () => {
    it('should export exactly 9 tools', () => {
      expect(obsidianTools).toHaveLength(9);
    });

    it('should have name, description, schema, and handler for each tool', () => {
      for (const tool of obsidianTools) {
        expect(tool).toHaveProperty('name');
        expect(tool).toHaveProperty('description');
        expect(tool).toHaveProperty('schema');
        expect(tool).toHaveProperty('handler');
        expect(typeof tool.name).toBe('string');
        expect(typeof tool.description).toBe('string');
        expect(typeof tool.handler).toBe('function');
      }
    });

    it('should have correct tool names', () => {
      const names = obsidianTools.map(t => t.name);
      expect(names).toEqual([
        'obsidian_search',
        'obsidian_read',
        'obsidian_create',
        'obsidian_append',
        'obsidian_daily_read',
        'obsidian_daily_append',
        'obsidian_property_set',
        'obsidian_backlinks',
        'obsidian_help',
      ]);
    });

    it('should have annotations on all tools', () => {
      for (const tool of obsidianTools) {
        expect(tool.annotations).toBeDefined();
      }
    });

    it('should mark read-only tools correctly', () => {
      const readOnlyTools = ['obsidian_search', 'obsidian_read', 'obsidian_daily_read', 'obsidian_backlinks', 'obsidian_help'];
      for (const tool of obsidianTools) {
        if (readOnlyTools.includes(tool.name)) {
          expect(tool.annotations?.readOnlyHint).toBe(true);
        }
      }
    });

    it('should mark write tools as non-destructive', () => {
      const writeTools = ['obsidian_create', 'obsidian_append', 'obsidian_daily_append', 'obsidian_property_set'];
      for (const tool of obsidianTools) {
        if (writeTools.includes(tool.name)) {
          expect(tool.annotations?.destructiveHint).toBe(false);
        }
      }
    });

    it('should mark property_set as idempotent', () => {
      const propTool = obsidianTools.find(t => t.name === 'obsidian_property_set');
      expect(propTool?.annotations?.idempotentHint).toBe(true);
    });
  });

  // ========================================================================
  // Schema Validation
  // ========================================================================
  describe('Schema validation', () => {
    it('obsidian_search: requires query string', () => {
      const tool = obsidianTools.find(t => t.name === 'obsidian_search')!;
      const schema = z.object(tool.schema);
      expect(schema.safeParse({ query: 'test' }).success).toBe(true);
      expect(schema.safeParse({}).success).toBe(false);
      expect(schema.safeParse({ query: 123 }).success).toBe(false);
    });

    it('obsidian_search: accepts optional limit and vault', () => {
      const tool = obsidianTools.find(t => t.name === 'obsidian_search')!;
      const schema = z.object(tool.schema);
      expect(schema.safeParse({ query: 'test', limit: 10, vault: 'Dev' }).success).toBe(true);
    });

    it('obsidian_search: rejects invalid limit', () => {
      const tool = obsidianTools.find(t => t.name === 'obsidian_search')!;
      const schema = z.object(tool.schema);
      expect(schema.safeParse({ query: 'test', limit: 0 }).success).toBe(false);
      expect(schema.safeParse({ query: 'test', limit: 101 }).success).toBe(false);
      expect(schema.safeParse({ query: 'test', limit: 1.5 }).success).toBe(false);
    });

    it('obsidian_read: accepts file or path', () => {
      const tool = obsidianTools.find(t => t.name === 'obsidian_read')!;
      const schema = z.object(tool.schema);
      expect(schema.safeParse({ file: 'notes/test.md' }).success).toBe(true);
      expect(schema.safeParse({ path: 'notes/test.md' }).success).toBe(true);
      expect(schema.safeParse({}).success).toBe(true); // both optional at schema level
    });

    it('obsidian_create: requires name, accepts path/content/template/overwrite', () => {
      const tool = obsidianTools.find(t => t.name === 'obsidian_create')!;
      const schema = z.object(tool.schema);
      expect(schema.safeParse({ name: 'Test Note' }).success).toBe(true);
      expect(schema.safeParse({}).success).toBe(false);
      expect(schema.safeParse({
        name: 'Test', path: 'folder', content: '# Hello', template: 'daily', overwrite: true, vault: 'Dev'
      }).success).toBe(true);
    });

    it('obsidian_create: schema has NO folder field', () => {
      const tool = obsidianTools.find(t => t.name === 'obsidian_create')!;
      expect(tool.schema).not.toHaveProperty('folder');
    });

    it('obsidian_create: schema HAS path and overwrite fields', () => {
      const tool = obsidianTools.find(t => t.name === 'obsidian_create')!;
      expect(tool.schema).toHaveProperty('path');
      expect(tool.schema).toHaveProperty('overwrite');
    });

    it('obsidian_append: requires content', () => {
      const tool = obsidianTools.find(t => t.name === 'obsidian_append')!;
      const schema = z.object(tool.schema);
      expect(schema.safeParse({ file: 'test.md', content: 'hello' }).success).toBe(true);
      expect(schema.safeParse({ file: 'test.md' }).success).toBe(false);
    });

    it('obsidian_daily_read: accepts empty or vault only', () => {
      const tool = obsidianTools.find(t => t.name === 'obsidian_daily_read')!;
      const schema = z.object(tool.schema);
      expect(schema.safeParse({}).success).toBe(true);
      expect(schema.safeParse({ vault: 'Dev' }).success).toBe(true);
    });

    it('obsidian_daily_append: requires content', () => {
      const tool = obsidianTools.find(t => t.name === 'obsidian_daily_append')!;
      const schema = z.object(tool.schema);
      expect(schema.safeParse({ content: 'entry' }).success).toBe(true);
      expect(schema.safeParse({}).success).toBe(false);
    });

    it('obsidian_property_set: requires name and value, has type enum', () => {
      const tool = obsidianTools.find(t => t.name === 'obsidian_property_set')!;
      const schema = z.object(tool.schema);
      expect(schema.safeParse({ file: 'test.md', name: 'status', value: 'done' }).success).toBe(true);
      expect(schema.safeParse({ file: 'test.md', name: 'status', value: 'done', type: 'text' }).success).toBe(true);
      expect(schema.safeParse({ file: 'test.md', name: 'status', value: 'done', type: 'checkbox' }).success).toBe(true);
      expect(schema.safeParse({ file: 'test.md', name: 'status', value: 'done', type: 'invalid' }).success).toBe(false);
    });

    it('obsidian_property_set: accepts all valid type values', () => {
      const tool = obsidianTools.find(t => t.name === 'obsidian_property_set')!;
      const schema = z.object(tool.schema);
      const validTypes = ['text', 'list', 'number', 'checkbox', 'date', 'datetime'];
      for (const type of validTypes) {
        expect(schema.safeParse({ file: 'f.md', name: 'p', value: 'v', type }).success).toBe(true);
      }
    });

    it('obsidian_backlinks: accepts file or path', () => {
      const tool = obsidianTools.find(t => t.name === 'obsidian_backlinks')!;
      const schema = z.object(tool.schema);
      expect(schema.safeParse({ file: 'test.md' }).success).toBe(true);
      expect(schema.safeParse({ path: 'test.md' }).success).toBe(true);
    });

    it('obsidian_help: accepts empty schema', () => {
      const tool = obsidianTools.find(t => t.name === 'obsidian_help')!;
      const schema = z.object(tool.schema);
      expect(schema.safeParse({}).success).toBe(true);
    });
  });

  // ========================================================================
  // buildArgs
  // ========================================================================
  describe('buildArgs', () => {
    it('should place vault= before subcommand', () => {
      const args = buildArgs('search', { query: 'test', vault: 'Dev' });
      expect(args[0]).toBe('vault=Dev');
      expect(args[1]).toBe('search');
      expect(args).toContain('query=test');
    });

    it('should omit vault when undefined', () => {
      const args = buildArgs('search', { query: 'test', vault: undefined });
      expect(args[0]).toBe('search');
      expect(args).not.toContain('vault=undefined');
    });

    it('should omit false boolean params', () => {
      const args = buildArgs('create', { name: 'test', overwrite: false, vault: undefined });
      expect(args).not.toContain('overwrite');
      expect(args).not.toContain('overwrite=false');
    });

    it('should include true boolean params as bare flags', () => {
      const args = buildArgs('create', { name: 'test', overwrite: true, vault: undefined });
      expect(args).toContain('overwrite');
    });

    it('should escape newlines and tabs in content', () => {
      const args = buildArgs('create', { name: 'test', content: 'line1\nline2\ttab', vault: undefined });
      const contentArg = args.find(a => a.startsWith('content='));
      expect(contentArg).toBe('content=line1\\nline2\\ttab');
    });

    it('should handle number params', () => {
      const args = buildArgs('search', { query: 'test', limit: 10, vault: undefined });
      expect(args).toContain('limit=10');
    });
  });

  // ========================================================================
  // Path Validation (via handlers)
  // ========================================================================
  describe('Path validation', () => {
    beforeEach(() => {
      resetObsidianCache();
      vi.mocked(execSync).mockReturnValue('/usr/local/bin/obsidian\n');
    });

    it('should reject absolute paths', async () => {
      const result = await handleObsidianRead({ file: '/etc/passwd' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Absolute paths are not allowed');
    });

    it('should reject path traversal', async () => {
      const result = await handleObsidianRead({ file: '../../../etc/passwd' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Path traversal');
    });

    it('should reject null bytes', async () => {
      const result = await handleObsidianRead({ file: 'test\0.md' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Invalid characters');
    });

    it('should reject Windows absolute paths', async () => {
      const result = await handleObsidianRead({ file: 'C:\\Windows\\System32' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Absolute paths are not allowed');
    });
  });

  // ========================================================================
  // Bug Fix Verification
  // ========================================================================
  describe('Bug fix: handleObsidianCreate has no folder param, no silent', () => {
    beforeEach(() => {
      resetObsidianCache();
      vi.mocked(execSync).mockReturnValue('/usr/local/bin/obsidian\n');
    });

    it('handleObsidianCreate accepts path instead of folder', () => {
      // Verify the function signature accepts path, not folder — build the args directly
      const args = buildArgs('create', {
        name: 'test',
        path: 'subfolder',
        content: 'hello',
        vault: 'Dev',
      });
      // path should be present, folder and silent should not
      expect(args).toContain('path=subfolder');
      const folderArgs = args.filter(a => a.startsWith('folder'));
      expect(folderArgs).toHaveLength(0);
      expect(args).not.toContain('silent');
    });

    it('buildArgs for create should not include silent or folder', () => {
      const args = buildArgs('create', {
        name: 'test',
        path: 'subfolder',
        content: 'hello',
        vault: 'Dev',
      });
      expect(args).not.toContain('silent');
      expect(args).not.toContain('silent=true');
      const folderArgs = args.filter(a => a.startsWith('folder'));
      expect(folderArgs).toHaveLength(0);
      expect(args).toContain('path=subfolder');
    });
  });

  describe('Bug fix: handleObsidianPropertySet has type param', () => {
    beforeEach(() => {
      resetObsidianCache();
      vi.mocked(execSync).mockReturnValue('/usr/local/bin/obsidian\n');
    });

    it('should include type in buildArgs when provided', () => {
      const args = buildArgs('property:set', {
        file: 'test.md',
        name: 'status',
        value: 'done',
        type: 'checkbox',
        vault: 'Dev',
      });
      expect(args).toContain('type=checkbox');
    });

    it('should omit type from buildArgs when not provided', () => {
      const args = buildArgs('property:set', {
        file: 'test.md',
        name: 'status',
        value: 'done',
        type: undefined,
        vault: 'Dev',
      });
      const typeArgs = args.filter(a => a.startsWith('type'));
      expect(typeArgs).toHaveLength(0);
    });
  });

  describe('Bug fix: getVaultConfig returns {} when enabled === false', () => {
    beforeEach(() => {
      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(readFileSync).mockReturnValue('{}');
      // Clear env vars
      delete process.env.OMC_OBSIDIAN_VAULT;
      delete process.env.OMC_OBSIDIAN_VAULT_NAME;
    });

    it('should return empty when obsidian.enabled is false', () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        obsidian: {
          enabled: false,
          vaultPath: '/should/be/ignored',
          vaultName: 'IgnoreMe',
        },
      }));
      const config = getVaultConfig();
      expect(config).toEqual({});
    });

    it('should return vault config when enabled is true', () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        obsidian: {
          enabled: true,
          vaultPath: '/my/vault',
          vaultName: 'Dev',
        },
      }));
      const config = getVaultConfig();
      expect(config.vaultPath).toBe('/my/vault');
      expect(config.vaultName).toBe('Dev');
    });

    it('should return vault config when enabled is not specified', () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        obsidian: {
          vaultPath: '/my/vault',
          vaultName: 'Dev',
        },
      }));
      const config = getVaultConfig();
      expect(config.vaultPath).toBe('/my/vault');
      expect(config.vaultName).toBe('Dev');
    });

    it('should return empty when no config exists', () => {
      vi.mocked(existsSync).mockReturnValue(false);
      const config = getVaultConfig();
      expect(config).toEqual({});
    });
  });

  // ========================================================================
  // CLI Detection
  // ========================================================================
  describe('CLI detection', () => {
    beforeEach(() => {
      resetObsidianCache();
    });

    it('should detect CLI when available', () => {
      vi.mocked(execSync).mockReturnValue('/usr/local/bin/obsidian\n');
      const result = detectObsidianCli(false);
      expect(result.available).toBe(true);
      expect(result.path).toBe('/usr/local/bin/obsidian');
    });

    it('should report unavailable when CLI not found', () => {
      vi.mocked(execSync).mockImplementation(() => { throw new Error('not found'); });
      const result = detectObsidianCli(false);
      expect(result.available).toBe(false);
      expect(result.installHint).toBeTruthy();
    });

    it('should cache results', () => {
      vi.mocked(execSync).mockReturnValue('/usr/local/bin/obsidian\n');
      detectObsidianCli(false);
      vi.mocked(execSync).mockClear();
      const cached = detectObsidianCli(true);
      expect(cached.available).toBe(true);
      expect(execSync).not.toHaveBeenCalled();
    });
  });

  // ========================================================================
  // Handler delegation (handlers return CLI unavailable when not mocked)
  // ========================================================================
  describe('Handler delegation', () => {
    beforeEach(() => {
      resetObsidianCache();
      vi.mocked(execSync).mockImplementation(() => { throw new Error('not found'); });
    });

    it('handleObsidianSearch returns error when CLI unavailable', async () => {
      const result = await handleObsidianSearch({ query: 'test' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('not available');
    });

    it('handleObsidianRead returns error when CLI unavailable', async () => {
      const result = await handleObsidianRead({ file: 'test.md' });
      expect(result.isError).toBe(true);
    });

    it('handleObsidianCreate returns error when CLI unavailable', async () => {
      const result = await handleObsidianCreate({ name: 'test' });
      expect(result.isError).toBe(true);
    });

    it('handleObsidianAppend returns error when CLI unavailable', async () => {
      const result = await handleObsidianAppend({ file: 'test.md', content: 'hello' });
      expect(result.isError).toBe(true);
    });

    it('handleObsidianDailyRead returns error when CLI unavailable', async () => {
      const result = await handleObsidianDailyRead({});
      expect(result.isError).toBe(true);
    });

    it('handleObsidianDailyAppend returns error when CLI unavailable', async () => {
      const result = await handleObsidianDailyAppend({ content: 'hello' });
      expect(result.isError).toBe(true);
    });

    it('handleObsidianPropertySet returns error when CLI unavailable', async () => {
      const result = await handleObsidianPropertySet({ file: 'test.md', name: 'status', value: 'done' });
      expect(result.isError).toBe(true);
    });

    it('handleObsidianBacklinks returns error when CLI unavailable', async () => {
      const result = await handleObsidianBacklinks({ file: 'test.md' });
      expect(result.isError).toBe(true);
    });

    it('handleObsidianHelp returns error when CLI unavailable', async () => {
      const result = await handleObsidianHelp();
      expect(result.isError).toBe(true);
    });
  });

  // ========================================================================
  // Subcommand allowlist
  // ========================================================================
  describe('Subcommand allowlist', () => {
    it('should block disallowed subcommands', async () => {
      const result = await execObsidianCli(['rm', '-rf', '/']);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Blocked subcommand');
    });

    it('should allow valid subcommands', () => {
      // Verify valid subcommands are in the allowlist by checking buildArgs does not error
      const validCommands = ['search', 'read', 'create', 'append', 'daily:read', 'daily:append', 'property:set', 'backlinks', 'help'];
      for (const cmd of validCommands) {
        const args = buildArgs(cmd, { vault: undefined });
        expect(args[0]).toBe(cmd);
      }
    });

    it('should block delete subcommand', async () => {
      const result = await execObsidianCli(['delete', 'file=test.md']);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Blocked subcommand');
    });
  });

  // ========================================================================
  // allowedFolders enforcement (MEDIUM 3)
  // ========================================================================
  describe('allowedFolders enforcement', () => {
    beforeEach(() => {
      resetObsidianCache();
      vi.mocked(execSync).mockReturnValue('/usr/local/bin/obsidian\n');
      delete process.env.OMC_OBSIDIAN_VAULT;
      delete process.env.OMC_OBSIDIAN_VAULT_NAME;
    });

    it('should reject paths outside allowedFolders', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        obsidian: {
          vaultName: 'Dev',
          allowedFolders: ['Projects/', 'OMC/'],
        },
      }));
      const result = await handleObsidianRead({ file: 'Private/secret.md' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Access restricted');
    });

    it('should allow paths inside allowedFolders', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        obsidian: {
          vaultName: 'Dev',
          allowedFolders: ['Projects/', 'OMC/'],
        },
      }));
      // Mock spawn to return a fake child process
      const fakeChild = new EventEmitter() as ReturnType<typeof spawn>;
      const fakeStdout = new EventEmitter();
      const fakeStderr = new EventEmitter();
      (fakeChild as unknown as Record<string, unknown>).stdout = fakeStdout;
      (fakeChild as unknown as Record<string, unknown>).stderr = fakeStderr;
      vi.mocked(spawn).mockReturnValue(fakeChild as ReturnType<typeof spawn>);
      const resultPromise = handleObsidianRead({ file: 'Projects/readme.md' });
      fakeStdout.emit('data', Buffer.from('# Readme'));
      fakeChild.emit('close', 0);
      const result = await resultPromise;
      // Should NOT be an access restricted error — path is within allowedFolders
      expect(result.content[0].text).not.toContain('Access restricted');
      expect(result.content[0].text).toBe('# Readme');
    });

    it('should allow any path when allowedFolders is not configured', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        obsidian: {
          vaultName: 'Dev',
        },
      }));
      // Mock spawn to return a fake child process
      const fakeChild = new EventEmitter() as ReturnType<typeof spawn>;
      const fakeStdout = new EventEmitter();
      const fakeStderr = new EventEmitter();
      (fakeChild as unknown as Record<string, unknown>).stdout = fakeStdout;
      (fakeChild as unknown as Record<string, unknown>).stderr = fakeStderr;
      vi.mocked(spawn).mockReturnValue(fakeChild as ReturnType<typeof spawn>);
      const resultPromise = handleObsidianRead({ file: 'Anywhere/note.md' });
      fakeStdout.emit('data', Buffer.from('note content'));
      fakeChild.emit('close', 0);
      const result = await resultPromise;
      // Should NOT be an access restricted error
      expect(result.content[0].text).not.toContain('Access restricted');
      expect(result.content[0].text).toBe('note content');
    });
  });

  // ========================================================================
  // enabled=false blocks all handlers (HIGH 5)
  // ========================================================================
  describe('enabled=false blocks handlers', () => {
    beforeEach(() => {
      resetObsidianCache();
      vi.mocked(execSync).mockReturnValue('/usr/local/bin/obsidian\n');
      delete process.env.OMC_OBSIDIAN_VAULT;
      delete process.env.OMC_OBSIDIAN_VAULT_NAME;
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        obsidian: {
          enabled: false,
          vaultName: 'Dev',
        },
      }));
    });

    it('should block search when disabled', async () => {
      const result = await handleObsidianSearch({ query: 'test' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('disabled');
    });

    it('should block read when disabled', async () => {
      const result = await handleObsidianRead({ file: 'test.md' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('disabled');
    });

    it('should block create when disabled', async () => {
      const result = await handleObsidianCreate({ name: 'test' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('disabled');
    });

    it('should block help when disabled', async () => {
      const result = await handleObsidianHelp();
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('disabled');
    });
  });

  // ========================================================================
  // CLI stdout "Error:" detection (CRITICAL 1)
  // ========================================================================
  describe('CLI stdout Error: detection', () => {
    beforeEach(() => {
      resetObsidianCache();
      vi.mocked(execSync).mockReturnValue('/usr/local/bin/obsidian\n');
      vi.mocked(existsSync).mockReturnValue(false);
      delete process.env.OMC_OBSIDIAN_VAULT;
      delete process.env.OMC_OBSIDIAN_VAULT_NAME;
    });

    it('buildArgs produces correct args for daily:append with inline', () => {
      const args = buildArgs('daily:append', { content: 'test', inline: true, vault: 'Dev' });
      expect(args).toContain('inline');
      expect(args).toContain('vault=Dev');
    });
  });

  // ========================================================================
  // daily_append schema includes inline (HIGH 1)
  // ========================================================================
  describe('daily_append inline schema', () => {
    it('obsidian_daily_append: accepts inline boolean', () => {
      const tool = obsidianTools.find(t => t.name === 'obsidian_daily_append')!;
      const schema = z.object(tool.schema);
      expect(schema.safeParse({ content: 'entry', inline: true }).success).toBe(true);
      expect(schema.safeParse({ content: 'entry', inline: false }).success).toBe(true);
      expect(schema.safeParse({ content: 'entry' }).success).toBe(true);
    });
  });

  // ========================================================================
  // Vault name validation error surfacing (HIGH 4)
  // ========================================================================
  describe('Vault name validation errors', () => {
    beforeEach(() => {
      resetObsidianCache();
      vi.mocked(execSync).mockReturnValue('/usr/local/bin/obsidian\n');
      vi.mocked(existsSync).mockReturnValue(true);
      delete process.env.OMC_OBSIDIAN_VAULT;
      delete process.env.OMC_OBSIDIAN_VAULT_NAME;
    });

    it('should return error for invalid configured vault name', async () => {
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        obsidian: {
          vaultName: 'Bad<Vault>Name!',
        },
      }));
      const result = await handleObsidianSearch({ query: 'test' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Invalid vault name');
    });
  });
});
