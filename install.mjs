#!/usr/bin/env node
// Install a WorkBuddy plugin (connector or expert) from this repo into the
// local WorkBuddy profile as a private directory marketplace.
//
//   node install.mjs                                # install this plugin
//   node install.mjs --uninstall                    # remove it
//   node install.mjs --godot "C:\Godot\Godot.exe"  # record the Godot path
//   node install.mjs --dry-run                      # show what would change
//
// WorkBuddy keeps its plugin registry under ~/.workbuddy/plugins:
//   known_marketplaces.json   marketplaces (a local directory is a valid one)
//   installed_plugins.json    "name@marketplace" -> installed copies
//   cache/<marketplace>/<name>/<version>/   files actually loaded
// and enables plugins in ~/.workbuddy/settings.json under enabledPlugins.
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const home = os.homedir();
const wbRoot = path.join(home, '.workbuddy');
const pluginsRoot = path.join(wbRoot, 'plugins');
const marketplaceName = 'local-godot';
const marketplaceDir = path.join(pluginsRoot, 'marketplaces', marketplaceName);

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = argv.indexOf(`--${name}`);
  return at >= 0 && argv[at + 1] ? argv[at + 1] : fallback;
};
const dryRun = argv.includes('--dry-run');
const uninstall = argv.includes('--uninstall');
const pluginSource = path.resolve(here, flag('source', '.'));
const godotHint = flag('godot', '') ? path.resolve(flag('godot', '')) : '';

const stamp = new Date().toISOString().replace(/[:.]/gu, '-');
const now = new Date().toISOString();

const say = (message) => console.log(`${dryRun ? '[dry-run] ' : ''}${message}`);

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw new Error(`${file}: ${error.message}`);
  }
}

async function writeJson(file, value) {
  if (dryRun) {
    say(`would write ${file}`);
    return;
  }
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  say(`wrote ${path.relative(wbRoot, file)}`);
}

async function backup(file) {
  if (dryRun || !existsSync(file)) return;
  await cp(file, `${file}.bak-${stamp}`);
  say(`backed up ${path.basename(file)}`);
}

if (!existsSync(wbRoot)) throw new Error(`WorkBuddy data directory not found: ${wbRoot}. Start WorkBuddy once, then retry.`);

const manifestPath = path.join(pluginSource, '.codebuddy-plugin', 'plugin.json');
if (!existsSync(manifestPath)) throw new Error(`not a WorkBuddy plugin (missing .codebuddy-plugin/plugin.json): ${pluginSource}`);
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const pluginName = manifest.name;
const version = manifest.version;
if (!pluginName || !version) throw new Error(`${manifestPath} must declare name and version`);

const installDir = path.join(pluginsRoot, 'cache', marketplaceName, pluginName, version);
const key = `${pluginName}@${marketplaceName}`;

const knownPath = path.join(pluginsRoot, 'known_marketplaces.json');
const installedPath = path.join(pluginsRoot, 'installed_plugins.json');
const settingsPath = path.join(wbRoot, 'settings.json');
const marketplaceManifestPath = path.join(marketplaceDir, '.codebuddy-plugin', 'marketplace.json');

const known = await readJson(knownPath, {});
const installed = await readJson(installedPath, { version: 2, plugins: {} });
const settings = await readJson(settingsPath, {});
settings.enabledPlugins = settings.enabledPlugins && typeof settings.enabledPlugins === 'object' ? settings.enabledPlugins : {};
installed.plugins = installed.plugins && typeof installed.plugins === 'object' ? installed.plugins : {};

if (uninstall) {
  const marketplaceManifest = await readJson(marketplaceManifestPath, { plugins: [] });
  marketplaceManifest.plugins = (marketplaceManifest.plugins ?? []).filter((entry) => entry.name !== pluginName);
  delete installed.plugins[key];
  delete settings.enabledPlugins[key];
  if (!dryRun) {
    await rm(installDir, { recursive: true, force: true });
    if (marketplaceManifest.plugins.length === 0) {
      delete known[marketplaceName];
      await rm(marketplaceDir, { recursive: true, force: true });
    } else {
      await writeFile(marketplaceManifestPath, `${JSON.stringify(marketplaceManifest, null, 2)}\n`, 'utf8');
    }
  }
  await backup(knownPath);
  await backup(installedPath);
  await backup(settingsPath);
  await writeJson(knownPath, known);
  await writeJson(installedPath, installed);
  await writeJson(settingsPath, settings);
  say(`uninstalled ${key}`);
  process.exit(0);
}

// 1. Copy the plugin into the marketplace and the cache.
if (!dryRun) {
  await mkdir(path.join(marketplaceDir, '.codebuddy-plugin'), { recursive: true });
  await mkdir(path.join(marketplaceDir, 'plugins'), { recursive: true });
  await cp(pluginSource, path.join(marketplaceDir, 'plugins', pluginName), { recursive: true, force: true });
  await mkdir(path.dirname(installDir), { recursive: true });
  await cp(pluginSource, installDir, { recursive: true, force: true });
  if (godotHint) {
    for (const dir of [installDir, path.join(marketplaceDir, 'plugins', pluginName)]) {
      await writeFile(path.join(dir, 'godot-path.txt'), `${godotHint}\n`, 'utf8');
    }
    say(`godot executable hint: ${godotHint}`);
  }
  say(`installed ${pluginName}@${version} -> ${path.relative(wbRoot, installDir)}`);
} else {
  say(`would copy ${pluginSource} -> ${path.relative(wbRoot, installDir)}`);
}

// 2. Upsert the marketplace entry (this marketplace can hold several plugins).
const marketplaceManifest = await readJson(marketplaceManifestPath, {
  name: marketplaceName,
  description: 'Locally installed WorkBuddy plugins (not published).',
  owner: { name: 'banbixieyang' },
  metadata: { version: '1.0.0' },
  plugins: [],
});
marketplaceManifest.plugins = marketplaceManifest.plugins ?? [];
const entry = {
  name: pluginName,
  description: manifest.description,
  source: `./plugins/${pluginName}`,
  category: manifest.expertType === 'agent' ? 'expert' : manifest.category ?? 'mcp-app',
  version,
};
const existing = marketplaceManifest.plugins.findIndex((item) => item.name === pluginName);
if (existing >= 0) marketplaceManifest.plugins[existing] = entry;
else marketplaceManifest.plugins.push(entry);
marketplaceManifest.metadata = { ...marketplaceManifest.metadata, updatedAt: now };
await writeJson(marketplaceManifestPath, marketplaceManifest);

// 3. Registry + enablement.
known[marketplaceName] = {
  manifestName: marketplaceName,
  type: 'directory',
  source: { source: 'directory', path: marketplaceDir },
  installLocation: marketplaceDir,
  description: 'Locally installed WorkBuddy plugins',
  lastUpdated: now,
  autoUpdate: false,
};
installed.plugins[key] = [
  {
    scope: 'user',
    installPath: installDir,
    version,
    installedAt: now,
    lastUpdated: now,
  },
];
settings.enabledPlugins[key] = true;

await backup(knownPath);
await backup(installedPath);
await backup(settingsPath);
await writeJson(knownPath, known);
await writeJson(installedPath, installed);
await writeJson(settingsPath, settings);

say(`enabled ${key}`);
console.log('');
console.log(`Restart WorkBuddy, then look for the plugin${manifest.expertType === 'agent' ? ' under 专家 (Experts)' : ' under 连接器'} and connect it once.`);

