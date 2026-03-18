#!/usr/bin/env node

import { Command } from "commander";
import { checkbox, select } from "@inquirer/prompts";
import chalk from "chalk";
import { access, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { stringify as yamlStringify } from "yaml";

import { scanRepo } from "../core/scanner.js";
import { detectAgentTypes } from "../core/detector.js";
import { installSkill, installGeneratedSkill, uninstallSkill } from "../core/installer.js";
import { findSkill, readRegistry } from "../core/tracker.js";
import { generateSkill } from "../core/generator.js";
import { updateSkills } from "../core/updater.js";
import { isAgentAvailable, type AIAgent } from "../core/ai-bridge.js";
import { loadBuiltinSkills } from "../core/builtins.js";
import type { CowboyConfig, AgentType } from "../core/schemas.js";
import {
  getConfiguredAgents,
  getDefaultConfiguredAgent,
  getPreferredConfiguredAgent,
  setDefaultConfiguredAgent,
} from "../core/config.js";

const program = new Command();

program
  .name("cowboy")
  .description("Install and manage AI agent skills across coding agents")
  .version("0.1.0");

// --- cowboy init ---

program
  .command("init")
  .description("Initialize Cowboy in the current project")
  .action(async () => {
    const projectDir = process.cwd();

    const allAgents: { name: string; value: AgentType; dir: string }[] = [
      { name: "Claude Code", value: "claude", dir: ".claude" },
      { name: "Codex", value: "codex", dir: ".agents" },
    ];

    const selected = await checkbox<AgentType>({
      message: "Which agents do you use?",
      choices: allAgents.map((a) => ({
        name: a.name,
        value: a.value,
      })),
    });

    if (selected.length === 0) {
      console.log(chalk.yellow("No agents selected."));
      return;
    }

    // Create agent directories if they don't exist
    for (const agent of allAgents.filter((a) => selected.includes(a.value))) {
      await mkdir(join(projectDir, agent.dir), { recursive: true });
    }

    const config: CowboyConfig = {
      agents: selected,
      default_agent: selected.length === 1 ? selected[0] : undefined,
    };
    const cowboyDir = join(projectDir, ".cowboy");

    await mkdir(cowboyDir, { recursive: true });
    await writeFile(
      join(cowboyDir, "config.yaml"),
      yamlStringify(config),
      "utf-8",
    );

    // Install built-in skills
    const builtins = await loadBuiltinSkills();
    for (const skill of builtins) {
      await installSkill({
        skill,
        projectDir,
        agents: selected,
        sourceRepo: "builtin",
      });
      console.log(`${chalk.green("✓")} Built-in skill: ${chalk.bold(skill.name)}`);
    }

    console.log(chalk.green("\nCowboy initialized."));
    console.log(`Agents: ${selected.map((a) => chalk.cyan(a)).join(", ")}`);
    console.log(`Config written to ${chalk.dim(".cowboy/config.yaml")}`);
  });

// --- cowboy install <url> ---

program
  .command("install <github-url>")
  .description("Install skills from a GitHub repo")
  .option("--all", "Install all skills without prompting")
  .action(async (url: string, opts: { all?: boolean }) => {
    const projectDir = process.cwd();
    const agents = await detectAgentTypes(projectDir);

    if (agents.length === 0) {
      console.log(
        chalk.yellow("No agents detected. Run 'cowboy init' first."),
      );
      return;
    }

    console.log(chalk.dim(`Scanning ${url} for skills...`));
    let skills;
    try {
      skills = await scanRepo(url);
    } catch {
      console.log(chalk.red(`Repository not found: ${url}`));
      return;
    }

    if (skills.length === 0) {
      console.log(chalk.yellow("No SKILL.md files found in this repo."));
      return;
    }

    console.log(`Found ${chalk.cyan(String(skills.length))} skills.\n`);

    let selectedNames: string[];

    if (opts.all) {
      selectedNames = skills.map((s) => s.name);
    } else {
      selectedNames = await checkbox({
        message: "Select skills to install:",
        choices: skills.map((s) => ({
          name: `${s.name} — ${chalk.dim(s.description)}`,
          value: s.name,
        })),
      });
    }

    if (selectedNames.length === 0) {
      console.log("No skills selected.");
      return;
    }

    const selectedSkills = skills.filter((s) => selectedNames.includes(s.name));

    for (const skill of selectedSkills) {
      const results = await installSkill({
        skill,
        projectDir,
        agents,
        sourceRepo: url,
      });

      const agentNames = results.map((r) => r.agent).join(", ");
      console.log(`${chalk.green("✓")} ${skill.name} → ${chalk.dim(agentNames)}`);
    }

    console.log(
      `\n${chalk.green("Done.")} ${selectedSkills.length} skill(s) installed for ${agents.join(", ")}.`,
    );
  });

// --- cowboy list ---

program
  .command("list")
  .description("List installed skills")
  .action(async () => {
    const projectDir = process.cwd();
    const registry = await readRegistry(projectDir);

    if (registry.skills.length === 0) {
      console.log(chalk.dim("No skills installed."));
      return;
    }

    for (const skill of registry.skills) {
      const agents = skill.installed_for.map((a) => chalk.cyan(a)).join(", ");
      let type: string;
      if (skill.type === "imported" && skill.source_repo === "builtin") {
        type = chalk.green("builtin");
      } else if (skill.type === "imported") {
        type = chalk.blue("imported");
      } else {
        type = chalk.magenta("generated");
      }

      console.log(`  ${chalk.bold(skill.name)}  ${type}  [${agents}]`);

      if (skill.type === "imported" && skill.source_repo !== "builtin") {
        console.log(`    ${chalk.dim(skill.source_repo)}`);
      } else if (skill.type === "generated") {
        const sources = skill.sources ?? [];
        if (sources.length > 1) {
          console.log(`    ${chalk.dim(`${sources.length} repos`)}`);
        } else if (sources.length === 1) {
          console.log(`    ${chalk.dim(sources[0].repo)}`);
        } else if (skill.research_query) {
          console.log(`    ${chalk.dim(skill.research_query)}`);
        } else {
          console.log(`    ${chalk.dim("generated")}`);
        }
      }
    }

    console.log(`\n${registry.skills.length} skill(s) installed.`);
  });

// --- cowboy remove <name> ---

program
  .command("remove <name>")
  .description("Remove an installed skill")
  .action(async (name: string) => {
    const projectDir = process.cwd();
    const removed = await uninstallSkill(name, projectDir);

    if (removed) {
      console.log(`${chalk.green("✓")} Removed ${chalk.bold(name)}`);
    } else {
      console.log(chalk.yellow(`Skill "${name}" not found.`));
    }
  });

// --- cowboy agents ---

program
  .command("agents")
  .description("Show detected agents in the current project")
  .action(async () => {
    const projectDir = process.cwd();
    const agents = await detectAgentTypes(projectDir);

    if (agents.length === 0) {
      console.log(chalk.dim("No agents detected."));
      return;
    }

    console.log("Detected agents:");
    for (const agent of agents) {
      console.log(`  ${chalk.green("●")} ${agent}`);
    }
  });

// --- cowboy generate [topic] ---

program
  .command("generate")
  .description("Generate a new skill from library repos or free-text topic using AI")
  .argument("[topic...]", "Free-text topic query, e.g. langchain")
  .option("--repo <url>", "GitHub URL of the library/tool (repeatable)", (val: string, acc: string[]) => [...acc, val], [] as string[])
  .option("--name <name>", "Custom name for the skill")
  .option("--agent <agent>", "Agent to use for generation (claude or codex)")
  .action(async (topicParts: string[] | undefined, opts: { repo: string[]; name?: string; agent?: string }) => {
    const projectDir = process.cwd();
    const topic = (topicParts ?? []).join(" ").trim() || undefined;
    const repos = opts.repo;

    if (repos.length > 0 && topic) {
      console.log(chalk.yellow("Use either --repo or a free-text topic, not both."));
      return;
    }

    if (repos.length === 0 && !topic) {
      console.log(
        chalk.yellow("Provide either --repo <url> or a free-text topic such as 'langchain'."),
      );
      return;
    }

    let aiAgent: AIAgent;
    try {
      aiAgent = await resolveGenerateAgent(projectDir, opts.agent);
    } catch (err: any) {
      console.log(chalk.red(err.message));
      return;
    }

    if (!aiAgent) {
      console.log(
        chalk.yellow("No configured agent found. Run 'cowboy init' first."),
      );
      return;
    }

    if (!await isAgentAvailable(aiAgent)) {
      console.log(
        chalk.red(
          `Configured agent CLI not found for ${aiAgent}. Install ${getAgentInstallHint(aiAgent)}.`,
        ),
      );
      return;
    }

    try {
      await ensureBuiltinSkillInstalled(projectDir, aiAgent, "skill-creator");
    } catch (err: any) {
      console.log(chalk.red(`Failed to prepare skill-creator: ${err.message}`));
      return;
    }

    console.log(
      chalk.dim(
        repos.length > 0
          ? `Using ${aiAgent} to generate skill from ${repos.length} repo(s)...`
          : `Using ${aiAgent} to generate skill from topic "${topic}"...`,
      ),
    );

    try {
      const { skill, sources } = await generateSkill({
        projectDir,
        aiAgent,
        skillName: opts.name,
        source: repos.length > 0
          ? { type: "repo", libraryRepos: repos }
          : { type: "topic", researchQuery: topic! },
        onProgress: (msg) => console.log(chalk.dim(msg)),
      });

      const results = await installGeneratedSkill({
        skill,
        projectDir,
        agents: [aiAgent],
        sources: sources.length > 0 ? sources : undefined,
        researchQuery: topic,
      });

      const agentNames = results.map((r) => r.agent).join(", ");
      console.log(
        `${chalk.green("✓")} Generated ${chalk.bold(skill.name)} → ${chalk.dim(agentNames)}`,
      );
      console.log(chalk.dim(`  ${skill.description}`));
    } catch (err: any) {
      console.log(chalk.red(`Generation failed: ${err.message}`));
    }
  });

// --- cowboy update [name] ---

program
  .command("update [name]")
  .description("Update installed skills (all or by name)")
  .action(async (name?: string) => {
    const projectDir = process.cwd();
    const registry = await readRegistry(projectDir);

    if (registry.skills.length === 0) {
      console.log(chalk.dim("No skills installed."));
      return;
    }

    if (name && !registry.skills.find((s) => s.name === name)) {
      console.log(chalk.yellow(`Skill "${name}" not found.`));
      return;
    }

    const targetSkills = name
      ? registry.skills.filter((skill) => skill.name === name)
      : registry.skills;
    const needsAIAgent = targetSkills.some((skill) => skill.type === "generated");
    let aiAgent: AIAgent | undefined;

    if (needsAIAgent) {
      aiAgent = await getConfiguredAgent(projectDir) ?? undefined;

      if (!aiAgent) {
        console.log(
          chalk.yellow("No configured agent found. Run 'cowboy init' first."),
        );
        return;
      }

      if (!await isAgentAvailable(aiAgent)) {
        console.log(
          chalk.red(
            `Configured agent CLI not found for ${aiAgent}. Install ${getAgentInstallHint(aiAgent)}.`,
          ),
        );
        return;
      }
    }

    const target = name ? `"${name}"` : "all skills";
    console.log(chalk.dim(`Checking updates for ${target}...`));

    try {
      const results = await updateSkills({
        projectDir,
        skillName: name,
        aiAgent: aiAgent ?? undefined,
        onProgress: (msg) => console.log(chalk.dim(msg)),
      });

      let updatedCount = 0;
      for (const result of results) {
        if (result.updated) {
          console.log(
            `${chalk.green("✓")} ${result.name} — ${chalk.dim(result.reason)}`,
          );
          updatedCount++;
        } else {
          console.log(
            `${chalk.dim("·")} ${result.name} — ${chalk.dim(result.reason)}`,
          );
        }
      }

      console.log(
        `\n${updatedCount > 0 ? chalk.green(`${updatedCount} skill(s) updated.`) : chalk.dim("Everything up to date.")}`,
      );
    } catch (err: any) {
      console.log(chalk.red(`Update failed: ${err.message}`));
    }
  });

program
  .command("default-agent <agent>")
  .description("Set the default agent used by Cowboy")
  .action(async (agentName: string) => {
    const projectDir = process.cwd();
    const agent = parseAgentType(agentName);

    if (!agent) {
      console.log(
        chalk.red(`Unknown agent "${agentName}". Use "claude" or "codex".`),
      );
      return;
    }

    try {
      await setDefaultConfiguredAgent(projectDir, agent);
      console.log(
        `${chalk.green("✓")} Default agent set to ${chalk.cyan(agent)}`,
      );
    } catch (err: any) {
      console.log(chalk.red(err.message));
    }
  });

program.parse();

async function getConfiguredAgent(projectDir: string): Promise<AIAgent | null> {
  const agent = await getPreferredConfiguredAgent(projectDir);
  return agent;
}

async function resolveGenerateAgent(
  projectDir: string,
  requestedAgent?: string,
): Promise<AIAgent> {
  const configuredAgents = await getConfiguredAgents(projectDir);

  if (configuredAgents.length === 0) {
    throw new Error("No configured agent found. Run 'cowboy init' first.");
  }

  if (requestedAgent) {
    const agent = parseAgentType(requestedAgent);
    if (!agent) {
      throw new Error(
        `Unknown agent "${requestedAgent}". Use "claude" or "codex".`,
      );
    }

    if (!configuredAgents.includes(agent)) {
      throw new Error(`Agent "${agent}" is not configured in this project.`);
    }

    return agent;
  }

  if (configuredAgents.length === 1) {
    return configuredAgents[0];
  }

  const defaultAgent = await getDefaultConfiguredAgent(projectDir);
  if (defaultAgent && configuredAgents.includes(defaultAgent)) {
    return defaultAgent;
  }

  return await select<AIAgent>({
    message: "Which agent should generate this skill?",
    choices: configuredAgents.map((agent) => ({
      name: formatAgentLabel(agent),
      value: agent,
    })),
  });
}

async function ensureBuiltinSkillInstalled(
  projectDir: string,
  agent: AgentType,
  skillName: string,
): Promise<void> {
  const skillPath = agent === "claude"
    ? join(projectDir, ".claude", "skills", skillName, "SKILL.md")
    : join(projectDir, ".agents", "skills", skillName, "SKILL.md");

  if (await exists(skillPath)) {
    return;
  }

  const builtins = await loadBuiltinSkills();
  const skill = builtins.find((entry) => entry.name === skillName);
  if (!skill) {
    throw new Error(`Built-in skill "${skillName}" not found.`);
  }

  const existing = await findSkill(projectDir, skillName);
  const agents = existing
    ? Array.from(new Set([...existing.installed_for, agent]))
    : [agent];

  await installSkill({
    skill,
    projectDir,
    agents,
    sourceRepo: "builtin",
  });
}

function getAgentInstallHint(agent: AIAgent): string {
  return agent === "claude" ? "Claude Code (claude)" : "Codex (codex)";
}

function parseAgentType(agent: string): AIAgent | null {
  if (agent === "claude" || agent === "codex") {
    return agent;
  }

  if (agent === "claude-code") {
    return "claude";
  }

  return null;
}

function formatAgentLabel(agent: AgentType): string {
  return agent === "claude" ? "Claude Code" : "Codex";
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
