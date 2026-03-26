import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { writeCowboyConfig } from "../src/core/config.js";
import {
  parseAgentSelection,
  resolveInstallAgents,
} from "../src/core/agent-selection.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "cowboy-test-agent-selection-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("parseAgentSelection", () => {
  it("parses repeated and comma-separated agent values", () => {
    expect(
      parseAgentSelection(["claude", "codex,claude-code"]),
    ).toEqual(["claude", "codex"]);
  });

  it("rejects unknown agent values", () => {
    expect(() => parseAgentSelection(["cursor"])).toThrow(
      'Unknown agent "cursor". Use "claude" or "codex".',
    );
  });
});

describe("resolveInstallAgents", () => {
  it("defaults to configured agents", async () => {
    await writeCowboyConfig(tempDir, {
      agents: ["claude", "codex"],
      default_agent: "codex",
    });

    await expect(resolveInstallAgents(tempDir)).resolves.toEqual([
      "claude",
      "codex",
    ]);
  });

  it("allows installing for a configured subset", async () => {
    await writeCowboyConfig(tempDir, {
      agents: ["claude", "codex"],
      default_agent: "claude",
    });

    await expect(
      resolveInstallAgents(tempDir, ["codex"]),
    ).resolves.toEqual(["codex"]);
  });

  it("falls back to detected agents when Cowboy is not initialized", async () => {
    await mkdir(join(tempDir, ".agents"), { recursive: true });

    await expect(resolveInstallAgents(tempDir)).resolves.toEqual(["codex"]);
  });

  it("rejects agents that are not configured for the project", async () => {
    await writeCowboyConfig(tempDir, {
      agents: ["claude"],
      default_agent: "claude",
    });

    await expect(
      resolveInstallAgents(tempDir, ["codex"]),
    ).rejects.toThrow('Agent "codex" is not configured in this project.');
  });
});
