import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { detectAgents, detectAgentTypes } from "../src/core/detector.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "cowboy-test-detector-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("detectAgents", () => {
  it("detects claude from .claude/ directory", async () => {
    await mkdir(join(tempDir, ".claude"));

    const agents = await detectAgents(tempDir);

    expect(agents).toHaveLength(1);
    expect(agents[0].type).toBe("claude");
    expect(agents[0].marker).toBe(".claude");
  });

  it("detects codex from .agents/ directory", async () => {
    await mkdir(join(tempDir, ".agents"));

    const agents = await detectAgents(tempDir);

    expect(agents).toHaveLength(1);
    expect(agents[0].type).toBe("codex");
  });

  it("detects both agents", async () => {
    await mkdir(join(tempDir, ".claude"));
    await mkdir(join(tempDir, ".agents"));

    const agents = await detectAgents(tempDir);

    expect(agents).toHaveLength(2);
    const types = agents.map((a) => a.type).sort();
    expect(types).toEqual(["claude", "codex"]);
  });

  it("returns empty array when no agents detected", async () => {
    const agents = await detectAgents(tempDir);
    expect(agents).toEqual([]);
  });
});

describe("detectAgentTypes", () => {
  it("returns just agent type strings", async () => {
    await mkdir(join(tempDir, ".claude"));
    await mkdir(join(tempDir, ".agents"));

    const types = await detectAgentTypes(tempDir);

    expect(types.sort()).toEqual(["claude", "codex"]);
  });
});
