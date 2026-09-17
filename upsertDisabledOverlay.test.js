import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import assert from "node:assert/strict";
import { upsertDisabledOverlay } from "./index.js";

function withPatch(initial, fn) {
    const dir = mkdtempSync(join(tmpdir(), "dsh-ps-"));
    const path = join(dir, "cordis.patch.yml");
    writeFileSync(path, initial, "utf8");
    try {
        return fn(path);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

test("appends overlay when id is absent", () => {
    withPatch("- insert:\n  - id: mcp-a\n    name: x\n", (path) => {
        const r = upsertDisabledOverlay(path, "orchestrator", true);
        assert.equal(r.changed, true);
        const raw = readFileSync(path, "utf8");
        assert.match(raw, /- id: orchestrator\n  disabled: true\n$/);
        assert.match(raw, /^- insert:/m);
    });
});

test("preserves multi-line config with blank lines when toggling disabled", () => {
    const initial = `# comment
- insert:
  - id: mcp-a
    name: x
- id: orchestrator
  config:
    orientation: |
      line one

      Coordination tools: agent_spawn

      Durable: {{mesh_harness}}
- id: secretary-gate
  disabled: false
`;
    withPatch(initial, (path) => {
        const r = upsertDisabledOverlay(path, "orchestrator", true);
        assert.equal(r.changed, true);
        const raw = readFileSync(path, "utf8");
        assert.match(
            raw,
            /- id: orchestrator\n  disabled: true\n  config:\n    orientation: \|/,
        );
        assert.match(raw, /Coordination tools: agent_spawn/);
        assert.match(raw, /Durable: \{\{mesh_harness\}\}/);
        assert.match(raw, /- id: secretary-gate\n  disabled: false\n/);
        // Must remain valid-ish: no orphaned indented lines before next - id
        assert.doesNotMatch(raw, /disabled: true\n\n {2,}Coordination/);
    });
});

test("flips disabled without rewriting unchanged siblings", () => {
    const initial = `- id: ui-chat
  disabled: false
- id: orchestrator
  disabled: true
  config:
    orientation: |
      keep me

      blank above
`;
    withPatch(initial, (path) => {
        const r = upsertDisabledOverlay(path, "orchestrator", false);
        assert.equal(r.changed, true);
        const raw = readFileSync(path, "utf8");
        assert.match(raw, /- id: orchestrator\n  disabled: false\n  config:/);
        assert.match(raw, /keep me\n\n {6}blank above\n/);
        assert.match(raw, /- id: ui-chat\n  disabled: false\n/);

        const again = upsertDisabledOverlay(path, "orchestrator", false);
        assert.equal(again.changed, false);
    });
});

test("does not touch indented - id under insert", () => {
    const initial = `- insert:
  - id: orchestrator
    name: dsh-orchestrator
`;
    withPatch(initial, (path) => {
        upsertDisabledOverlay(path, "orchestrator", true);
        const raw = readFileSync(path, "utf8");
        assert.match(
            raw,
            /- insert:\n  - id: orchestrator\n    name: dsh-orchestrator\n- id: orchestrator\n  disabled: true\n/,
        );
    });
});
