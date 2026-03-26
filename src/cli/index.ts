#!/usr/bin/env node

import { Command } from "commander";
import { checkbox, select } from "@inquirer/prompts";
import chalk from "chalk";
import { access, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { stringify as yamlStringify } from "yaml";

import { scanRepo } from "../core/scanner.js";
import { detectAgentTypes } from "../core/detector.js";
import { installSkill, installGeneratedSkill, uninstallSkill, enableSkill, disableSkill } from "../core/installer.js";
import { findSkill, readRegistry } from "../core/tracker.js";
import { generateSkill, resolveDocSources } from "../core/generator.js";
import { updateSkills } from "../core/updater.js";
import { detectAvailableAgents, isAgentAvailable, type AIAgent } from "../core/ai-bridge.js";
import { loadBuiltinSkills } from "../core/builtins.js";
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
      const disabledSet = new Set(skill.disabled_for);
      const agents = skill.installed_for
        .map((a) => disabledSet.has(a) ? chalk.dim(`${a} (off)`) : chalk.cyan(a))
        .join(", ");
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
        if (skill.doc_urls?.length) {
          console.log(`    ${chalk.dim(`docs: ${skill.doc_urls.join(", ")}`)}`);
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

// --- cowboy enable <name> ---

program
  .command("enable <name>")
  .description("Enable a disabled skill")
  .option("--agent <type>", "Enable only for a specific agent (claude or codex)")
  .action(async (name: string, opts: { agent?: string }) => {
    const projectDir = process.cwd();
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

    try {
      await ensureBuiltinSkillInstalled(projectDir, aiAgent, "skill-creator");
    } catch (err: any) {
      console.log(chalk.red(`Failed to prepare skill-creator: ${err.message}`));
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
