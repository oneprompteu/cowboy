import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type AIAgent = "claude" | "codex";

export interface InteractiveSessionOptions {
  agent: AIAgent;
  cwd: string;
  prompt: string;
  addDirs?: string[];
}

/**
 * Check whether a specific AI CLI is available on the user's machine.
 */
export async function isAgentAvailable(agent: AIAgent): Promise<boolean> {
  try {
    await execFileAsync("which", [getAgentBinary(agent)]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Detect the first available AI CLI on the user's machine.
 */
export async function detectAvailableAgent(): Promise<AIAgent | null> {
  for (const agent of ["claude", "codex"] as const) {
    if (await isAgentAvailable(agent)) {
      return agent;
    }
  }
  return null;
}

/**
 * Build the command used to launch an interactive AI session.
 * The prompt is passed positionally so the CLI starts in agent mode.
 */
export function buildInteractiveAgentCommand(
  agent: AIAgent,
  prompt: string,
  options: {
    addDirs?: string[];
  } = {},
): [string, string[]] {
  const args: string[] = [];
  const addDirs = options.addDirs ?? [];

  if (agent === "claude") {
    args.push(prompt);

    for (const dir of addDirs) {
      args.push("--add-dir", dir);
    }

    return [getAgentBinary(agent), args];
  }

  if (agent === "codex") {
    args.push("-s", "workspace-write");
  }

  for (const dir of addDirs) {
    args.push("--add-dir", dir);
  }

  args.push(prompt);

  return [getAgentBinary(agent), args];
}

/**
 * Run a real interactive session and let the agent work directly in the workspace.
 */
export async function runInteractiveAgentSession(
  options: InteractiveSessionOptions,
): Promise<void> {
  const [cmd, args] = buildInteractiveAgentCommand(
    options.agent,
    options.prompt,
    {
      addDirs: options.addDirs ?? [],
    },
  );

  await new Promise<void>((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: options.cwd,
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${cmd} exited with code ${code}`));
    });
  });
}

/**
 * Build the command for a headless (non-interactive) AI session.
 * Codex uses `exec --full-auto`, Claude uses `-p`.
 */
export function buildHeadlessAgentCommand(
  agent: AIAgent,
  prompt: string,
  options: {
    addDirs?: string[];
  } = {},
): [string, string[]] {
  const args: string[] = [];
  const addDirs = options.addDirs ?? [];

  if (agent === "claude") {
    args.push("-p", prompt);

    for (const dir of addDirs) {
      args.push("--add-dir", dir);
    }

    return [getAgentBinary(agent), args];
  }

  // Codex: use exec mode for non-interactive operation
  args.push("exec", "--full-auto", "-s", "workspace-write", "--skip-git-repo-check");

  for (const dir of addDirs) {
    args.push("--add-dir", dir);
  }

  args.push(prompt);

  return [getAgentBinary(agent), args];
}

/**
 * Parse a line of Claude's --output-format stream-json into displayable text.
 * Returns null to skip the event.
 */
export function parseClaudeStreamEvent(line: string): string | null {
  if (!line.trim()) return null;
  try {
    const event = JSON.parse(line);
    if (event.type === "assistant" && Array.isArray(event.message?.content)) {
      const parts: string[] = [];
      for (const block of event.message.content) {
        if (block.type === "text" && block.text?.trim()) {
          parts.push(block.text);
        } else if (block.type === "tool_use") {
          const input = block.input ?? {};
          const detail = input.file_path ?? input.command ?? input.pattern ?? "";
          parts.push(`▸ ${block.name}${detail ? ` ${detail}` : ""}`);
        }
      }
      return parts.join("\n") || null;
    }
    return null;
  } catch {
    return line;
  }
}

/**
 * Build a Claude command that accepts steering via stream-json stdin.
 */
export function buildSteerableClaudeCommand(
  options: InteractiveSessionOptions,
): [string, string[]] {
  const args = [
    "-p", options.prompt,
    "--input-format", "stream-json",
    "--output-format", "stream-json",
  ];
  for (const dir of options.addDirs ?? []) {
    args.push("--add-dir", dir);
  }
  return ["claude", args];
}

/**
 * Run a headless agent session with dimmed output in a fixed-height
 * scrollable region (DECSTBM). Supports Ctrl+C cancel for all agents
 * and steering (type + Enter) for Claude via stream-json.
 * Falls back to plain dimmed output when stdout is not a TTY.
 */
export async function runHeadlessAgentSession(
  options: InteractiveSessionOptions,
): Promise<void> {
  const DIM = "\x1b[2m";
  const RESET = "\x1b[22m";
  const isTTY = process.stdout.isTTY ?? false;
  const isStdinTTY = process.stdin.isTTY ?? false;
  const rows = process.stdout.rows ?? 0;
  const cols = process.stdout.columns ?? 40;
  const BOX_HEIGHT = 8;
  const useBox = isTTY && rows > BOX_HEIGHT + 2;
  const canInteract = useBox && isStdinTTY;
  const canSteer = canInteract && options.agent === "claude";

  // Claude gets stream-json for steering support
  const [cmd, args] = canSteer
    ? buildSteerableClaudeCommand(options)
    : buildHeadlessAgentCommand(options.agent, options.prompt, {
        addDirs: options.addDirs ?? [],
      });

  // Terminal cleanup
  let cleaned = false;
  const resetTerminal = () => {
    if (!useBox || cleaned) return;
    cleaned = true;
    if (canInteract) {
      process.stdin.setRawMode?.(false);
      process.stdin.pause();
    }
    process.stdout.write(`\x1b[1;${rows}r\x1b[${rows};1H\x1b[22m\n`);
  };

  // Layout: header | scroll box | footer (controls)
  const reserveLines = BOX_HEIGHT + 2; // header + box + footer
  const headerRow = rows - BOX_HEIGHT - 1;
  const boxTop = headerRow + 1;
  const boxBottom = rows - 1;
  const footerRow = rows;

  if (useBox) {
    process.stdout.write("\n".repeat(reserveLines));

    // Header (dim)
    const agentLabel = ` ${options.agent} `;
    const ruleLen = Math.max(0, cols - agentLabel.length);
    const rule = "─".repeat(ruleLen);
    process.stdout.write(`\x1b[${headerRow};1H`);
    process.stdout.write(`${DIM}${agentLabel}${rule}${RESET}`);

    // Footer (foreground, not dim)
    const controlsText = canSteer
      ? "c cancel · s steer"
      : "c cancel";
    process.stdout.write(`\x1b[${footerRow};1H\x1b[2K${controlsText}`);

    // Scroll region (between header and footer)
    process.stdout.write(`\x1b[${boxTop};${boxBottom}r`);
    process.stdout.write(`\x1b[${boxTop};1H`);
    process.on("exit", resetTerminal);
  }

  try {
    await new Promise<void>((resolve, reject) => {
      let cancelled = false;

      const child = spawn(cmd, args, {
        cwd: options.cwd,
        stdio: [canSteer ? "pipe" : "ignore", "pipe", "pipe"],
      });

      // --- Output handling ---
      if (canSteer) {
        let lineBuffer = "";
        child.stdout?.on("data", (data: Buffer) => {
          lineBuffer += data.toString();
          const lines = lineBuffer.split("\n");
          lineBuffer = lines.pop() ?? "";
          for (const line of lines) {
            try {
              const event = JSON.parse(line);
              if (event.type === "result") {
                child.stdin?.end();
                continue;
              }
            } catch { /* not JSON */ }
            const display = parseClaudeStreamEvent(line);
            if (display) {
              process.stdout.write(`${DIM}${display}\n${RESET}`);
            }
          }
        });
      } else {
        child.stdout?.on("data", (data: Buffer) => {
          process.stdout.write(`${DIM}${data}${RESET}`);
        });
      }

      child.stderr?.on("data", (data: Buffer) => {
        process.stderr.write(`${DIM}${data}${RESET}`);
      });

      // --- Input handling ---
      let inputBuffer = "";
      let steeringMode = false;

      const drawFooter = () => {
        if (!canInteract) return;
        const content = steeringMode
          ? `> ${inputBuffer}`
          : canSteer
            ? "c cancel · s steer"
            : "c cancel";
        process.stdout.write(
          `\x1b7\x1b[${footerRow};1H\x1b[2K${content}\x1b8`,
        );
      };

      const stdinListener = (key: Buffer) => {
        const str = key.toString();

        // Ctrl+C always cancels
        if (str === "\x03") {
          cancelled = true;
          child.kill("SIGTERM");
          return;
        }

        // Steering input mode
        if (steeringMode) {
          if (str === "\x1b") { // Escape — exit steering mode
            steeringMode = false;
            inputBuffer = "";
            drawFooter();
            return;
          }
          if (str === "\r" || str === "\n") { // Enter — send
            const msg = inputBuffer.trim();
            if (msg && canSteer) {
              child.stdin?.write(
                JSON.stringify({
                  type: "user",
                  message: { role: "user", content: msg },
                }) + "\n",
              );
            }
            steeringMode = false;
            inputBuffer = "";
            drawFooter();
            return;
          }
          if (str === "\x7f" || str === "\b") { // Backspace
            inputBuffer = inputBuffer.slice(0, -1);
            drawFooter();
            return;
          }
          if (str.length === 1 && str >= " ") {
            inputBuffer += str;
            drawFooter();
          }
          return;
        }

        // Normal mode — single key controls
        if (str === "c") {
          cancelled = true;
          child.kill("SIGTERM");
          return;
        }
        if (str === "s" && canSteer) {
          steeringMode = true;
          drawFooter();
        }
      };

      if (canInteract) {
        process.stdin.setRawMode?.(true);
        process.stdin.resume();
        process.stdin.on("data", stdinListener);
      }

      child.on("error", (err) => {
        if (canInteract) process.stdin.off("data", stdinListener);
        reject(err);
      });

      child.on("close", (code) => {
        if (canInteract) process.stdin.off("data", stdinListener);
        if (code === 0) {
          resolve();
          return;
        }
        if (cancelled) {
          reject(new Error("Generation cancelled."));
          return;
        }
        reject(new Error(`${cmd} exited with code ${code}`));
      });
    });
  } finally {
    resetTerminal();
    process.off("exit", resetTerminal);
  }
}

function getAgentBinary(agent: AIAgent): string {
  switch (agent) {
    case "claude":
      return "claude";
    case "codex":
      return "codex";
  }
}
