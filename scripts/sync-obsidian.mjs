import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import './generate-site-reference.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = path.join(root, 'docs/obsidian/Itgel');
const statePath = path.join(root, '.obsidian-itgel-sync.json');
const hash = (value) => createHash('sha256').update(value).digest('hex');
let previous = { destination: '', hashes: {} };
try { previous = JSON.parse(await readFile(statePath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
let destination = previous.destination;
if (!destination) {
  const registry = JSON.parse(await readFile(path.join(homedir(), 'Library/Application Support/obsidian/obsidian.json'), 'utf8'));
  const vaults = Object.values(registry.vaults ?? {});
  const open = vaults.filter((vault) => vault.open);
  const vault = open.length === 1 ? open[0] : vaults.length === 1 ? vaults[0] : null;
  if (!vault?.path) throw new Error('Choose the Obsidian vault before syncing.');
  destination = path.join(vault.path, 'Itgel');
}
await mkdir(destination, { recursive: true });
const pending = [];
for (const name of await readdir(source)) {
  if (!name.endsWith('.md')) continue;
  const content = await readFile(path.join(source, name), 'utf8');
  let existing;
  try { existing = await readFile(path.join(destination, name), 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (existing !== undefined && existing !== content && hash(existing) !== previous.hashes[name]) {
    throw new Error(`Note edited in Obsidian: ${name}. Merge it before syncing.`);
  }
  pending.push({ name, content });
}
const hashes = { ...previous.hashes };
for (const { name, content } of pending) { await writeFile(path.join(destination, name), content); hashes[name] = hash(content); }
await writeFile(statePath, JSON.stringify({ destination, hashes }, null, 2));
console.log(JSON.stringify({ destination, notes: pending.length, existingUserNotesPreserved: true }));
