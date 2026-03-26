import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { writeCowboyConfig } from "../src/core/config.js";
import { resolveAgentRuntimeOptions } from "../src/core/agent-runtime.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "cowboy-test-agent-runtime-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("resolveAgentRuntimeOptions", () => {
  it("reads Claude defaults from config", async () => {
    await writeCowboyConfig(tempDir, {
      agents: ["claude"],
      generation_defaults: {
        claude: {
          model: "sonnet",
          effort: "high",
        },
      },
    });

    await expect(
      resolveAgentRuntimeOptions(tempDir, "claude"),
    ).resolves.toEqual({
      model: "sonnet",
      effort: "high",
    });
  });

  it("reads Codex defaults from config", async () => {
    await writeCowboyConfig(tempDir, {
      agents: ["codex"],
      generation_defaults: {
        codex: {
          effort: "xhigh",
        },
      },
    });

    await expect(
      resolveAgentRuntimeOptions(tempDir, "codex"),
    ).resolves.toEqual({
      effort: "xhigh",
    });
  });

  it("lets CLI overrides replace configured defaults", async () => {
    await writeCowboyConfig(tempDir, {
      agents: ["claude", "codex"],
      generation_defaults: {
        claude: {
          model: "opus",
          effort: "medium",
        },
        codex: {
          effort: "high",
        },
      },
    });

    await expect(
      resolveAgentRuntimeOptions(tempDir, "claude", {
        claudeModel: "sonnet",
        effort: "max",
      }),
    ).resolves.toEqual({
      model: "sonnet",
      effort: "max",
    });
  });

  it("rejects invalid Claude effort values", async () => {
    await expect(
      resolveAgentRuntimeOptions(tempDir, "claude", { effort: "xhigh" }),
    ).rejects.toThrow('Invalid Claude effort "xhigh"');
  });

  it("rejects --claude-model for Codex", async () => {
    await expect(
      resolveAgentRuntimeOptions(tempDir, "codex", { claudeModel: "sonnet" }),
    ).rejects.toThrow("--claude-model can only be used");
  });
});
