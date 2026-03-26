import { mkdir, writeFile, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { stringify as yamlStringify } from "yaml";
import type { AgentAdapter, InstallResult } from "./base.js";
import type { ScannedSkill } from "../schemas.js";

export class CodexAdapter implements AgentAdapter {
  readonly agentType = "codex" as const;

  async install(
    skill: ScannedSkill,
    projectDir: string,
  ): Promise<InstallResult> {
    const skillDir = join(projectDir, ".agents", "skills", skill.name);
    const skillFile = join(skillDir, "SKILL.md");

    await rm(skillDir, { recursive: true, force: true });
    await mkdir(skillDir, { recursive: true });
    await writeFile(skillFile, skill.rawContent, "utf-8");

    const allFiles = [skillFile];
    let hasOpenAIYaml = false;

    if (skill.files) {
      for (const file of skill.files) {
        if (file.relativePath === join("agents", "openai.yaml")) {
          hasOpenAIYaml = true;
        }
        const filePath = join(skillDir, file.relativePath);
        await mkdir(dirname(filePath), { recursive: true });
        await writeFile(filePath, file.content);
        allFiles.push(filePath);
      }
    }

    if (!hasOpenAIYaml) {
      const yamlPath = join(skillDir, "agents", "openai.yaml");
      await mkdir(dirname(yamlPath), { recursive: true });
      await writeFile(yamlPath, generateOpenAIYaml(skill), "utf-8");
      allFiles.push(yamlPath);
    }

    return {
      agent: this.agentType,
      skillName: skill.name,
      files: allFiles,
    };
  }

  async remove(skillName: string, projectDir: string): Promise<void> {
    const skillDir = join(projectDir, ".agents", "skills", skillName);
    await rm(skillDir, { recursive: true, force: true });
  }
}

function toDisplayName(name: string): string {
  return name
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function generateOpenAIYaml(skill: ScannedSkill): string {
  return yamlStringify({
    interface: {
      display_name: toDisplayName(skill.name),
      short_description: skill.description,
      brand_color: "#000000",
      default_prompt: `Use the ${skill.name} skill`,
    },
    policy: {
      allow_implicit_invocation: true,
    },
  });
}
