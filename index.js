// dsh-plugin-switch — host half
//
// 在设置「插件」分区提供「启停」页的后端：
//   GET  /api/plugin-switch/list  → 白名单条目 + 当前 enabled
//   POST /api/plugin-switch/set   → { id, enabled } 写 profile cordis.patch.yml
//
// 持久化只改 ~/.dsh/profiles/web/cordis.patch.yml 的顶层 overlay
// （`- id: …` + `disabled:`），靠 profile patchReload:live 热生效。
// 刻意不调 loader.update().write()，避免把合成树整表写回配置文件。
// 写盘用「顶层块正则替换 / 追加」，不整文件 YAML 重排，避免打乱 MCP insert。

import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

export const name = 'plugin-switch';
export const inject = ['webServer', 'loader'];

const PATH_LIST = '/api/plugin-switch/list';
const PATH_SET = '/api/plugin-switch/set';
const MAX_BODY_BYTES = 16 * 1024;

/** Curated allowlist — only these ids can be toggled from the UI. */
export const ALLOWLIST = [
  {
    id: 'ui-sidebar-right',
    titleZh: '官方右侧栏',
    titleEn: 'Official right sidebar',
    noteZh: '含会话头右上角「展开侧栏」按钮',
    noteEn: 'Includes the header expand button',
    risk: 'normal',
  },
  {
    id: 'ui-sidebar-documentpreview',
    titleZh: '官方文档预览',
    titleEn: 'Official document preview',
    noteZh: '右侧栏文档 / Markdown 预览 tab',
    noteEn: 'Document / Markdown preview tab',
    risk: 'normal',
  },
  {
    id: 'ui-sidebar-files',
    titleZh: '官方文件树',
    titleEn: 'Official files tree',
    noteZh: '右侧栏工作区文件树 tab',
    noteEn: 'Workspace file-tree tab',
    risk: 'normal',
  },
  {
    id: 'ui-sidebar',
    titleZh: '左侧会话列表',
    titleEn: 'Left session sidebar',
    noteZh: '高风险：禁后可能没有会话列表',
    noteEn: 'High risk: may remove the session list',
    risk: 'high',
  },
];

const ALLOWED_IDS = new Set(ALLOWLIST.map((item) => item.id));

function defaultPatchPath() {
  return join(homedir(), '.dsh', 'profiles', 'web', 'cordis.patch.yml');
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (error) {
        reject(new Error(`invalid JSON body: ${error.message}`));
      }
    });
    req.on('error', reject);
  });
}

function writeJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(body);
}

/**
 * Upsert top-level overlay `- id: <id>` / `disabled: <bool>` without reformatting
 * the rest of the file (MCP `insert:` block stays untouched).
 * @returns {{ changed: boolean, path: string }}
 */
export function upsertDisabledOverlay(patchPath, id, disabled) {
  if (!existsSync(patchPath)) {
    throw new Error(`profile patch not found: ${patchPath}`);
  }
  let raw = readFileSync(patchPath, 'utf8');
  if (!raw.endsWith('\n')) raw += '\n';

  const block = `- id: ${id}\n  disabled: ${disabled}\n`;
  // Top-level only: line starts with `- id:` (indented `  - id:` under insert is ignored).
  const re = new RegExp(`^- id: ${escapeRegExp(id)}\\n(?:  [^\\n]*\\n)*`, 'm');
  let changed = false;
  if (re.test(raw)) {
    const next = raw.replace(re, block);
    if (next !== raw) {
      raw = next;
      changed = true;
    }
  } else {
    raw += block;
    changed = true;
  }

  if (changed) writeFileSync(patchPath, raw, 'utf8');
  return { changed, path: patchPath };
}

function entryEnabled(loader, id) {
  for (const entry of loader.entries()) {
    if (entry.options?.id === id) return !entry.disabled;
  }
  return null;
}

export function apply(ctx, config = {}) {
  const webServer = ctx.get('webServer');
  const loader = ctx.get('loader');
  if (webServer === undefined || loader === undefined) {
    console.warn('[dsh-plugin-switch] webServer/loader unavailable — host half disabled');
    return;
  }

  const patchPath = typeof config.patchPath === 'string' && config.patchPath.length > 0
    ? config.patchPath
    : defaultPatchPath();

  const reject = (req) => {
    const connection = ctx.get('connection');
    if (connection && typeof connection.requestRejection === 'function') {
      return connection.requestRejection(req);
    }
    return undefined;
  };

  function listPayload() {
    return {
      ok: true,
      patchPath,
      items: ALLOWLIST.map((meta) => {
        const enabled = entryEnabled(loader, meta.id);
        return {
          ...meta,
          enabled,
          present: enabled !== null,
        };
      }),
    };
  }

  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: PATH_LIST,
    handler: async (req, res) => {
      try {
        const rejection = reject(req);
        if (rejection !== undefined) {
          writeJson(res, rejection, { ok: false, error: rejection === 401 ? 'unauthorized' : 'forbidden' });
          return;
        }
        if (req.method !== 'GET') {
          writeJson(res, 405, { ok: false, error: 'method not allowed (use GET)' });
          return;
        }
        writeJson(res, 200, listPayload());
      } catch (error) {
        writeJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    },
  }), 'plugin-switch: list');

  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: PATH_SET,
    handler: async (req, res) => {
      try {
        const rejection = reject(req);
        if (rejection !== undefined) {
          writeJson(res, rejection, { ok: false, error: rejection === 401 ? 'unauthorized' : 'forbidden' });
          return;
        }
        if (req.method !== 'POST') {
          writeJson(res, 405, { ok: false, error: 'method not allowed (use POST)' });
          return;
        }
        const body = await readJsonBody(req);
        const id = body?.id;
        const enabled = body?.enabled;
        if (typeof id !== 'string' || !ALLOWED_IDS.has(id)) {
          writeJson(res, 400, { ok: false, error: 'id is not in the allowlist' });
          return;
        }
        if (typeof enabled !== 'boolean') {
          writeJson(res, 400, { ok: false, error: 'enabled must be a boolean' });
          return;
        }
        if (id === 'plugin-switch') {
          writeJson(res, 400, { ok: false, error: 'refusing to toggle self' });
          return;
        }

        const result = upsertDisabledOverlay(patchPath, id, !enabled);
        console.log(`[dsh-plugin-switch] set ${id} enabled=${enabled} changed=${result.changed} → ${patchPath}`);
        writeJson(res, 200, {
          ok: true,
          id,
          enabled,
          changed: result.changed,
          patchPath,
          hint: 'profile patchReload:live will reapply the overlay; refresh the list in 1–2s',
        });
      } catch (error) {
        writeJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    },
  }), 'plugin-switch: set');

  console.log(`[dsh-plugin-switch] host ready: ${PATH_LIST} / ${PATH_SET} (patch=${patchPath})`);
}
