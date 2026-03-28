/**
 * Obsidian CLI Detection
 *
 * Detects the obsidian CLI binary on the system PATH.
 * Results are cached per-session to avoid repeated filesystem checks.
 */

import { execSync } from 'child_process';

export interface CliDetectionResult {
  available: boolean;
  path?: string;
  version?: string;
  error?: string;
  installHint: string;
}

let obsidianCache: CliDetectionResult | null = null;

const installHint = 'Install Obsidian: https://obsidian.md then enable CLI in Settings → General → Command Line Interface';

export function detectObsidianCli(useCache = true): CliDetectionResult {
  if (useCache && obsidianCache) return obsidianCache;
  try {
    const command = process.platform === 'win32' ? 'where obsidian' : 'which obsidian';
    const path = execSync(command, { encoding: 'utf-8', timeout: 5000 }).trim();
    let version: string | undefined;
    try {
      version = execSync('obsidian version', { encoding: 'utf-8', timeout: 5000 }).trim().split('\n')[0];
    } catch {
      // Version check is non-fatal
    }
    const result: CliDetectionResult = { available: true, path, version, installHint };
    obsidianCache = result;
    return result;
  } catch {
    const result: CliDetectionResult = {
      available: false,
      error: 'Obsidian CLI not found on PATH',
      installHint,
    };
    obsidianCache = result;
    return result;
  }
}

export function resetObsidianCache(): void {
  obsidianCache = null;
}
