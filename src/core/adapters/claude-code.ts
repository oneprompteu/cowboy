import type { AgentAdapter, InstallResult } from "./base.js";
import type { ScannedSkill } from "../schemas.js";
import {
  ensureProjectAgentLink,
  getGlobalAgentViewDir,
  removeProjectAgentLink,
  writeSkillPackageToDir,
} from "../global-storage.js";

export class ClaudeCodeAdapter implements AgentAdapter {
  readonly agentType = "claude" as const;

  async install(
    skill: ScannedSkill,
    projectDir: string,
  ): Promise<InstallResult> {
    const globalViewDir = getGlobalAgentViewDir(this.agentType, skill.name);
    await writeSkillPackageToDir(skill, globalViewDir, {
      filterFile: (file) => file.relativePath !== "agents/openai.yaml",
    });
    const linkPath = await ensureProjectAgentLink(projectDir, this.agentType, skill.name);

    return {
      agent: this.agentType,
      skillName: skill.name,
      files: [linkPath],
    };
  }

  async remove(skillName: string, projectDir: string): Promise<void> {
    await removeProjectAgentLink(projectDir, this.agentType, skillName);
  }
}
