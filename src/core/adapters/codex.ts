import { mkdir, writeFile, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
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
    const legacyMetadataFile = join(skillDir, "agents", "openai.yaml");

    await mkdir(skillDir, { recursive: true });
    await rm(legacyMetadataFile, { force: true });
    await writeFile(skillFile, skill.rawContent, "utf-8");

    const allFiles = [skillFile];

    if (skill.files) {
      for (const file of skill.files) {
        const filePath = join(skillDir, file.relativePath);
        await mkdir(dirname(filePath), { recursive: true });
        await writeFile(filePath, file.content);
        allFiles.push(filePath);
      }
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
