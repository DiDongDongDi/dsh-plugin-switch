// dsh-plugin-switch — host half
//
// 在设置「插件」分区提供「启停」页的后端：
//   GET  /api/plugin-switch/list  → 当前组合全部非 group 插件 + enabled
//   POST /api/plugin-switch/set   → { id, enabled } 写 profile cordis.patch.yml
//
// 持久化只改 ~/.dsh/profiles/web/cordis.patch.yml 的顶层 overlay
// （`- id: …` + `disabled:`），靠 profile patchReload:live 热生效。
// 刻意不调 loader.update().write()，避免把合成树整表写回配置文件。
// 写盘用「顶层块正则替换 / 追加」，不整文件 YAML 重排，避免打乱 MCP insert。

import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

export const name = "plugin-switch";
export const inject = ["webServer", "loader"];

const PATH_LIST = "/api/plugin-switch/list";
const PATH_SET = "/api/plugin-switch/set";
const MAX_BODY_BYTES = 16 * 1024;

/** Self entry — never allow toggling off (would brick this UI). */
const SELF_IDS = new Set(["plugin-switch"]);
const SELF_NAMES = new Set(["dsh-plugin-switch"]);

/**
 * Ids that must stay enabled: other entries inject their provided services,
 * and disabling them leaves web boot pending forever ("Failed to load plugins").
 * Re-enable is always allowed (recovery path).
 */
export const DISABLE_BLOCKED = {
    "ui-sidebar-right": {
        reasonZh:
            "禁止禁用：ui-chat / documentpreview / files 依赖 sidebarRight(Tabs)；禁后会 Failed to load plugins",
        reasonEn:
            "Cannot disable: ui-chat / documentpreview / files inject sidebarRight(Tabs); boot fails with pending entries",
    },
};

/**
 * Optional display / risk annotations. Unknown ids still appear; they fall
 * back to module name as title.
 */
export const META = {
    "ui-sidebar-right": {
        titleZh: "官方右侧栏",
        titleEn: "Official right sidebar",
        noteZh: "提供 sidebarRight / sidebarRightTabs；含会话头「展开侧栏」按钮。禁用会拖垮 chat，已锁定。",
        noteEn: "Provides sidebarRight / sidebarRightTabs (incl. header expand). Disabling bricks chat — locked.",
        risk: "high",
    },
    "ui-sidebar-documentpreview": {
        titleZh: "官方文档预览",
        titleEn: "Official document preview",
        noteZh: "右侧栏文档 / Markdown 预览 tab（依赖 sidebarRightTabs）",
        noteEn: "Document / Markdown preview tab (needs sidebarRightTabs)",
        risk: "normal",
    },
    "ui-sidebar-files": {
        titleZh: "官方文件树",
        titleEn: "Official files tree",
        noteZh: "右侧栏工作区文件树 tab（依赖 sidebarRightTabs）",
        noteEn: "Workspace file-tree tab (needs sidebarRightTabs)",
        risk: "normal",
    },
    "ui-sidebar": {
        titleZh: "左侧会话列表",
        titleEn: "Left session sidebar",
        noteZh: "高风险：禁后可能没有会话列表",
        noteEn: "High risk: may remove the session list",
        risk: "high",
    },
};

function defaultPatchPath() {
    return join(homedir(), ".dsh", "profiles", "web", "cordis.patch.yml");
}

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readJsonBody(req) {
    return new Promise((resolve, reject) => {
        let size = 0;
        const chunks = [];
        req.on("data", (chunk) => {
            size += chunk.length;
            if (size > MAX_BODY_BYTES) {
                reject(new Error("request body too large"));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on("end", () => {
            if (chunks.length === 0) {
                resolve({});
                return;
            }
            try {
                resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
            } catch (error) {
                reject(new Error(`invalid JSON body: ${error.message}`));
            }
        });
        req.on("error", reject);
    });
}

function writeJson(res, status, payload) {
    const body = JSON.stringify(payload);
    res.writeHead(status, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
    });
    res.end(body);
}

/**
 * Match a top-level `- id: <id>` overlay block (until the next top-level `- `
 * item or EOF). Includes blank lines and nested YAML so multi-line `config:`
 * (e.g. `orientation: |`) is not truncated mid-block.
 */
function matchTopLevelIdBlock(raw, id) {
    const re = new RegExp(
        `^(- id: ${escapeRegExp(id)}\\n)((?:(?!^- ).*\\n)*)`,
        "m",
    );
    const match = raw.match(re);
    if (!match || match.index === undefined) return null;
    return {
        index: match.index,
        length: match[0].length,
        head: match[1],
        body: match[2],
    };
}

/**
 * Upsert top-level overlay `- id: <id>` / `disabled: <bool>` without reformatting
 * the rest of the file (MCP `insert:` block stays untouched).
 * Preserves other keys on an existing overlay (e.g. `config:`).
 * @returns {{ changed: boolean, path: string }}
 */
export function upsertDisabledOverlay(patchPath, id, disabled) {
    if (!existsSync(patchPath)) {
        throw new Error(`profile patch not found: ${patchPath}`);
    }
    let raw = readFileSync(patchPath, "utf8");
    if (!raw.endsWith("\n")) raw += "\n";

    let changed = false;
    const found = matchTopLevelIdBlock(raw, id);
    if (found) {
        let body = found.body;
        if (/^  disabled:\s*(?:true|false)\s*\n/m.test(body)) {
            const nextBody = body.replace(
                /^  disabled:\s*(?:true|false)\s*\n/m,
                `  disabled: ${disabled}\n`,
            );
            if (nextBody !== body) {
                body = nextBody;
                changed = true;
            }
        } else {
            body = `  disabled: ${disabled}\n` + body;
            changed = true;
        }
        if (changed) {
            raw =
                raw.slice(0, found.index) +
                found.head +
                body +
                raw.slice(found.index + found.length);
        }
    } else {
        raw += `- id: ${id}\n  disabled: ${disabled}\n`;
        changed = true;
    }

    if (changed) writeFileSync(patchPath, raw, "utf8");
    return { changed, path: patchPath };
}

function isSelfEntry(id, moduleName) {
    return SELF_IDS.has(id) || SELF_NAMES.has(moduleName);
}

/**
 * Flatten loader entries the same way official plugin-inventory does:
 * skip group rows; use options.id as the toggle key.
 */
export function collectToggleItems(loader) {
    const items = [];
    const seen = new Set();
    for (const entry of loader.entries()) {
        if (entry.options?.group) continue;
        const id = entry.options?.id;
        if (typeof id !== "string" || id.length === 0) continue;
        if (seen.has(id)) continue;
        seen.add(id);

        const moduleName =
            typeof entry.options?.name === "string" ? entry.options.name : "";
        if (isSelfEntry(id, moduleName)) continue;

        const meta = META[id] || {};
        const block = DISABLE_BLOCKED[id];
        const titleFallback = moduleName || id;
        const noteZh = block?.reasonZh || meta.noteZh || "";
        const noteEn = block?.reasonEn || meta.noteEn || "";
        items.push({
            id,
            name: moduleName,
            titleZh: meta.titleZh || titleFallback,
            titleEn: meta.titleEn || titleFallback,
            noteZh,
            noteEn,
            risk: block ? "high" : meta.risk || "normal",
            enabled: !entry.disabled,
            present: true,
            // Can always turn ON (recovery); blocked ids cannot turn OFF.
            canDisable: !block,
            toggleable: true,
        });
    }
    items.sort((a, b) => {
        if (a.risk === "high" && b.risk !== "high") return -1;
        if (b.risk === "high" && a.risk !== "high") return 1;
        return a.id.localeCompare(b.id);
    });
    return items;
}

function findEntry(loader, id) {
    for (const entry of loader.entries()) {
        if (entry.options?.group) continue;
        if (entry.options?.id === id) return entry;
    }
    return null;
}

export function apply(ctx, config = {}) {
    const webServer = ctx.get("webServer");
    const loader = ctx.get("loader");
    if (webServer === undefined || loader === undefined) {
        console.warn(
            "[dsh-plugin-switch] webServer/loader unavailable — host half disabled",
        );
        return;
    }

    const patchPath =
        typeof config.patchPath === "string" && config.patchPath.length > 0
            ? config.patchPath
            : defaultPatchPath();

    const reject = (req) => {
        const connection = ctx.get("connection");
        if (connection && typeof connection.requestRejection === "function") {
            return connection.requestRejection(req);
        }
        return undefined;
    };

    function listPayload() {
        return {
            ok: true,
            patchPath,
            items: collectToggleItems(loader),
        };
    }

    ctx.effect(
        () =>
            webServer.register({
                kind: "exact",
                path: PATH_LIST,
                handler: async (req, res) => {
                    try {
                        const rejection = reject(req);
                        if (rejection !== undefined) {
                            writeJson(res, rejection, {
                                ok: false,
                                error:
                                    rejection === 401
                                        ? "unauthorized"
                                        : "forbidden",
                            });
                            return;
                        }
                        if (req.method !== "GET") {
                            writeJson(res, 405, {
                                ok: false,
                                error: "method not allowed (use GET)",
                            });
                            return;
                        }
                        writeJson(res, 200, listPayload());
                    } catch (error) {
                        writeJson(res, 500, {
                            ok: false,
                            error:
                                error instanceof Error
                                    ? error.message
                                    : String(error),
                        });
                    }
                },
            }),
        "plugin-switch: list",
    );

    ctx.effect(
        () =>
            webServer.register({
                kind: "exact",
                path: PATH_SET,
                handler: async (req, res) => {
                    try {
                        const rejection = reject(req);
                        if (rejection !== undefined) {
                            writeJson(res, rejection, {
                                ok: false,
                                error:
                                    rejection === 401
                                        ? "unauthorized"
                                        : "forbidden",
                            });
                            return;
                        }
                        if (req.method !== "POST") {
                            writeJson(res, 405, {
                                ok: false,
                                error: "method not allowed (use POST)",
                            });
                            return;
                        }
                        const body = await readJsonBody(req);
                        const id = body?.id;
                        const enabled = body?.enabled;
                        if (typeof id !== "string" || id.trim().length === 0) {
                            writeJson(res, 400, {
                                ok: false,
                                error: "id must be a non-empty string",
                            });
                            return;
                        }
                        if (typeof enabled !== "boolean") {
                            writeJson(res, 400, {
                                ok: false,
                                error: "enabled must be a boolean",
                            });
                            return;
                        }

                        const entry = findEntry(loader, id);
                        if (!entry) {
                            writeJson(res, 404, {
                                ok: false,
                                error: `plugin entry not found: ${id}`,
                            });
                            return;
                        }
                        const moduleName =
                            typeof entry.options?.name === "string"
                                ? entry.options.name
                                : "";
                        if (isSelfEntry(id, moduleName)) {
                            writeJson(res, 400, {
                                ok: false,
                                error: "refusing to toggle self",
                            });
                            return;
                        }

                        const block = DISABLE_BLOCKED[id];
                        if (enabled === false && block) {
                            writeJson(res, 400, {
                                ok: false,
                                error: block.reasonEn,
                                errorZh: block.reasonZh,
                            });
                            return;
                        }

                        const result = upsertDisabledOverlay(
                            patchPath,
                            id,
                            !enabled,
                        );
                        console.log(
                            `[dsh-plugin-switch] set ${id} enabled=${enabled} changed=${result.changed} → ${patchPath}`,
                        );
                        writeJson(res, 200, {
                            ok: true,
                            id,
                            enabled,
                            changed: result.changed,
                            patchPath,
                            hint: "profile patchReload:live will reapply the overlay; refresh the list in 1–2s",
                        });
                    } catch (error) {
                        writeJson(res, 500, {
                            ok: false,
                            error:
                                error instanceof Error
                                    ? error.message
                                    : String(error),
                        });
                    }
                },
            }),
        "plugin-switch: set",
    );

    console.log(
        `[dsh-plugin-switch] host ready: ${PATH_LIST} / ${PATH_SET} (patch=${patchPath})`,
    );
}
