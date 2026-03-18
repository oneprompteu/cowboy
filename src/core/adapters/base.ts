import type { AgentType, ScannedSkill } from "../schemas.js";

export interface InstallResult {
  agent: AgentType;
  skillName: string;
  /** Files created by this adapter */
  files: string[];
}

export interface AgentAdapter {
  readonly agentType: AgentType;

  /** Install a skill into the project for this agent */
  install(skill: ScannedSkill, projectDir: string): Promise<InstallResult>;

  /** Remove a skill from the project for this agent */
  remove(skillName: string, projectDir: string): Promise<void>;
}
