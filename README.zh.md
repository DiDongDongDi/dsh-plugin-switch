# dsh-plugin-switch

在 DSH Web **设置 → 插件 → 启停** 里，对当前组合内**全部**插件做启用/禁用。

## 做什么

- 设置页新增「启停」标签（与官方只读「插件列表」并列）
- 列表来自 `loader.entries()`（跳过 group、跳过本插件自身）
- 部分条目有展示用 META（如 `ui-sidebar` 标高风险）；未知 id 用包名当标题
- 开关写入 `~/.dsh/profiles/web/cordis.patch.yml` 顶层 overlay（`- id:` + `disabled:`），**保留**同条目已有的 `config:` 等字段，不重排其它内容
- 依赖 profile `patchReload: live` 热生效；不调用 `loader.update().write()`（避免写坏合成树）

## 安装

```bash
cd ~/.dsh/profiles/web
# package.json dependencies 加：
#   "dsh-plugin-switch": "github:DiDongDongDi/dsh-plugin-switch"
# dsh.profile.bundles 追加 "dsh-plugin-switch"
pnpm update dsh-plugin-switch
# 重启 dsh web + 硬刷新
```

或开发期：

```json
"dsh-plugin-switch": "file:/Users/kodyqywang/dsh-plugins-dev/dsh-plugin-switch"
```

## API

- `GET /api/plugin-switch/list`
- `POST /api/plugin-switch/set` `{ "id": "ui-sidebar-right", "enabled": false }`

## 注意

- 不会关 `plugin-switch` / `dsh-plugin-switch` 自己
- **`ui-sidebar-right` 禁止禁用**：`ui-chat` 等依赖 `sidebarRight` / `sidebarRightTabs`，禁后会 `Failed to load plugins`（pending）。若已误关，把 profile `cordis.patch.yml` 里对应 overlay 改成 `disabled: false` 或删掉该块，再重启
- 禁核心插件可能导致界面残缺或启动异常；高风险项会标红边
- 禁 `ui-sidebar` 可能导致没有会话列表
- 想去掉右上角「展开侧栏」按钮：不能靠关整个 `ui-sidebar-right`，需另做 CSS/seat 隐藏方案
