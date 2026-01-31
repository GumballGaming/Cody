import { CodingAgent } from "./core/agent";
import { loadConfig, type Config } from "./utils/config";
import { runScript, runCommand } from "./core/tools";
import { parseCommand, commandRegistry } from "./utils/commands";
import * as readline from "readline";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

const VERSION = "1.1.0";

const theme = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  italic: "\x1b[3m",
  underline: "\x1b[4m",
  black: "\x1b[30m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  brightBlack: "\x1b[90m",
  brightRed: "\x1b[91m",
  brightGreen: "\x1b[92m",
  brightYellow: "\x1b[93m",
  brightBlue: "\x1b[94m",
  brightMagenta: "\x1b[95m",
  brightCyan: "\x1b[96m",
  brightWhite: "\x1b[97m",
  bgBlack: "\x1b[40m",
  bgRed: "\x1b[41m",
  bgGreen: "\x1b[42m",
  bgYellow: "\x1b[43m",
  bgBlue: "\x1b[44m",
  bgMagenta: "\x1b[45m",
  bgCyan: "\x1b[46m",
  bgWhite: "\x1b[47m",
};

const icons = {
  cody: "◆",
  user: "❯",
  success: "✓",
  error: "✗",
  warning: "⚠",
  info: "ℹ",
  file: "📄",
  folder: "📁",
  edit: "✎",
  run: "▶",
  thinking: "○",
  tool: "⚡",
  arrow: "→",
  bullet: "•",
  spinner: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
};

const CONFIG_DIR = path.join(os.homedir(), ".cody");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");
const HISTORY_FILE = path.join(CONFIG_DIR, "history.json");
const MODELS_CACHE_FILE = path.join(CONFIG_DIR, "models.json");
const MODELS_CACHE_TTL = 24 * 60 * 60 * 1000;

let currentDir: string = process.cwd();
let autoAcceptAll: boolean = false;
let config: Config;
let agent: CodingAgent | null = null;
let cachedModels: string[] = [];
let isFirstMessage = true;
let conversationCount = 0;

interface PendingFile {
  filename: string;
  content: string;
  fullPath: string;
  isNew: boolean;
}

let pendingFiles: PendingFile[] = [];
let lastUserMessage: string = "";

class Spinner {
  private interval: NodeJS.Timeout | null = null;
  private frameIndex = 0;
  private message: string;

  constructor(message: string = "Processing") {
    this.message = message;
  }

  start(): void {
    if (!process.stdout.isTTY) return;
    process.stdout.write("\x1b[?25l");
    this.interval = setInterval(() => {
      const frame = icons.spinner[this.frameIndex % icons.spinner.length];
      process.stdout.write(`\r${theme.cyan}${frame}${theme.reset} ${theme.dim}${this.message}...${theme.reset}`);
      this.frameIndex++;
    }, 80);
  }

  update(message: string): void {
    this.message = message;
  }

  stop(finalMessage?: string): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    if (process.stdout.isTTY) {
      process.stdout.write("\r\x1b[K");
      process.stdout.write("\x1b[?25h");
    }
    if (finalMessage) {
      console.log(finalMessage);
    }
  }
}

class UI {
  static clear(): void {
    process.stdout.write("\x1b[2J\x1b[H");
  }

  static banner(): void {
    const width = process.stdout.columns || 80;
    const line = "─".repeat(Math.min(50, width - 4));

    console.log();
    console.log(`  ${theme.cyan}${theme.bold}${icons.cody} CODY${theme.reset} ${theme.dim}v${VERSION}${theme.reset}`);
    console.log(`  ${theme.dim}${line}${theme.reset}`);
    console.log(`  ${theme.dim}Your AI coding assistant. Type ${theme.reset}${theme.yellow}/help${theme.reset}${theme.dim} for commands.${theme.reset}`);
    console.log();
  }

  static divider(): void {
    const width = Math.min(60, (process.stdout.columns || 80) - 4);
    console.log(`  ${theme.dim}${"─".repeat(width)}${theme.reset}`);
  }

  static toolCall(name: string, detail?: string): void {
    const detailStr = detail ? ` ${theme.dim}${detail}${theme.reset}` : "";
    console.log(`  ${theme.brightBlack}${icons.tool} ${name}${detailStr}${theme.reset}`);
  }

  static success(message: string): void {
    console.log(`  ${theme.green}${icons.success}${theme.reset} ${message}`);
  }

  static error(message: string): void {
    console.log(`  ${theme.red}${icons.error}${theme.reset} ${message}`);
  }

  static warning(message: string): void {
    console.log(`  ${theme.yellow}${icons.warning}${theme.reset} ${message}`);
  }

  static info(message: string): void {
    console.log(`  ${theme.blue}${icons.info}${theme.reset} ${theme.dim}${message}${theme.reset}`);
  }

  static fileChange(filename: string, action: "create" | "modify" | "delete"): void {
    const actionColors = {
      create: theme.green,
      modify: theme.yellow,
      delete: theme.red,
    };
    const actionIcons = {
      create: "+",
      modify: "~",
      delete: "-",
    };
    console.log(`  ${actionColors[action]}${actionIcons[action]}${theme.reset} ${filename}`);
  }

  static codeBlock(code: string, language?: string, filename?: string): void {
    const lines = code.split("\n");
    const maxLines = 15;

    if (filename) {
      console.log(`  ${theme.dim}┌─ ${filename} ${language ? `(${language})` : ""}${theme.reset}`);
    }

    const displayLines = lines.slice(0, maxLines);
    displayLines.forEach((line, i) => {
      const lineNum = String(i + 1).padStart(3, " ");
      console.log(`  ${theme.dim}│${theme.brightBlack}${lineNum}${theme.dim}│${theme.reset} ${line}`);
    });

    if (lines.length > maxLines) {
      console.log(`  ${theme.dim}│   │ ... ${lines.length - maxLines} more lines${theme.reset}`);
    }

    console.log(`  ${theme.dim}└${"─".repeat(40)}${theme.reset}`);
  }

  static diff(oldContent: string | null, newContent: string, filename: string): void {
    console.log();
    console.log(`  ${theme.bold}${filename}${theme.reset}`);

    if (!oldContent) {
      console.log(`  ${theme.green}+ New file${theme.reset}`);
      UI.codeBlock(newContent.slice(0, 500), undefined, filename);
      return;
    }

    const oldLines = oldContent.split("\n");
    const newLines = newContent.split("\n");

    let changes = 0;
    const maxChanges = 10;

    console.log(`  ${theme.dim}───${theme.reset}`);

    for (let i = 0; i < Math.max(oldLines.length, newLines.length) && changes < maxChanges; i++) {
      if (oldLines[i] !== newLines[i]) {
        if (oldLines[i]) {
          console.log(`  ${theme.red}- ${oldLines[i]}${theme.reset}`);
        }
        if (newLines[i]) {
          console.log(`  ${theme.green}+ ${newLines[i]}${theme.reset}`);
        }
        changes++;
      }
    }

    if (changes >= maxChanges) {
      console.log(`  ${theme.dim}... more changes${theme.reset}`);
    }

    console.log(`  ${theme.dim}───${theme.reset}`);
  }
}

function ensureConfigDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

function loadSavedConfig(): Partial<Config> {
  try {
    ensureConfigDir();
    if (fs.existsSync(CONFIG_FILE)) {
      const data = fs.readFileSync(CONFIG_FILE, "utf-8");
      return JSON.parse(data);
    }
  } catch (err) {
    UI.warning(`Could not load config: ${err instanceof Error ? err.message : err}`);
  }
  return {};
}

function saveConfigToDisk(): void {
  try {
    ensureConfigDir();
    const toSave = {
      apiUrl: config.apiUrl,
      apiKey: config.apiKey,
      model: config.model,
      timeout: config.timeout || 120000,
    };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(toSave, null, 2));
  } catch (err) {
    UI.error(`Could not save config: ${err instanceof Error ? err.message : err}`);
  }
}

function loadCachedModels(): string[] {
  try {
    if (fs.existsSync(MODELS_CACHE_FILE)) {
      const data = JSON.parse(fs.readFileSync(MODELS_CACHE_FILE, "utf-8"));
      if (Date.now() - data.timestamp < MODELS_CACHE_TTL) {
        return data.models;
      }
    }
  } catch {}
  return [];
}

function saveCachedModels(models: string[]): void {
  try {
    ensureConfigDir();
    fs.writeFileSync(
      MODELS_CACHE_FILE,
      JSON.stringify({ models, timestamp: Date.now() })
    );
  } catch {}
}

function saveSession(): void {
  try {
    ensureConfigDir();
    const session = {
      lastProject: currentDir,
      lastModel: config.model,
      timestamp: Date.now(),
    };
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(session, null, 2));
  } catch {}
}

async function fetchModels(): Promise<string[]> {
  const cached = loadCachedModels();
  if (cached.length > 0) {
    cachedModels = cached;
    return cached;
  }

  const spinner = new Spinner("Fetching models");
  spinner.start();

  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (config.apiKey) headers["Authorization"] = `Bearer ${config.apiKey}`;

    const res = await fetch(`${config.apiUrl}/models`, {
      headers,
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) {
      spinner.stop();
      UI.error(`API returned ${res.status}: ${res.statusText}`);
      return [];
    }

    const data = (await res.json()) as { data?: { id: string }[] };
    const models = data.data?.map((m) => m.id).filter(Boolean).sort() || [];

    if (models.length > 0) {
      cachedModels = models;
      saveCachedModels(models);
    }

    spinner.stop();
    return models;
  } catch (err) {
    spinner.stop();
    UI.error(err instanceof Error ? err.message : "Network error");
    return [];
  }
}

async function selectModel(): Promise<string | null> {
  if (cachedModels.length === 0) {
    cachedModels = await fetchModels();
    if (cachedModels.length === 0) return null;
  }

  console.log();
  console.log(`  ${theme.bold}Select a model${theme.reset} ${theme.dim}(${cachedModels.length} available)${theme.reset}`);
  console.log();

  const stdin = process.stdin;
  const stdout = process.stdout;

  if (!stdin.isTTY) {
    const model = config.model || cachedModels[0];
    UI.info(`Using model: ${model}`);
    return model;
  }

  return new Promise((resolve) => {
    let query = "";
    let selectedIndex = 0;
    let scrollOffset = 0;
    let filtered = [...cachedModels];
    let done = false;

    const maxVisible = Math.min(10, (process.stdout.rows || 20) - 10);
    const totalLines = maxVisible + 4;

    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    for (let i = 0; i < totalLines; i++) stdout.write("\n");
    stdout.write(`\x1b[${totalLines}A`);
    stdout.write("\x1b[?25l");
    stdout.write("\x1b7");

    const render = () => {
      stdout.write("\x1b8");
      stdout.write("\x1b7");

      stdout.write(`\x1b[2K  ${theme.dim}Search:${theme.reset} ${query}${theme.dim}│${theme.reset}\n`);
      stdout.write(`\x1b[2K  ${theme.dim}${"─".repeat(40)}${theme.reset}\n`);

      if (selectedIndex < scrollOffset) scrollOffset = selectedIndex;
      if (selectedIndex >= scrollOffset + maxVisible) scrollOffset = selectedIndex - maxVisible + 1;

      for (let i = 0; i < maxVisible; i++) {
        const idx = scrollOffset + i;
        stdout.write("\x1b[2K");
        if (idx < filtered.length) {
          const m = filtered[idx];
          const sel = idx === selectedIndex;
          const cur = m === config.model;
          const pre = sel ? `${theme.cyan}${icons.arrow}${theme.reset}` : " ";
          const suf = cur ? ` ${theme.green}(current)${theme.reset}` : "";
          const nam = sel ? `${theme.bold}${m}${theme.reset}` : m;
          stdout.write(`  ${pre} ${nam}${suf}\n`);
        } else {
          stdout.write("\n");
        }
      }

      stdout.write(`\x1b[2K  ${theme.dim}${"─".repeat(40)}${theme.reset}\n`);
      stdout.write(`\x1b[2K  ${theme.dim}↑↓ navigate • Enter select • Esc cancel${theme.reset}`);
      stdout.write("\x1b8");
    };

    const cleanup = () => {
      stdin.setRawMode(wasRaw);
      stdin.pause();
      stdout.write(`\x1b[${totalLines}B`);
      stdout.write("\x1b[?25h");
      stdout.write("\n");
    };

    const onData = (key: string) => {
      if (done) return;

      if (key === "\x1b[A" && selectedIndex > 0) {
        selectedIndex--;
        render();
        return;
      }

      if (key === "\x1b[B" && selectedIndex < filtered.length - 1) {
        selectedIndex++;
        render();
        return;
      }

      if (key === "\x1b" || key === "\x03") {
        finish(null);
        return;
      }

      if (key === "\r" || key === "\n") {
        if (filtered.length > 0) {
          finish(filtered[selectedIndex]);
        }
        return;
      }

      if (key === "\x7f" || key === "\b") {
        if (query.length > 0) {
          query = query.slice(0, -1);
          filtered = query
            ? cachedModels.filter((m) => m.toLowerCase().includes(query.toLowerCase()))
            : [...cachedModels];
          selectedIndex = 0;
          scrollOffset = 0;
          render();
        }
        return;
      }

      if (key.length === 1 && key.charCodeAt(0) >= 32 && key.charCodeAt(0) <= 126) {
        query += key;
        filtered = cachedModels.filter((m) => m.toLowerCase().includes(query.toLowerCase()));
        selectedIndex = 0;
        scrollOffset = 0;
        render();
        return;
      }
    };

    const finish = (result: string | null) => {
      if (done) return;
      done = true;

      stdin.removeListener("data", onData);
      cleanup();

      resolve(result);
    };

    stdin.on("data", onData);
    render();
  });
}

function initAgent(): void {
  agent = new CodingAgent({
    ...config,
    timeout: config.timeout || 120000,
  });
  isFirstMessage = true;
  conversationCount = 0;

  console.log();
  UI.success(`Connected to ${config.model.split("/").pop()}`);
  saveSession();
}

function getFullStructure(dir: string): string {
  const skipDirs = new Set([
    "node_modules", "__pycache__", "dist", "build", ".git",
    ".next", "coverage", ".cache", "vendor", "target", ".vscode",
    ".idea", "out", "bin", "obj"
  ]);

  const lines: string[] = [`${path.basename(dir)}/`];

  const walk = (d: string, indent: string): void => {
    try {
      const items = fs.readdirSync(d)
        .filter((i) => !i.startsWith(".") && !skipDirs.has(i))
        .sort((a, b) => {
          try {
            const aDir = fs.statSync(path.join(d, a)).isDirectory();
            const bDir = fs.statSync(path.join(d, b)).isDirectory();
            if (aDir && !bDir) return -1;
            if (!aDir && bDir) return 1;
          } catch {}
          return a.localeCompare(b);
        });

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const p = path.join(d, item);
        const last = i === items.length - 1;
        const conn = last ? "└── " : "├── ";
        const next = indent + (last ? "    " : "│   ");

        try {
          const isDir = fs.statSync(p).isDirectory();
          lines.push(`${indent}${conn}${item}${isDir ? "/" : ""}`);
          if (isDir) walk(p, next);
        } catch {
          lines.push(`${indent}${conn}${item}`);
        }
      }
    } catch {}
  };

  walk(dir, "");
  return lines.join("\n");
}

function printFullStructure(dir: string): void {
  const skipDirs = new Set([
    "node_modules", "__pycache__", "dist", "build", ".git",
    ".next", "coverage", ".cache", "vendor", "target", ".vscode",
    ".idea", "out", "bin", "obj"
  ]);

  console.log(`  ${theme.cyan}${icons.folder}${theme.reset} ${path.basename(dir)}/`);

  const walk = (d: string, indent: string): void => {
    try {
      const items = fs.readdirSync(d)
        .filter((i) => !i.startsWith(".") && !skipDirs.has(i))
        .sort((a, b) => {
          try {
            const aDir = fs.statSync(path.join(d, a)).isDirectory();
            const bDir = fs.statSync(path.join(d, b)).isDirectory();
            if (aDir && !bDir) return -1;
            if (!aDir && bDir) return 1;
          } catch {}
          return a.localeCompare(b);
        });

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const p = path.join(d, item);
        const last = i === items.length - 1;
        const conn = last ? "└── " : "├── ";
        const next = indent + (last ? "    " : "│   ");

        try {
          const isDir = fs.statSync(p).isDirectory();
          console.log(`  ${indent}${conn}${isDir ? theme.cyan : ""}${item}${isDir ? "/" : ""}${theme.reset}`);
          if (isDir) walk(p, next);
        } catch {
          console.log(`  ${indent}${conn}${theme.dim}${item}${theme.reset}`);
        }
      }
    } catch {}
  };

  walk(dir, "");
}

function resolvePath(p: string): string {
  if (p.startsWith("~")) p = p.replace("~", os.homedir());
  return path.isAbsolute(p) ? path.normalize(p) : path.resolve(currentDir, p);
}

class CodeExtractor {
  private buffer = "";
  private inBlock = false;
  private filename = "";
  private code = "";
  private dir: string;
  private extractedFiles: PendingFile[] = [];

  constructor(dir: string) {
    this.dir = dir;
  }

  process(chunk: string): void {
    this.buffer += chunk;

    if (!this.inBlock) {
      const match = this.buffer.match(/```(\w+):([^\n]+)\n/);
      if (match) {
        this.inBlock = true;
        this.filename = match[2].trim();
        this.code = "";
        this.buffer = this.buffer.slice(this.buffer.indexOf(match[0]) + match[0].length);
        UI.toolCall("write_file", this.filename);
      } else if (this.buffer.length > 200) {
        this.buffer = this.buffer.slice(-200);
      }
      return;
    }

    const endIndex = this.buffer.indexOf("```");
    if (endIndex !== -1) {
      this.code += this.buffer.slice(0, endIndex);
      const fullPath = path.isAbsolute(this.filename) ? this.filename : path.join(this.dir, this.filename);
      const isNew = !fs.existsSync(fullPath);

      this.extractedFiles.push({
        filename: this.filename,
        content: this.code.trim(),
        fullPath,
        isNew,
      });

      this.buffer = this.buffer.slice(endIndex + 3);
      this.inBlock = false;
      this.code = "";
      this.filename = "";

      if (this.buffer.length > 0) this.process("");
      return;
    }

    if (this.buffer.length > 10) {
      this.code += this.buffer.slice(0, -10);
      this.buffer = this.buffer.slice(-10);
    }
  }

  flush(): void {
    if (this.inBlock && this.code) {
      this.code += this.buffer;
      const fullPath = path.isAbsolute(this.filename) ? this.filename : path.join(this.dir, this.filename);
      this.extractedFiles.push({
        filename: this.filename,
        content: this.code.trim(),
        fullPath,
        isNew: !fs.existsSync(fullPath),
      });
    }
    pendingFiles.push(...this.extractedFiles);
    this.reset();
  }

  reset(): void {
    this.buffer = "";
    this.inBlock = false;
    this.code = "";
    this.filename = "";
    this.extractedFiles = [];
  }
}

async function processPendingFiles(rl: readline.Interface): Promise<void> {
  if (!pendingFiles.length) return;

  console.log();
  console.log(`  ${theme.bold}${pendingFiles.length} file(s) to save${theme.reset}`);
  UI.divider();

  const files = [...pendingFiles];
  pendingFiles = [];
  let skip = false;

  for (const file of files) {
    if (skip) {
      UI.info(`Skipped ${file.filename}`);
      continue;
    }

    const old = fs.existsSync(file.fullPath) ? fs.readFileSync(file.fullPath, "utf-8") : null;

    if (!autoAcceptAll) {
      UI.diff(old, file.content, file.filename);
      const ans = await ask(rl, `\n  ${theme.yellow}Save this file?${theme.reset} ${theme.dim}[Y/n/a/s]${theme.reset} `);
      const l = ans.toLowerCase();
      if (l === "n") { UI.info(`Skipped ${file.filename}`); continue; }
      if (l === "a") autoAcceptAll = true;
      if (l === "s") { skip = true; UI.info(`Skipped remaining`); continue; }
    }

    try {
      const dir = path.dirname(file.fullPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file.fullPath, file.content);
      UI.fileChange(file.filename, file.isNew ? "create" : "modify");
    } catch (err) {
      UI.error(`Failed to save ${file.filename}: ${err instanceof Error ? err.message : err}`);
    }
  }
}

async function sendMessage(message: string, rl: readline.Interface): Promise<void> {
  let fullMessage = message;

  if (isFirstMessage) {
    const structure = getFullStructure(currentDir);
    fullMessage = `Project structure:\n${structure}\n\nHelp me code. Use \`\`\`lang:filename.ext for files.\n\nUser request: ${message}`;
    isFirstMessage = false;
  }

  console.log();
  process.stdout.write(`  ${theme.magenta}${icons.cody}${theme.reset} `);

  const extractor = new CodeExtractor(currentDir);

  try {
    for await (const chunk of agent!.sendStream(fullMessage)) {
      process.stdout.write(chunk);
      extractor.process(chunk);
    }
  } catch (err) {
    extractor.flush();
    console.log();
    throw err;
  }

  extractor.flush();
  console.log("\n");
  conversationCount++;

  if (pendingFiles.length > 0) {
    await processPendingFiles(rl);
  }
}

function printHelp(): void {
  console.log();
  console.log(`  ${theme.bold}Commands${theme.reset}`);
  UI.divider();

  const categories = ["setup", "files", "shell", "chat", "other"] as const;
  const names: Record<string, string> = { setup: "Setup", files: "Files", shell: "Shell", chat: "Chat", other: "Other" };

  for (const cat of categories) {
    const cmds = commandRegistry.filter((c) => c.category === cat);
    if (!cmds.length) continue;
    console.log();
    console.log(`  ${theme.cyan}${names[cat]}${theme.reset}`);
    for (const cmd of cmds) {
      const aliases = cmd.aliases.length ? ` ${theme.dim}(${cmd.aliases.join(", ")})${theme.reset}` : "";
      console.log(`    ${theme.bold}${cmd.usage}${theme.reset}${aliases}`);
      console.log(`      ${theme.dim}${cmd.description}${theme.reset}`);
    }
  }
  console.log();
}

async function handleCommand(input: string, rl: readline.Interface): Promise<boolean | "restart"> {
  const { command, args } = parseCommand(input);
  const arg = (i: number) => args[i];

  switch (command) {
    case "/quit":
      saveSession();
      console.log();
      UI.info("Goodbye!");
      console.log();
      return true;

    case "/help":
      printHelp();
      break;

    case "/setup":
      await runSetup();
      return "restart";

    case "/models":
    case "/model": {
      const model = await selectModel();
      if (model) {
        config.model = model;
        saveConfigToDisk();
        UI.success(`Selected ${model}`);
        initAgent();
      }
      return "restart";
    }

    case "/status":
      showStatus();
      break;

    case "/config":
      console.log();
      UI.info(`Config directory: ${CONFIG_DIR}`);
      UI.info(`Config file: ${CONFIG_FILE}`);
      break;

    case "/clear":
      if (agent) {
        agent.clearHistory();
        isFirstMessage = true;
        conversationCount = 0;
        UI.success("Conversation cleared");
      } else {
        UI.warning("Not connected");
      }
      break;

    case "/retry":
      if (!agent) {
        UI.warning("Not connected. Run /setup first.");
      } else if (!lastUserMessage) {
        UI.warning("No message to retry");
      } else {
        agent.clearHistory();
        isFirstMessage = true;
        UI.info(`Retrying: ${lastUserMessage.slice(0, 50)}${lastUserMessage.length > 50 ? "..." : ""}`);
        await sendMessage(lastUserMessage, rl);
      }
      break;

    case "/auto":
      autoAcceptAll = !autoAcceptAll;
      UI.info(`Auto-accept: ${autoAcceptAll ? "ON" : "OFF"}`);
      break;

    case "/cd": {
      const p = arg(0) ? resolvePath(arg(0)) : os.homedir();
      if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
        currentDir = p;
        process.chdir(currentDir);
        isFirstMessage = true;
        UI.success(`Changed to ${currentDir}`);
      } else {
        UI.error("Directory not found");
      }
      break;
    }

    case "/ls": {
      const p = arg(0) ? resolvePath(arg(0)) : currentDir;
      if (!fs.existsSync(p)) { UI.error("Path not found"); break; }
      console.log();
      printFullStructure(p);
      console.log();
      break;
    }

    case "/tree": {
      const p = arg(0) ? resolvePath(arg(0)) : currentDir;
      if (!fs.existsSync(p)) { UI.error("Path not found"); break; }
      console.log();
      printFullStructure(p);
      console.log();
      break;
    }

    case "/cat": {
      if (!arg(0)) { UI.error("Usage: /cat <file>"); break; }
      const p = resolvePath(arg(0));
      if (!fs.existsSync(p)) { UI.error("File not found"); break; }
      try {
        const content = fs.readFileSync(p, "utf-8");
        console.log();
        UI.codeBlock(content, path.extname(p).slice(1), path.basename(p));
      } catch (err) {
        UI.error(`Cannot read file: ${err instanceof Error ? err.message : err}`);
      }
      break;
    }

    case "/add": {
      if (!agent) { UI.warning("Not connected. Run /setup first."); break; }
      if (!arg(0)) { UI.error("Usage: /add <file>"); break; }
      const p = resolvePath(arg(0));
      if (!fs.existsSync(p)) { UI.error("File not found"); break; }
      UI.toolCall("read_file", arg(0));
      try {
        const content = fs.readFileSync(p, "utf-8");
        console.log();
        process.stdout.write(`  ${theme.magenta}${icons.cody}${theme.reset} `);
        for await (const chunk of agent.sendStream(`Here's ${arg(0)}:\n\`\`\`\n${content}\n\`\`\`\n\nWhat would you like me to do?`)) {
          process.stdout.write(chunk);
        }
        console.log("\n");
        conversationCount++;
      } catch (err) {
        UI.error(`Failed: ${err instanceof Error ? err.message : err}`);
      }
      break;
    }

    case "/run": {
      if (!arg(0)) { UI.error("Usage: /run <file>"); break; }
      const p = resolvePath(arg(0));
      if (!fs.existsSync(p)) { UI.error("File not found"); break; }
      UI.toolCall("run_script", arg(0));
      try {
        const result = await runScript(path.dirname(p), path.basename(p));
        if (result.output && result.output !== "(no output)") { console.log(); console.log(result.output); }
        if (result.error) UI.error(result.error);
        if (result.success) UI.success("Completed");
      } catch (err) {
        UI.error(err instanceof Error ? err.message : String(err));
      }
      break;
    }

    case "/sh": {
      if (!args.length) { UI.error("Usage: /sh <command>"); break; }
      const cmd = args.join(" ");
      UI.toolCall("shell", cmd);
      try {
        const result = await runCommand(cmd, [], currentDir);
        if (result.output && result.output !== "(no output)") { console.log(); console.log(result.output); }
        if (result.error) UI.error(result.error);
      } catch (err) {
        UI.error(err instanceof Error ? err.message : String(err));
      }
      break;
    }

    case "/edit": {
      if (!arg(0)) { UI.error("Usage: /edit <file>"); break; }
      const editor = process.env.EDITOR || process.env.VISUAL || "vim";
      const p = resolvePath(arg(0));
      UI.toolCall("edit", `Opening in ${editor}`);
      try {
        const { spawnSync } = await import("child_process");
        spawnSync(editor, [p], { cwd: currentDir, stdio: "inherit" });
      } catch (err) {
        UI.error(`Failed: ${err instanceof Error ? err.message : err}`);
      }
      break;
    }

    default:
      UI.error(`Unknown command: ${command}`);
      UI.info("Type /help for available commands");
  }

  return false;
}

function showStatus(): void {
  console.log();
  console.log(`  ${theme.bold}Status${theme.reset}`);
  UI.divider();

  const conn = agent ? `${theme.green}connected${theme.reset}` : `${theme.red}disconnected${theme.reset}`;
  const key = config.apiKey ? `${theme.green}configured${theme.reset} (****${config.apiKey.slice(-4)})` : `${theme.red}not set${theme.reset}`;

  console.log(`
  ${theme.dim}Status:${theme.reset}     ${conn}
  ${theme.dim}API URL:${theme.reset}    ${config.apiUrl || "not set"}
  ${theme.dim}Model:${theme.reset}      ${config.model || "not set"}
  ${theme.dim}API Key:${theme.reset}    ${key}
  ${theme.dim}Timeout:${theme.reset}    ${(config.timeout || 120000) / 1000}s
  ${theme.dim}Project:${theme.reset}    ${currentDir}
  ${theme.dim}Messages:${theme.reset}   ${conversationCount}
  ${theme.dim}Auto-save:${theme.reset}  ${autoAcceptAll ? "ON" : "OFF"}
  `);
}

async function runSetup(): Promise<void> {
  console.log();
  console.log(`  ${theme.bold}Setup${theme.reset}`);
  UI.divider();
  console.log();

  const defaultUrl = config.apiUrl || "https://openrouter.ai/api/v1";
  
  const askQuestion = (question: string): Promise<string> => {
    return new Promise((resolve) => {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: true,
      });
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    });
  };

  const url = await askQuestion(`  ${theme.dim}API URL${theme.reset} [${defaultUrl}]: `);
  if (url) {
    config.apiUrl = url.endsWith("/") ? url.slice(0, -1) : url;
    cachedModels = [];
  } else if (!config.apiUrl) {
    config.apiUrl = defaultUrl;
  }

  const keyDisplay = config.apiKey ? `****${config.apiKey.slice(-4)}` : "none";
  const key = await askQuestion(`  ${theme.dim}API Key${theme.reset} [${keyDisplay}]: `);
  if (key) {
    config.apiKey = key;
    cachedModels = [];
  }

  if (config.apiUrl && config.apiKey) {
    const spinner = new Spinner("Testing connection");
    spinner.start();
    try {
      const res = await fetch(`${config.apiUrl}/models`, {
        headers: { "Authorization": `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
        signal: AbortSignal.timeout(10000),
      });
      spinner.stop();
      if (res.ok) UI.success("Connection successful");
      else UI.warning(`Connection returned ${res.status}`);
    } catch (err) {
      spinner.stop();
      UI.warning(`Connection failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  const model = await selectModel();
  if (model) {
    config.model = model;
    UI.success(`Selected ${model}`);
  }

  saveConfigToDisk();

  if (config.apiUrl && config.apiKey && config.model) {
    initAgent();
  }
}

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, (ans) => resolve(ans.trim())));
}

function createInterface(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: process.stdin.isTTY ?? false,
  });
}

async function main(): Promise<void> {
  const baseConfig = loadConfig();
  const savedConfig = loadSavedConfig();

  config = {
    ...baseConfig,
    ...savedConfig,
    timeout: savedConfig.timeout || baseConfig.timeout || 120000,
  } as Config;

  UI.banner();
  UI.info(`Working in ${path.basename(currentDir)}`);

  if (config.apiUrl && config.model && config.apiKey) {
    initAgent();
  } else {
    console.log();
    UI.warning("Not configured. Run /setup to get started.");
  }

  const startPrompt = () => {
    const rl = createInterface();

    const shutdown = () => {
      console.log();
      UI.info("Shutting down...");
      saveSession();
      if (agent) agent.abort();
      rl.close();
      process.exit(0);
    };

    process.removeAllListeners("SIGINT");
    process.removeAllListeners("SIGTERM");
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    const prompt = (): void => {
      const indicator = agent ? theme.green : theme.red;

      rl.question(`\n  ${indicator}${icons.user}${theme.reset} `, async (input) => {
        const trimmed = input.trim();

        if (!trimmed) { prompt(); return; }

        if (trimmed.startsWith("/")) {
          try {
            const result = await handleCommand(trimmed, rl);
            if (result === true) { rl.close(); process.exit(0); }
            if (result === "restart") { rl.close(); startPrompt(); return; }
          } catch (err) {
            UI.error(`Command failed: ${err instanceof Error ? err.message : err}`);
          }
          prompt();
          return;
        }

        if (!agent) { UI.warning("Run /setup first"); prompt(); return; }

        lastUserMessage = trimmed;

        try {
          await sendMessage(trimmed, rl);
        } catch (err) {
          console.log();
          if (err instanceof Error) {
            if (err.name === "AbortError" || err.message.includes("timeout")) {
              UI.error("Request timed out. Try /retry");
            } else {
              UI.error(err.message);
            }
          } else {
            UI.error("An error occurred");
          }
        }

        prompt();
      });
    };

    prompt();
  };

  startPrompt();
}

main().catch((err) => {
  UI.error(`Fatal: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});