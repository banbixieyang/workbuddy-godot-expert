// Shared helpers for the WorkBuddy Godot connector.
//
// The WorkBuddy app spawns an MCP server over stdio. That server must attach to
// the Godot AI backend (127.0.0.1:8000) which the Godot editor normally starts
// itself — but on some Windows hosts the editor runs at Low integrity and
// cannot write the capability record the backend needs, so the backend has to
// be started from a normal-integrity process. That is what ensureBackend does.
import { spawn } from 'node:child_process';
import { execFile } from 'node:child_process';
import { access, cp, mkdir, writeFile } from 'node:fs/promises';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const HTTP_PORT = Number(process.env.GODOT_AI_HTTP_PORT || 8000);
export const WS_PORT = Number(process.env.GODOT_AI_WS_PORT || 9500);
export const GODOT_AI_VERSION = process.env.GODOT_AI_VERSION || '4.2.3';

/** stderr only: stdout carries the MCP protocol. */
export function log(message) {
  process.stderr.write(`[godot-connector] ${message}\n`);
}

export async function exists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

/** Resolve uvx from UVX_PATH, the usual per-user locations, or PATH. */
export function findUvx() {
  if (process.env.UVX_PATH) return process.env.UVX_PATH;
  const names = process.platform === 'win32' ? ['uvx.exe'] : ['uvx'];
  const roots = [
    path.join(os.homedir(), '.local', 'bin'),
    path.join(os.homedir(), '.cargo', 'bin'),
    path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'uv'),
  ];
  for (const root of roots) {
    for (const name of names) {
      const candidate = path.join(root, name);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return names[0];
}

export function portOpen(port, timeoutMs = 700) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    const done = (value) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

async function waitForPort(port, totalMs) {
  const deadline = Date.now() + totalMs;
  while (Date.now() < deadline) {
    if (await portOpen(port)) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return portOpen(port);
}

function spawnDetached(command, args, options = {}) {
  const child = spawn(command, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    ...options,
  });
  child.unref();
  return child.pid;
}

/**
 * Make sure the Godot AI backend listens on the MCP port.
 * Returns 'already-running' or 'started'.
 */
export async function ensureBackend() {
  if (await portOpen(HTTP_PORT)) return { status: 'already-running' };

  const uvx = findUvx();
  log(`backend not running, starting it with ${uvx}`);
  let pid;
  try {
    pid = spawnDetached(uvx, [
      '--from',
      `godot-ai==${GODOT_AI_VERSION}`,
      'godot-ai',
      '--transport',
      'streamable-http',
      '--port',
      String(HTTP_PORT),
      '--ws-port',
      String(WS_PORT),
    ]);
  } catch (error) {
    throw new Error(`Could not start uvx (${uvx}): ${error.message}. Install uv from https://docs.astral.sh/uv/ or set UVX_PATH.`);
  }

  if (!(await waitForPort(HTTP_PORT, 30_000))) {
    throw new Error(
      `Started the Godot AI backend (pid ${pid}) but nothing listens on 127.0.0.1:${HTTP_PORT} after 30s. ` +
        `Check that the port is free and that "${uvx} --from godot-ai==${GODOT_AI_VERSION} godot-ai --version" works.`,
    );
  }
  log(`backend is up on 127.0.0.1:${HTTP_PORT}`);
  return { status: 'started', pid };
}

/** project.godot for a fresh Godot 4.7 project with the bundled addon enabled. */
export function projectFileContents(projectName, width, height) {
  const escaped = String(projectName).replaceAll('"', '\\"');
  return `; Engine configuration file.
config_version=5

[application]

config/name="${escaped}"
config/features=PackedStringArray("4.7", "Forward Plus")

[display]

window/size/viewport_width=${width}
window/size/viewport_height=${height}

[editor_plugins]

enabled=PackedStringArray("res://addons/godot_ai/plugin.cfg")
`;
}

/** Create the project skeleton (project.godot + addons/godot_ai) when missing. */
export async function ensureProject(projectDir, { name, width = 1152, height = 648, addonSource }) {
  await mkdir(projectDir, { recursive: true });
  const projectFile = path.join(projectDir, 'project.godot');
  const createdProjectFile = !(await exists(projectFile));
  if (createdProjectFile) {
    const projectName = name?.trim() || path.basename(projectDir);
    await writeFile(projectFile, projectFileContents(projectName, width, height), 'utf8');
  }

  const addonTarget = path.join(projectDir, 'addons', 'godot_ai');
  const installedAddon = !(await exists(path.join(addonTarget, 'plugin.cfg')));
  if (installedAddon) {
    if (!(await exists(path.join(addonSource, 'plugin.cfg')))) {
      throw new Error(`Bundled Godot AI addon is missing at ${addonSource}`);
    }
    await mkdir(path.dirname(addonTarget), { recursive: true });
    await cp(addonSource, addonTarget, { recursive: true, force: false });
  }
  return { createdProjectFile, installedAddon };
}

/** First PATH hit for one of the given command names, or ''. */
async function findOnPath(names) {
  const finder = process.platform === 'win32' ? 'where.exe' : 'which';
  for (const candidate of names) {
    try {
      const { stdout } = await execFileAsync(finder, [candidate], { windowsHide: true });
      const first = stdout
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .find((line) => line.length > 0);
      if (first) return first;
    } catch {
      /* try the next name */
    }
  }
  return '';
}

/** Resolve the Godot executable from GODOT_BIN, a hint file, PATH, or common install roots. */
export async function resolveGodotExe(moduleDir) {
  const fromEnv = process.env.GODOT_BIN?.trim();
  if (fromEnv && (await exists(fromEnv))) return fromEnv;

  if (moduleDir) {
    const hintFile = path.join(moduleDir, 'godot-path.txt');
    try {
      const hint = fs.readFileSync(hintFile, 'utf8').split(/\r?\n/u)[0].trim();
      if (hint && (await exists(hint))) return hint;
    } catch {
      /* no hint */
    }
  }

  const found = await findOnPath(
    process.platform === 'win32' ? ['godot.exe', 'godot4.exe', 'Godot.exe'] : ['godot', 'godot4', 'Godot'],
  );
  if (found) return found;

  if (process.platform === 'win32') {
    const roots = [
      path.join(os.homedir(), 'AppData', 'Local', 'Programs'),
      process.env.ProgramFiles ?? 'C:\\Program Files',
      process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)',
      path.join(os.homedir(), 'Godot'),
      'C:\\Godot',
    ];
    for (const root of roots) {
      try {
        for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
          if (!entry.isDirectory() || !/godot/iu.test(entry.name)) continue;
          const dir = path.join(root, entry.name);
          const exe = fs.readdirSync(dir).find((name) => /^godot.*\.exe$/iu.test(name));
          if (exe) return path.join(dir, exe);
        }
      } catch {
        /* unreadable root */
      }
    }
  }

  throw new Error(
    'No Godot executable found. Run the installer with --godot <path to Godot 4.7+>, set GODOT_BIN, or put Godot on PATH.',
  );
}

/** Start the editor detached so it outlives this MCP call. */
export function launchEditor(godotExe, projectDir) {
  const child = spawn(godotExe, ['--path', projectDir, '--editor'], {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
    cwd: projectDir,
  });
  child.unref();
  return child.pid;
}

/** The addon shipped beside server.mjs/shared.mjs. */
export function bundledAddonDir(moduleDir) {
  return path.join(moduleDir, 'vendor', 'godot_ai');
}

