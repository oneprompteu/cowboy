import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  getConfiguredAgents,
  getDefaultConfiguredAgent,
  getPreferredConfiguredAgent,
  readCowboyConfig,
  setDefaultConfiguredAgent,
  writeCowboyConfig,
} from "../src/core/config.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "cowboy-test-config-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("config helpers", () => {
  it("reads configured agents and preferred default agent", async () => {
    await writeCowboyConfig(tempDir, {
      agents: ["claude", "codex"],
      default_agent: "codex",
    });

    expect(await getConfiguredAgents(tempDir)).toEqual([
      "claude",
      "codex",
    ]);
    expect(await getDefaultConfiguredAgent(tempDir)).toBe("codex");
    expect(await getPreferredConfiguredAgent(tempDir)).toBe("codex");
  });

  it("falls back to the first configured agent when no default is set", async () => {
    await writeCowboyConfig(tempDir, {
      agents: ["claude", "codex"],
    });

    expect(await getPreferredConfiguredAgent(tempDir)).toBe("claude");
  });

  it("sets the default agent in config.yaml", async () => {
    await writeCowboyConfig(tempDir, {
      agents: ["claude", "codex"],
    });

    await setDefaultConfiguredAgent(tempDir, "codex");

    const config = await readCowboyConfig(tempDir);
    expect(config?.default_agent).toBe("codex");
  });

  it("rejects setting a default agent that is not configured", async () => {
    await writeCowboyConfig(tempDir, {
      agents: ["claude"],
    });

    await expect(() =>
      setDefaultConfiguredAgent(tempDir, "codex"),
    ).rejects.toThrow('Agent "codex" is not configured');
  });
});
