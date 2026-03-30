#!/usr/bin/env node

import { Command } from "commander";
import { checkbox, select } from "@inquirer/prompts";
import chalk from "chalk";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stringify as yamlStringify } from "yaml";

import { scanRepo } from "../core/scanner.js";
import { detectAgentTypes } from "../core/detector.js";
import {
  addGlobalSkillToProject,
  disableSkill,
  enableSkill,
  installGeneratedSkill,
  installSkill,
  removeGlobalSkill,
  uninstallSkill,
} from "../core/installer.js";
import { findGlobalSkill, readGlobalRegistry, readRegistry } from "../core/tracker.js";
import { generateSkill, resolveDocSources } from "../core/generator.js";
import { updateSkills } from "../core/updater.js";
import { detectAvailableAgents, isAgentAvailable, type AIAgent } from "../core/ai-bridge.js";
import type { CowboyConfig, AgentType } from "../core/schemas.js";
import { resolveInstallAgents } from "../core/agent-selection.js";
import {
  CLAUDE_EFFORT_CHOICES,
  CLAUDE_MODEL_CHOICES,
  CODEX_EFFORT_CHOICES,
  resolveAgentRuntimeOptions,
} from "../core/agent-runtime.js";
import {
  getDefaultConfiguredAgent,
  setDefaultConfiguredAgent,
} from "../core/config.js";
import { ensureGlobalStorageDirs } from "../core/global-storage.js";
import { migrateProjectIfNeeded } from "../core/migration.js";

const program = new Command();

program
  .name("cowboy")
  .description("Install and manage AI agent skills across coding agents")
  .version("0.1.1");

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
      message: "Which agents should Cowboy install skills for in this project?",
      choices: allAgents.map((a) => ({
        name: a.name,
        value: a.value,
      })),
    });

    if (selected.length === 0) {
      console.log(chalk.yellow("No agents selected."));
      return;
    }

    const defaultGenerationAgent = await select<AIAgent | "ask">({
      message: "Which agent should Cowboy use by default to generate and update skills?",
      choices: [
        { name: "Claude Code", value: "claude" },
        { name: "Codex", value: "codex" },
        { name: "Ask each time", value: "ask" },
      ],
    });

    const defaultClaudeModel = await select<string>({
      message: "Default Claude model for generation and updates?",
      choices: CLAUDE_MODEL_CHOICES.map((choice) => ({
        name: choice.label,
        value: choice.value,
      })),
    });

    const defaultClaudeEffort = await select<string>({
      message: "Default Claude thinking effort?",
      choices: CLAUDE_EFFORT_CHOICES.map((choice) => ({
        name: choice.label,
        value: choice.value,
      })),
    });

    const defaultCodexEffort = await select<string>({
      message: "Default Codex reasoning effort?",
      choices: CODEX_EFFORT_CHOICES.map((choice) => ({
        name: choice.label,
        value: choice.value,
      })),
    });

    // Create agent directories if they don't exist
    for (const agent of allAgents.filter((a) => selected.includes(a.value))) {
      await mkdir(join(projectDir, agent.dir), { recursive: true });
    }

    const config: CowboyConfig = {
      agents: selected,
      default_agent: defaultGenerationAgent === "ask"
        ? undefined
        : defaultGenerationAgent,
      generation_defaults: {
        claude: {
          model: defaultClaudeModel === "default" ? undefined : defaultClaudeModel,
          effort: defaultClaudeEffort === "default" ? undefined : defaultClaudeEffort as any,
        },
        codex: {
          effort: defaultCodexEffort === "default" ? undefined : defaultCodexEffort as any,
        },
      },
    };
    const cowboyDir = join(projectDir, ".cowboy");

    await mkdir(cowboyDir, { recursive: true });
    await mkdir(join(cowboyDir, "skills"), { recursive: true });
    await ensureGlobalStorageDirs();
    await writeFile(
      join(cowboyDir, "config.yaml"),
      yamlStringify(config),
      "utf-8",
    );

    console.log(chalk.green("\nCowboy initialized."));
    console.log(`Install targets: ${selected.map((a) => chalk.cyan(a)).join(", ")}`);
    console.log(
      `Default generation agent: ${
        config.default_agent ? chalk.cyan(config.default_agent) : chalk.dim("ask each time")
      }`,
    );
    console.log(
      `Claude defaults: model=${
        config.generation_defaults?.claude?.model
          ? chalk.cyan(config.generation_defaults.claude.model)
          : chalk.dim("CLI default")
      }, effort=${
        config.generation_defaults?.claude?.effort
          ? chalk.cyan(config.generation_defaults.claude.effort)
          : chalk.dim("CLI default")
      }`,
    );
    console.log(
      `Codex defaults: effort=${
        config.generation_defaults?.codex?.effort
          ? chalk.cyan(config.generation_defaults.codex.effort)
          : chalk.dim("CLI default")
      }`,
    );
    console.log(`Config written to ${chalk.dim(".cowboy/config.yaml")}`);
  });

// --- cowboy install <url> ---

program
  .command("install <github-url>")
  .description("Install skills from a GitHub repo")
  .option("--all", "Install all skills without prompting")
  .option(
    "--install-for <agent>",
    "Install for a specific agent (repeatable, supports comma-separated values)",
    (value: string, acc: string[]) => [...acc, value],
    [] as string[],
  )
  .action(async (url: string, opts: { all?: boolean; installFor: string[] }) => {
    const projectDir = process.cwd();
    await migrateProjectIfNeeded(projectDir);
    let agents: AgentType[];

    try {
      agents = await resolveInstallAgents(projectDir, opts.installFor);
    } catch (error: any) {
      console.log(chalk.yellow(error.message));
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
      const existingGlobalSkill = await findGlobalSkill(skill.name);
      const results = existingGlobalSkill
        ? await addGlobalSkillToProject(skill.name, projectDir, agents)
        : await installSkill({
            skill,
            projectDir,
            agents,
            sourceRepo: url,
          });

      const agentNames = results.map((r) => r.agent).join(", ");
      const suffix = existingGlobalSkill ? "linked from global library" : agentNames;
      console.log(`${chalk.green("✓")} ${skill.name} → ${chalk.dim(suffix)}`);
    }

    console.log(
      `\n${chalk.green("Done.")} ${selectedSkills.length} skill(s) installed for ${agents.join(", ")}.`,
    );
  });

// --- cowboy list ---

program
  .command("list")
  .description("List project skills or the global Cowboy library")
  .option("--all", "List all skills in the global Cowboy library")
  .action(async (opts: { all?: boolean }) => {
    const projectDir = process.cwd();
    const registry = await readRegistry(projectDir);

    if (opts.all) {
      const globalRegistry = await readGlobalRegistry();
      if (globalRegistry.skills.length === 0) {
        console.log(chalk.dim("No skills in the global Cowboy library."));
        return;
      }

      for (const skill of globalRegistry.skills) {
        const projectSkill = registry.skills.find((entry) => entry.name === skill.name);
        const status = projectSkill
          ? formatProjectSkillStatus(projectSkill)
          : chalk.dim("not added");
        console.log(`  ${chalk.bold(skill.name)}  ${formatSkillType(skill)}  [${status}]`);
        printSkillSourceDetails(skill);
      }

      console.log(`\n${globalRegistry.skills.length} skill(s) in the global library.`);
      return;
    }

    if (registry.skills.length === 0) {
      console.log(chalk.dim("No skills added to this project."));
      return;
    }

    for (const skill of registry.skills) {
      console.log(
        `  ${chalk.bold(skill.name)}  ${formatSkillType(skill)}  [${formatProjectSkillStatus(skill)}]`,
      );
      printSkillSourceDetails(skill);
    }

    console.log(`\n${registry.skills.length} skill(s) added to this project.`);
  });

// --- cowboy add <name> ---

program
  .command("add <name>")
  .description("Add an existing global skill to the current project")
  .option(
    "--install-for <agent>",
    "Install for a specific agent (repeatable, supports comma-separated values)",
    (value: string, acc: string[]) => [...acc, value],
    [] as string[],
  )
  .action(async (name: string, opts: { installFor: string[] }) => {
    const projectDir = process.cwd();
    await migrateProjectIfNeeded(projectDir);

    let agents: AgentType[];
    try {
      agents = await resolveInstallAgents(projectDir, opts.installFor);
    } catch (error: any) {
      console.log(chalk.yellow(error.message));
      return;
    }

    try {
      const results = await addGlobalSkillToProject(name, projectDir, agents);
      const agentNames = results.map((result) => result.agent).join(", ");
      console.log(`${chalk.green("✓")} Added ${chalk.bold(name)} → ${chalk.dim(agentNames)}`);
    } catch (error: any) {
      console.log(chalk.red(error.message));
    }
  });

// --- cowboy remove <name> ---

program
  .command("remove <name>")
  .description("Remove a skill from the project or the global library")
  .option("--global", "Remove the skill from the global Cowboy library")
  .option("--force", "Force global removal even if the skill is linked in other projects")
  .action(async (name: string, opts: { global?: boolean; force?: boolean }) => {
    const projectDir = process.cwd();
    await migrateProjectIfNeeded(projectDir);

    if (opts.global) {
      try {
        await removeGlobalSkill(name, { force: opts.force });
        console.log(`${chalk.green("✓")} Removed ${chalk.bold(name)} from the global library`);
      } catch (error: any) {
        console.log(chalk.red(error.message));
      }
      return;
    }

    const removed = await uninstallSkill(name, projectDir);
    if (!removed) {
      console.log(chalk.yellow(`Skill "${name}" not found in this project.`));
      return;
    }

    console.log(`${chalk.green("✓")} Removed ${chalk.bold(name)} from this project`);
  });

// --- cowboy enable <name> ---

program
  .command("enable <name>")
  .description("Enable a disabled skill")
  .option("--agent <type>", "Enable only for a specific agent (claude or codex)")
  .action(async (name: string, opts: { agent?: string }) => {
    const projectDir = process.cwd();
    await migrateProjectIfNeeded(projectDir);
    const agent = opts.agent as AgentType | undefined;

    try {
      const result = await enableSkill(name, projectDir, agent);
      if (!result) {
        console.log(chalk.yellow(`Skill "${name}" not found.`));
        return;
      }
      const target = agent ?? "all agents";
      console.log(`${chalk.green("✓")} Enabled ${chalk.bold(name)} for ${target}`);
    } catch (error: any) {
      console.error(chalk.red(error.message));
      process.exitCode = 1;
    }
  });

// --- cowboy disable <name> ---

program
  .command("disable <name>")
  .description("Disable a skill without removing it")
  .option("--agent <type>", "Disable only for a specific agent (claude or codex)")
  .action(async (name: string, opts: { agent?: string }) => {
    const projectDir = process.cwd();
    await migrateProjectIfNeeded(projectDir);
    const agent = opts.agent as AgentType | undefined;

    const result = await disableSkill(name, projectDir, agent);
    if (!result) {
      console.log(chalk.yellow(`Skill "${name}" not found.`));
      return;
    }
    const target = agent ?? "all agents";
    console.log(`${chalk.green("✓")} Disabled ${chalk.bold(name)} for ${target}`);
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
  .option("--docs <source>", "Documentation URL or local directory (repeatable)", (val: string, acc: string[]) => [...acc, val], [] as string[])
  .option("--name <name>", "Custom name for the skill")
  .option("--agent <agent>", "Agent to use for generation (claude or codex)")
  .option("--claude-model <model>", "Claude model override (for example: sonnet, opus, or claude-sonnet-4-6)")
  .option("--effort <level>", "Reasoning/thinking effort override for the selected agent")
  .option(
    "--install-for <agent>",
    "Install for a specific agent (repeatable, supports comma-separated values)",
    (value: string, acc: string[]) => [...acc, value],
    [] as string[],
  )
  .action(async (topicParts: string[] | undefined, opts: { repo: string[]; docs: string[]; name?: string; agent?: string; claudeModel?: string; effort?: string; installFor: string[] }) => {
    const projectDir = process.cwd();
    await migrateProjectIfNeeded(projectDir);
    const topic = (topicParts ?? []).join(" ").trim() || undefined;
    const repos = opts.repo;
    let docs = opts.docs;

    if (repos.length > 0 && topic) {
      console.log(chalk.yellow("Use either --repo or a free-text topic, not both."));
      return;
    }

    if (repos.length === 0 && !topic && docs.length === 0) {
      console.log(
        chalk.yellow("Provide --repo <url>, --docs <source>, or a free-text topic such as 'langchain'."),
      );
      return;
    }

    try {
      docs = (await resolveDocSources(docs, projectDir)).entries;
    } catch (err: any) {
      console.log(chalk.red(err.message));
      return;
    }

    let aiAgent: AIAgent;
    try {
      aiAgent = await resolveGenerateAgent(projectDir, opts.agent);
    } catch (err: any) {
      console.log(chalk.red(err.message));
      return;
    }

    let runtimeOptions;
    try {
      runtimeOptions = await resolveAgentRuntimeOptions(projectDir, aiAgent, {
        claudeModel: opts.claudeModel,
        effort: opts.effort,
      });
    } catch (err: any) {
      console.log(chalk.red(err.message));
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

    if (opts.name && await findGlobalSkill(opts.name)) {
      console.log(
        chalk.red(
          `Skill "${opts.name}" already exists in the global library. Use "cowboy add ${opts.name}" or "cowboy update ${opts.name}".`,
        ),
      );
      return;
    }

    let sourceLabel: string;
    if (repos.length > 0) {
      sourceLabel = `${repos.length} repo(s)`;
    } else if (docs.length > 0 && !topic) {
      sourceLabel = `${docs.length} doc source(s)`;
    } else {
      sourceLabel = `topic "${topic}"`;
    }
    console.log(chalk.dim(`Using ${aiAgent} to generate skill from ${sourceLabel}...`));

    let installAgents: AgentType[];
    try {
      installAgents = await resolveInstallAgents(projectDir, opts.installFor);
    } catch (err: any) {
      console.log(chalk.red(err.message));
      return;
    }

    try {
      let source: Parameters<typeof generateSkill>[0]["source"];
      if (repos.length > 0) {
        source = { type: "repo", libraryRepos: repos, docUrls: docs.length > 0 ? docs : undefined };
      } else if (topic) {
        source = { type: "topic", researchQuery: topic, docUrls: docs.length > 0 ? docs : undefined };
      } else {
        source = { type: "docs", docUrls: docs };
      }

      const { skill, sources, docUrls } = await generateSkill({
        projectDir,
        aiAgent,
        agentModel: runtimeOptions.model,
        agentEffort: runtimeOptions.effort,
        skillName: opts.name,
        source,
        onProgress: (msg) => console.log(chalk.dim(msg)),
      });

      if (await findGlobalSkill(skill.name)) {
        throw new Error(
          `Skill "${skill.name}" already exists in the global library. Use "cowboy add ${skill.name}" or "cowboy update ${skill.name}".`,
        );
      }

      const results = await installGeneratedSkill({
        skill,
        projectDir,
        agents: installAgents,
        sources: sources.length > 0 ? sources : undefined,
        docUrls: docUrls.length > 0 ? docUrls : undefined,
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
  .option("--agent <agent>", "Agent to use for updating generated skills (claude or codex)")
  .option("--claude-model <model>", "Claude model override for updates")
  .option("--effort <level>", "Reasoning/thinking effort override for updates")
  .action(async (name: string | undefined, opts: { agent?: string; claudeModel?: string; effort?: string }) => {
    const projectDir = process.cwd();
    await migrateProjectIfNeeded(projectDir);
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
    let runtimeOptions:
      | {
          model?: string;
          effort?: string;
        }
      | undefined;

    if (needsAIAgent) {
      try {
        aiAgent = await resolveGenerateAgent(projectDir, opts.agent);
        runtimeOptions = await resolveAgentRuntimeOptions(projectDir, aiAgent, {
          claudeModel: opts.claudeModel,
          effort: opts.effort,
        });
      } catch (err: any) {
        console.log(chalk.red(err.message));
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
        agentModel: runtimeOptions?.model,
        agentEffort: runtimeOptions?.effort,
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

async function resolveGenerateAgent(
  projectDir: string,
  requestedAgent?: string,
): Promise<AIAgent> {
  if (requestedAgent) {
    const agent = parseAgentType(requestedAgent);
    if (!agent) {
      throw new Error(
        `Unknown agent "${requestedAgent}". Use "claude" or "codex".`,
      );
    }

    return agent;
  }

  const defaultAgent = await getDefaultConfiguredAgent(projectDir);
  if (defaultAgent) {
    return defaultAgent;
  }

  const availableAgents = await detectAvailableAgents();
  if (availableAgents.length === 0) {
    throw new Error(
      "No AI agent CLI found. Install Claude Code or Codex, or set --agent explicitly.",
    );
  }

  if (availableAgents.length === 1) {
    return availableAgents[0];
  }

  return await select<AIAgent>({
    message: "Which agent should generate this skill?",
    choices: availableAgents.map((agent) => ({
      name: formatAgentLabel(agent),
      value: agent,
    })),
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

function formatSkillType(skill: { type: "imported" | "generated"; source_repo?: string }): string {
  if (skill.type === "imported" && skill.source_repo === "builtin") {
    return chalk.green("builtin");
  }

  if (skill.type === "imported") {
    return chalk.blue("imported");
  }

  return chalk.magenta("generated");
}

function formatProjectSkillStatus(skill: {
  installed_for: AgentType[];
  disabled_for: AgentType[];
}): string {
  const disabled = new Set(skill.disabled_for);
  return skill.installed_for
    .map((agent) => disabled.has(agent) ? chalk.dim(`${agent} (off)`) : chalk.cyan(agent))
    .join(", ");
}

function printSkillSourceDetails(skill: {
  type: "imported" | "generated";
  source_repo?: string;
  sources?: Array<{ repo: string }>;
  research_query?: string;
  doc_urls?: string[];
}): void {
  if (skill.type === "imported" && skill.source_repo && skill.source_repo !== "builtin") {
    console.log(`    ${chalk.dim(skill.source_repo)}`);
    return;
  }

  if (skill.type !== "generated") {
    return;
  }

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

  if (skill.doc_urls?.length) {
    console.log(`    ${chalk.dim(`docs: ${skill.doc_urls.join(", ")}`)}`);
  }
}
