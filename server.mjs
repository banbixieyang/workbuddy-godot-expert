#!/usr/bin/env node
// WorkBuddy MCP server for Godot.
//
// WorkBuddy spawns this file over stdio. It:
//   1. makes sure the Godot AI backend runs on 127.0.0.1:8000,
//   2. spawns `godot-ai attach` and proxies its MCP traffic,
//   3. adds two project tools the Godot AI surface does not have:
//      godot_new_project and godot_open_project.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import {
  bundledAddonDir,
  ensureBackend,
  ensureProject,
  exists,
  findUvx,
  launchEditor,
  log,
  resolveGodotExe,
  GODOT_AI_VERSION,
  HTTP_PORT,
  WS_PORT,
} from './shared.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

const CUSTOM_TOOLS = [
  {
    name: 'godot_new_project',
    description:
      'Create a Godot 4.7 project on disk with the Godot AI addon installed, start the Godot AI backend when needed, and open it in the Godot editor. Use when the user wants a new game and no editor session for it exists yet. Afterwards confirm with session_manage before building anything.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['path'],
      properties: {
        path: {
          type: 'string',
          description: 'Project directory (absolute, or relative to the connector root).',
        },
        name: { type: 'string', description: 'Project display name. Defaults to the directory name.' },
        width: { type: 'integer', description: 'Initial viewport width. Defaults to 1152.' },
        height: { type: 'integer', description: 'Initial viewport height. Defaults to 648.' },
      },
    },
  },
  {
    name: 'godot_open_project',
    description:
      'Open an existing Godot project in the editor and make sure the Godot AI backend is running, so the editor registers a session. Use when the project exists but no editor has it open. Afterwards confirm with session_manage.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['path'],
      properties: {
        path: { type: 'string', description: 'Project directory containing project.godot.' },
      },
    },
  },
];

const customNames = new Set(CUSTOM_TOOLS.map((tool) => tool.name));

function reply(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
}

function replyError(id, message) {
  reply(id, { isError: true, content: [{ type: 'text', text: message }] });
}

async function runCustomTool(name, args) {
  const rawPath = typeof args?.path === 'string' ? args.path.trim() : '';
  if (!rawPath) throw new Error('path must be a non-empty project directory');
  const projectDir = path.resolve(rawPath);

  if (name === 'godot_new_project') {
    const width = Number.isSafeInteger(args.width) && args.width > 0 ? args.width : 1152;
    const height = Number.isSafeInteger(args.height) && args.height > 0 ? args.height : 648;
    const godotExe = await resolveGodotExe(here);
    const project = await ensureProject(projectDir, {
      name: args.name,
      width,
      height,
      addonSource: bundledAddonDir(here),
    });
    await ensureBackend();
    const editorPid = launchEditor(godotExe, projectDir);
    return {
      projectPath: projectDir,
      createdProjectFile: project.createdProjectFile,
      installedAddon: project.installedAddon,
      editorPid,
      godotExe,
    };
  }

  if (!(await exists(path.join(projectDir, 'project.godot')))) {
    throw new Error(`No project.godot in ${projectDir}. Use godot_new_project first.`);
  }
  const godotExe = await resolveGodotExe(here);
  await ensureBackend();
  const editorPid = launchEditor(godotExe, projectDir);
  return { projectPath: projectDir, editorPid, godotExe };
}

async function main() {
  await ensureBackend();

  const uvx = findUvx();
  const child = spawn(
    uvx,
    ['--from', `godot-ai==${GODOT_AI_VERSION}`, 'godot-ai', 'attach', '--port', String(HTTP_PORT), '--ws-port', String(WS_PORT)],
    { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
  );

  child.on('error', (error) => {
    log(`cannot run ${uvx}: ${error.message}. Install uv (https://docs.astral.sh/uv/) or set UVX_PATH.`);
    process.exit(1);
  });
  child.stderr.on('data', (chunk) => process.stderr.write(chunk));

  const pendingListIds = new Set();

  // Child -> WorkBuddy, injecting our tools into tools/list results.
  createInterface({ input: child.stdout }).on('line', (line) => {
    if (!line.trim()) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (message.id !== undefined && pendingListIds.has(message.id) && message.result?.tools) {
      pendingListIds.delete(message.id);
      message.result.tools = [...message.result.tools, ...CUSTOM_TOOLS];
    }
    process.stdout.write(`${JSON.stringify(message)}\n`);
  });

  // WorkBuddy -> child, handling our tools locally.
  createInterface({ input: process.stdin }).on('line', async (line) => {
    if (!line.trim()) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }

    if (message.method === 'tools/list') pendingListIds.add(message.id);

    if (message.method === 'tools/call' && customNames.has(message.params?.name)) {
      try {
        const value = await runCustomTool(message.params.name, message.params.arguments ?? {});
        reply(message.id, { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] });
      } catch (error) {
        replyError(message.id, error?.message ?? String(error));
      }
      return;
    }

    child.stdin.write(`${JSON.stringify(message)}\n`);
  });

  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exit(code ?? 0);
  });

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      if (!child.killed) child.kill(signal);
    });
  }
}

main().catch((error) => {
  log(`fatal: ${error?.stack ?? error}`);
  process.exit(1);
});
