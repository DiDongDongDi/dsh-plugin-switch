/**
 * dsh-plugin-switch — client half（预构建 CJS）
 *
 * 设置 → 插件 →「启停」标签页：对白名单 loader 条目做启用/禁用开关。
 * 数据通路：GET/POST /api/plugin-switch/*（host 改 profile cordis.patch.yml）。
 */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-switch',
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

    var react = require('react');
    var h = react.createElement;
    var useCallback = react.useCallback;
    var useEffect = react.useEffect;
    var useState = react.useState;

    if (typeof document !== 'undefined' && !document.querySelector('style[data-plugin-css="dsh-plugin-switch"]')) {
      var tag = document.createElement('style');
      tag.setAttribute('data-plugin-css', 'dsh-plugin-switch');
      tag.textContent = [
        '.dsh-ps-root{display:flex;flex-direction:column;gap:12px;padding:4px 0 16px}',
        '.dsh-ps-hint{font-size:12.5px;line-height:1.5;color:var(--dsw-alias-label-secondary,#8a93a3)}',
        '.dsh-ps-err{font-size:12.5px;color:var(--dsw-alias-label-danger,#e5484d)}',
        '.dsh-ps-card{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:14px 16px;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));border-radius:12px;background:var(--dsw-alias-bg-l2,rgba(255,255,255,.03))}',
        '.dsh-ps-card[data-risk=high]{border-color:color-mix(in srgb, var(--dsw-alias-label-danger,#e5484d) 35%, transparent)}',
        '.dsh-ps-meta{min-width:0;flex:1}',
        '.dsh-ps-title{font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary,#e8ecf4)}',
        '.dsh-ps-id{font-size:11.5px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--dsw-alias-label-tertiary,#66707e);margin-top:2px}',
        '.dsh-ps-note{font-size:12px;line-height:1.45;color:var(--dsw-alias-label-secondary,#8a93a3);margin-top:6px}',
        '.dsh-ps-badge{display:inline-block;margin-top:8px;font-size:11px;padding:1px 7px;border-radius:999px;background:rgba(229,72,77,.12);color:var(--dsw-alias-label-danger,#e5484d)}',
        '.dsh-ps-switch{flex:none;position:relative;width:44px;height:26px;border:0;border-radius:999px;cursor:pointer;background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.12));transition:background .15s}',
        '.dsh-ps-switch[aria-checked=true]{background:var(--dsw-alias-brand,#4f6ef7)}',
        '.dsh-ps-switch:disabled{opacity:.45;cursor:not-allowed}',
        '.dsh-ps-knob{position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:50%;background:#fff;transition:transform .15s}',
        '.dsh-ps-switch[aria-checked=true] .dsh-ps-knob{transform:translateX(18px)}',
        '.dsh-ps-toolbar{display:flex;align-items:center;gap:10px}',
        '.dsh-ps-refresh{border:0;border-radius:8px;padding:6px 10px;font:inherit;font-size:12.5px;cursor:pointer;color:var(--dsw-alias-label-secondary);background:transparent}',
        '.dsh-ps-refresh:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      ].join('\n');
      document.head.appendChild(tag);
    }

    var NS = 'pluginSwitch';
    var zh = {
      tab: '启停',
      hint: '仅白名单插件可开关。改动写入本机 profile 的 cordis.patch.yml，live reload 后生效；若列表未变请点刷新。',
      refresh: '刷新',
      loading: '加载中…',
      empty: '没有可管理的条目',
      missing: '当前组合未挂载',
      riskHigh: '高风险',
      error: '操作失败',
      enabled: '已启用',
      disabled: '已禁用',
    };
    var en = {
      tab: 'Toggle',
      hint: 'Only allowlisted plugins can be toggled. Writes ~/.dsh/profiles/web/cordis.patch.yml; live reload applies the change. Refresh if the list lags.',
      refresh: 'Refresh',
      loading: 'Loading…',
      empty: 'Nothing to manage',
      missing: 'Not in this composition',
      riskHigh: 'High risk',
      error: 'Failed',
      enabled: 'Enabled',
      disabled: 'Disabled',
    };

    function Switch({ checked, disabled, onChange, label }) {
      return h('button', {
        type: 'button',
        className: 'dsh-ps-switch',
        role: 'switch',
        'aria-checked': checked ? 'true' : 'false',
        'aria-label': label,
        disabled: !!disabled,
        onClick: function () {
          if (disabled) return;
          onChange(!checked);
        },
      }, h('span', { className: 'dsh-ps-knob', 'aria-hidden': true }));
    }

    function PluginSwitchTab(props) {
      var t = props.t;
      var lang = (typeof navigator !== 'undefined' && String(navigator.language || '').toLowerCase().indexOf('zh') === 0) ? 'zh' : 'en';
      var itemsState = useState(null);
      var items = itemsState[0];
      var setItems = itemsState[1];
      var errState = useState(null);
      var error = errState[0];
      var setError = errState[1];
      var busyState = useState({});
      var busy = busyState[0];
      var setBusy = busyState[1];
      var loadingState = useState(true);
      var loading = loadingState[0];
      var setLoading = loadingState[1];

      var load = useCallback(function () {
        setLoading(true);
        setError(null);
        return fetch('/api/plugin-switch/list', { method: 'GET', credentials: 'same-origin' })
          .then(function (res) { return res.json().then(function (data) { return { res: res, data: data }; }); })
          .then(function (pair) {
            if (!pair.res.ok || !pair.data.ok) {
              throw new Error((pair.data && pair.data.error) || ('HTTP ' + pair.res.status));
            }
            setItems(pair.data.items || []);
          })
          .catch(function (err) {
            setError(err instanceof Error ? err.message : String(err));
          })
          .finally(function () { setLoading(false); });
      }, []);

      useEffect(function () { load(); }, [load]);

      function setEnabled(id, enabled) {
        var nextBusy = Object.assign({}, busy);
        nextBusy[id] = true;
        setBusy(nextBusy);
        setError(null);
        fetch('/api/plugin-switch/set', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: id, enabled: enabled }),
        })
          .then(function (res) { return res.json().then(function (data) { return { res: res, data: data }; }); })
          .then(function (pair) {
            if (!pair.res.ok || !pair.data.ok) {
              throw new Error((pair.data && pair.data.error) || ('HTTP ' + pair.res.status));
            }
            // Optimistic update, then refresh after live reload.
            setItems(function (prev) {
              if (!prev) return prev;
              return prev.map(function (row) {
                return row.id === id ? Object.assign({}, row, { enabled: enabled }) : row;
              });
            });
            setTimeout(function () { load(); }, 1200);
          })
          .catch(function (err) {
            setError(err instanceof Error ? err.message : String(err));
          })
          .finally(function () {
            setBusy(function (prev) {
              var copy = Object.assign({}, prev);
              delete copy[id];
              return copy;
            });
          });
      }

      var cards = (items || []).map(function (row) {
        var title = lang === 'zh' ? row.titleZh : row.titleEn;
        var note = lang === 'zh' ? row.noteZh : row.noteEn;
        var checked = row.enabled === true;
        var missing = row.present === false;
        return h('div', {
          key: row.id,
          className: 'dsh-ps-card',
          'data-risk': row.risk || 'normal',
        },
          h('div', { className: 'dsh-ps-meta' },
            h('div', { className: 'dsh-ps-title' }, title),
            h('div', { className: 'dsh-ps-id' }, row.id),
            note ? h('div', { className: 'dsh-ps-note' }, note) : null,
            row.risk === 'high' ? h('span', { className: 'dsh-ps-badge' }, t('riskHigh')) : null,
            missing ? h('div', { className: 'dsh-ps-note' }, t('missing')) : null
          ),
          h(Switch, {
            checked: checked,
            disabled: missing || !!busy[row.id],
            label: checked ? t('enabled') : t('disabled'),
            onChange: function (next) { setEnabled(row.id, next); },
          })
        );
      });

      return h('div', { className: 'dsh-ps-root' },
        h('div', { className: 'dsh-ps-toolbar' },
          h('div', { className: 'dsh-ps-hint' }, t('hint')),
          h('button', {
            type: 'button',
            className: 'dsh-ps-refresh',
            onClick: function () { load(); },
          }, t('refresh'))
        ),
        error ? h('div', { className: 'dsh-ps-err' }, t('error') + ': ' + error) : null,
        loading && !items ? h('div', { className: 'dsh-ps-hint' }, t('loading')) : null,
        !loading && items && items.length === 0 ? h('div', { className: 'dsh-ps-hint' }, t('empty')) : null,
        cards
      );
    }

    exports.name = 'dsh-plugin-switch';
    exports.inject = ['slots', 'locale'];
    exports.apply = function apply(ctx) {
      ctx.effect(function () {
        return ctx.locale.register(NS, { zh: zh, en: en });
      }, 'plugin-switch: dictionaries');

      var t = ctx.locale.bind(NS);
      ctx.slots.inject('settings.plugins.tab', function () {
        return ctx.slots.register({
          name: 'settings.plugins.tab',
          id: 'plugin-switch',
          order: 20,
          label: function () { return t('tab'); },
          locale: NS,
        }, PluginSwitchTab);
      });
    };

    return module.exports;
  },
});
