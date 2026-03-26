import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as yamlParse, stringify as yamlStringify } from "yaml";
import {
  CowboyConfigSchema,
  type CowboyConfig,
  type AgentType,
  type ClaudeGenerationDefaults,
  type CodexGenerationDefaults,
} from "./schemas.js";

const COWBOY_CONFIG_PATH = [".cowboy", "config.yaml"] as const;

export async function readCowboyConfig(
  projectDir: string,
): Promise<CowboyConfig | null> {
  try {
    const raw = await readFile(join(projectDir, ...COWBOY_CONFIG_PATH), "utf-8");
    return CowboyConfigSchema.parse(yamlParse(raw) ?? {});
  } catch {
    return null;
  }
}

export async function writeCowboyConfig(
  projectDir: string,
  config: CowboyConfig,
): Promise<void> {
  const dir = join(projectDir, ".cowboy");
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(projectDir, ...COWBOY_CONFIG_PATH),
    yamlStringify(config),
    "utf-8",
  );
}

export async function getConfiguredAgents(
  projectDir: string,
): Promise<AgentType[]> {
  const config = await readCowboyConfig(projectDir);
  return config?.agents ?? [];
}

export async function getDefaultConfiguredAgent(
  projectDir: string,
): Promise<AgentType | null> {
  const config = await readCowboyConfig(projectDir);
  return config?.default_agent ?? null;
}

export async function getPreferredConfiguredAgent(
  projectDir: string,
): Promise<AgentType | null> {
  const config = await readCowboyConfig(projectDir);
  return config?.default_agent ?? null;
}

export async function setDefaultConfiguredAgent(
  projectDir: string,
  agent: AgentType,
): Promise<CowboyConfig> {
  const config = await readCowboyConfig(projectDir);
  if (!config) {
    throw new Error("Cowboy is not initialized in this project.");
  }

  const nextConfig: CowboyConfig = {
    ...config,
    default_agent: agent,
  };

  await writeCowboyConfig(projectDir, nextConfig);
  return nextConfig;
}

export async function getClaudeGenerationDefaults(
  projectDir: string,
): Promise<ClaudeGenerationDefaults | null> {
  const config = await readCowboyConfig(projectDir);
  return config?.generation_defaults?.claude ?? null;
}

export async function getCodexGenerationDefaults(
  projectDir: string,
): Promise<CodexGenerationDefaults | null> {
  const config = await readCowboyConfig(projectDir);
  return config?.generation_defaults?.codex ?? null;
}
