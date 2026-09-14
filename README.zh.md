# dsh-plugin-switch

在 DSH Web **设置 → 插件 → 启停** 里，对白名单官方插件做启用/禁用。

## 做什么

- 设置页新增「启停」标签（与官方只读「插件列表」并列）
- 白名单（可改 `index.js` 的 `ALLOWLIST`）：
  - `ui-sidebar-right` — 官方右侧栏（含会话头展开按钮）
  - `ui-sidebar-documentpreview` — 官方文档预览
  - `ui-sidebar-files` — 官方文件树
  - `ui-sidebar` — 左侧会话列表（高风险）
- 开关写入 `~/.dsh/profiles/web/cordis.patch.yml` 顶层 overlay（`- id:` + `disabled:`），不重排其它内容
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

- 只改白名单；不会关 `plugin-switch` 自己
- 禁 `ui-sidebar` 可能导致没有会话列表
- 禁 `ui-sidebar-right` 会去掉右上角展开侧栏按钮及官方右栏
