import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Minimaler .env-Loader – ersetzt das dotenv-Paket, damit das Projekt
 * ohne `npm install` startet. Bestehende Prozessvariablen gewinnen.
 */
export function loadEnvFile(file = resolve(ROOT, '.env')) {
  if (!existsSync(file)) return false;

  for (const rawLine of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const eq = line.indexOf('=');
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();

    const quoted =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"));
    if (quoted) value = value.slice(1, -1);

    if (key && !(key in process.env)) process.env[key] = value;
  }
  return true;
}
