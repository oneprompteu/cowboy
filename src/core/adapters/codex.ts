import { stringify as yamlStringify } from "yaml";
import type { AgentAdapter, InstallResult } from "./base.js";
import type { ScannedSkill } from "../schemas.js";
import {
  ensureProjectAgentLink,
  getGlobalAgentViewDir,
  removeProjectAgentLink,
  writeSkillPackageToDir,
} from "../global-storage.js";

export class CodexAdapter implements AgentAdapter {
  readonly agentType = "codex" as const;

  async install(
    skill: ScannedSkill,
    projectDir: string,
  ): Promise<InstallResult> {
    let hasOpenAIYaml = false;

    for (const file of skill.files ?? []) {
      if (file.relativePath === "agents/openai.yaml") {
        hasOpenAIYaml = true;
      }
    }

    const globalViewDir = getGlobalAgentViewDir(this.agentType, skill.name);
    await writeSkillPackageToDir(skill, globalViewDir, {
      extraTextFiles: hasOpenAIYaml
        ? undefined
        : [{ relativePath: "agents/openai.yaml", content: generateOpenAIYaml(skill) }],
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
