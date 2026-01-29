import { CodingAgent } from "./core/agent";
import { loadConfig, type Config } from "./utils/config";
import { runScript, runCommand } from "./core/tools";
import * as readline from "readline";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

const c = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
};

const CONFIG_DIR = path.join(os.homedir(), ".cody");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");
const HISTORY_FILE = path.join(CONFIG_DIR, "history.json");
const MODELS_CACHE_FILE = path.join(CONFIG_DIR, "models.json");
const MODELS_CACHE_TTL = 24 * 60 * 60 * 1000;

const PROJECT_CONFIG_FILE = path.join(__dirname, "utils", "config.ts");

let currentDir: string = process.cwd();
let projectStructure: string[] = [];
let autoAcceptAll: boolean = false;
let config: Config;
let agent: CodingAgent | null = null;
let cachedModels: string[] = [];
let isFirstMessage = true;

interface PendingFile {
  filename: string;
  content: string;
  fullPath: string;
}

interface SavedSession {
  lastProject: string;
  lastModel: string;
  timestamp: number;
}

let pendingFiles: PendingFile[] = [];
let lastUserMessage: string = "";

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
    console.log(`${c.dim}Could not load saved config${c.reset}`);
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
    console.log(`${c.dim}Config saved to ${CONFIG_FILE}${c.reset}`);
  } catch (err) {
    console.log(`${c.red}Could not save config${c.reset}`);
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
      JSON.stringify({
        models,
        timestamp: Date.now(),
      })
    );
  } catch {}
}

function updateConfigTsFile(apiUrl: string, apiKey: string): boolean {
  try {
    let configTsPath = PROJECT_CONFIG_FILE;

    const possiblePaths = [
      path.join(__dirname, "utils", "config.ts"),
      path.join(__dirname, "..", "utils", "config.ts"),
      path.join(__dirname, "..", "src", "utils", "config.ts"),
      path.join(process.cwd(), "src", "utils", "config.ts"),
      path.join(process.cwd(), "utils", "config.ts"),
    ];

    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        configTsPath = p;
        break;
      }
    }

    if (!fs.existsSync(configTsPath)) {
      console.log(`${c.red}Could not find config.ts file${c.reset}`);
      return false;
    }

    let content = fs.readFileSync(configTsPath, "utf-8");

    const replaceLiteral = (re: RegExp, value: string): boolean => {
      const before = content;
      content = content.replace(re, (_m: string, prefix: string, quote: string) => {
        return `${prefix}${quote}${value}${quote}`;
      });
      return content !== before;
    };

    replaceLiteral(/(apiUrl:\s*)(["'])([^"']*)(\2)/g, apiUrl) ||
      replaceLiteral(/(API_URL\s*[:=]\s*)(["'])([^"']*)(\2)/g, apiUrl) ||
      replaceLiteral(/(OPENROUTER_API_URL\s*[:=]\s*)(["'])([^"']*)(\2)/g, apiUrl);

    replaceLiteral(/(apiKey:\s*)(["'])([^"']*)(\2)/g, apiKey) ||
      replaceLiteral(/(API_KEY\s*[:=]\s*)(["'])([^"']*)(\2)/g, apiKey) ||
      replaceLiteral(/(OPENROUTER_API_KEY\s*[:=]\s*)(["'])([^"']*)(\2)/g, apiKey);

    content = content.replace(
      /(process\.env\.OPENROUTER_API_URL\s*\|\|\s*)(["'])([^"']*)(\2)/g,
      (_m: string, prefix: string, quote: string) => `${prefix}${quote}${apiUrl}${quote}`
    );
    content = content.replace(
      /(process\.env\.OPENROUTER_API_KEY\s*\|\|\s*)(["'])([^"']*)(\2)/g,
      (_m: string, prefix: string, quote: string) => `${prefix}${quote}${apiKey}${quote}`
    );

    fs.writeFileSync(configTsPath, content, "utf-8");
    console.log(`${c.green}✓ Updated config.ts at: ${configTsPath}${c.reset}`);
    return true;
  } catch (err: any) {
    console.log(`${c.red}Error updating config.ts: ${err.message}${c.reset}`);
    return false;
  }
}

function saveSession(): void {
  try {
    ensureConfigDir();
    const session: SavedSession = {
      lastProject: currentDir,
      lastModel: config.model,
      timestamp: Date.now(),
    };
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(session, null, 2));
  } catch {}
}

function loadSession(): SavedSession | null {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      return JSON.parse(fs.readFileSync(HISTORY_FILE, "utf-8"));
    }
  } catch {}
  return null;
}

function printBanner(): void {
  console.log(`${c.cyan}╔═══════════════════════════════════════════╗
║       ${c.bright}CODY${c.reset}${c.cyan} - Your Coding Assistant       ║
║   Type ${c.yellow}/h${c.cyan} for help · ${c.yellow}/q${c.cyan} to quit            ║
╚═══════════════════════════════════════════╝${c.reset}`);
}

function printHelp(): void {
  console.log(`
${c.yellow}Commands:${c.reset}

${c.cyan}Setup:${c.reset}
  /setup              Configure API URL, key & model
  /resetup            Update API URL & key in config.ts
  /models             Search & switch model
  /status             Show current settings
  /timeout <sec>      Set request timeout (default: 120s)
  /save               Save current config

${c.cyan}Files:${c.reset}
  /ls [path]          List files
  /tree [path]        Directory tree
  /cat <file>         Read file
  /add <file>         Add to AI context
  /rm <file>          Delete file
  /run <file>         Run script
  /sh <cmd>           Shell command
  /cd <path>          Change directory

${c.cyan}Chat:${c.reset}
  /c, /clear          Clear conversation
  /auto               Toggle auto-accept
  /retry              Retry last message
  /h, /help           Help
  /q, /exit           Quit
`);
}

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, (a) => resolve(a.trim())));
}

async function warmConnection(): Promise<void> {
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (config.apiKey) headers["Authorization"] = `Bearer ${config.apiKey}`;

    await fetch(`${config.apiUrl}/models`, {
      method: "HEAD",
      headers,
      signal: AbortSignal.timeout(5000),
      keepalive: true,
    }).catch(() => {});
  } catch {}
}

async function fetchModels(): Promise<string[]> {
  const cached = loadCachedModels();
  if (cached.length > 0) {
    cachedModels = cached;
    return cached;
  }

  const timeout = config.timeout || 30000;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (config.apiKey) headers["Authorization"] = `Bearer ${config.apiKey}`;
    if (config.apiUrl.includes("openrouter")) {
      headers["HTTP-Referer"] = "https://github.com/cody-cli";
      headers["X-Title"] = "Cody CLI";
    }

    const res = await fetch(`${config.apiUrl}/models`, {
      headers,
      signal: controller.signal,
      keepalive: true,
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      console.log(`${c.red}API returned ${res.status}: ${res.statusText}${c.reset}`);
      return [];
    }

    const data = (await res.json()) as { data?: { id: string }[] };
    const models = data.data?.map((m) => m.id).filter(Boolean) || [];

    if (models.length > 0) {
      saveCachedModels(models);
    }

    return models;
  } catch (err: any) {
    if (err.name === "AbortError") {
      console.log(`${c.red}Request timed out after ${timeout / 1000}s${c.reset}`);
    } else {
      console.log(`${c.red}Network error: ${err.message}${c.reset}`);
    }
    return [];
  }
}

async function searchModel(rl: readline.Interface): Promise<string | null> {
  if (cachedModels.length === 0) {
    console.log(`${c.dim}Fetching models...${c.reset}`);
    cachedModels = await fetchModels();
    if (cachedModels.length === 0) {
      console.log(`${c.red}No models found. Check your API URL and key.${c.reset}\n`);
      return null;
    }
    console.log(`${c.green}✓ ${cachedModels.length} models loaded${c.reset}`);
  }

  if (!process.stdin.isTTY) {
    const query = await ask(rl, `${c.yellow}Search model:${c.reset} `);
    if (!query) {
      return null;
    }
    const matches = cachedModels.filter((m) => m.toLowerCase().includes(query.toLowerCase()));
    if (matches.length === 0) {
      console.log(`${c.red}No matches${c.reset}\n`);
      return null;
    }
    if (matches.length === 1) {
      return matches[0];
    }
    console.log(`\n${c.yellow}Found ${matches.length} matches:${c.reset}\n`);
    matches.slice(0, 15).forEach((m, i) => {
      const current = m === config.model ? `${c.green}(current)${c.reset}` : "";
      console.log(`  ${c.dim}[${i + 1}]${c.reset} ${m}${current}`);
    });
    if (matches.length > 15) {
      console.log(`  ${c.dim}... and ${matches.length - 15} more${c.reset}`);
    }
    const choice = await ask(rl, `\n${c.yellow}Select [1-${Math.min(15, matches.length)}]:${c.reset} `);
    const num = parseInt(choice) - 1;
    if (num >= 0 && num < matches.length) {
      return matches[num];
    }
    return null;
  }

  return new Promise((resolve) => {
    const stdin = process.stdin;
    const stdout = process.stdout;

    let query = "";
    let selectedIndex = 0;
    let scrollOffset = 0;
    let filtered = [...cachedModels];

    const maxVisible = 12;
    const boxWidth = 58;
    const totalLines = maxVisible + 5;

    rl.pause();
    stdin.setRawMode(true);
    stdin.resume();

    const stripAnsi = (str: string): string => str.replace(/\x1b\[[0-9;]*m/g, "");

    const padRight = (str: string, len: number): string => {
      const visibleLen = stripAnsi(str).length;
      const padding = Math.max(0, len - visibleLen);
      return str + " ".repeat(padding);
    };

    const highlightMatch = (text: string, q: string): string => {
      if (!q) return text;
      const idx = text.toLowerCase().indexOf(q.toLowerCase());
      if (idx === -1) return text;
      return (
        text.slice(0, idx) +
        c.yellow + c.bright +
        text.slice(idx, idx + q.length) +
        c.reset +
        text.slice(idx + q.length)
      );
    };

    let firstRender = true;

    const render = () => {
      if (!firstRender) {
        stdout.write(`\x1b[${totalLines}A`);
      }
      firstRender = false;

      const hr = "─".repeat(boxWidth - 2);

      stdout.write(`\x1b[2K${c.cyan}┌${hr}┐${c.reset}\n`);

      const searchText = `${c.yellow}🔍 Search:${c.reset} ${query}${c.dim}▌${c.reset}`;
      stdout.write(`\x1b[2K${c.cyan}│${c.reset} ${padRight(searchText, boxWidth - 4)} ${c.cyan}│${c.reset}\n`);

      stdout.write(`\x1b[2K${c.cyan}├${hr}┤${c.reset}\n`);

      if (selectedIndex < scrollOffset) {
        scrollOffset = selectedIndex;
      } else if (selectedIndex >= scrollOffset + maxVisible) {
        scrollOffset = selectedIndex - maxVisible + 1;
      }

      const start = scrollOffset;
      const end = Math.min(filtered.length, scrollOffset + maxVisible);

      for (let i = 0; i < maxVisible; i++) {
        const idx = start + i;

        if (idx < end) {
          const model = filtered[idx];
          const isSelected = idx === selectedIndex;
          const isCurrent = model === config.model;

          const arrow = isSelected ? `${c.green}▶${c.reset}` : " ";
          let displayName = highlightMatch(model, query);

          if (isSelected) {
            displayName = c.bright + displayName + c.reset;
          }

          const currentMark = isCurrent ? ` ${c.green}✓${c.reset}` : "";
          const lineContent = `${arrow} ${displayName}${currentMark}`;

          stdout.write(`\x1b[2K${c.cyan}│${c.reset} ${padRight(lineContent, boxWidth - 4)} ${c.cyan}│${c.reset}\n`);
        } else if (filtered.length === 0 && i === 0) {
          const noMatch = `${c.dim}No models match your search${c.reset}`;
          stdout.write(`\x1b[2K${c.cyan}│${c.reset}   ${padRight(noMatch, boxWidth - 6)} ${c.cyan}│${c.reset}\n`);
        } else {
          stdout.write(`\x1b[2K${c.cyan}│${c.reset}${" ".repeat(boxWidth - 2)}${c.cyan}│${c.reset}\n`);
        }
      }

      stdout.write(`\x1b[2K${c.cyan}├${hr}┤${c.reset}\n`);

      const upIndicator = scrollOffset > 0 ? `${c.dim}↑${scrollOffset}${c.reset} ` : "   ";
      const remaining = filtered.length - scrollOffset - maxVisible;
      const downIndicator = remaining > 0 ? ` ${c.dim}↓${remaining}${c.reset}` : "";

      const footerText =
        `${upIndicator}${filtered.length} models  ` +
        `${c.dim}↑↓${c.reset} nav  ` +
        `${c.dim}Enter${c.reset} select  ` +
        `${c.dim}Esc${c.reset} cancel` +
        downIndicator;

      stdout.write(`\x1b[2K${c.cyan}│${c.reset} ${padRight(footerText, boxWidth - 4)} ${c.cyan}│${c.reset}\n`);
      stdout.write(`\x1b[2K${c.cyan}└${hr}┘${c.reset}`);
    };

    const updateFilter = () => {
      if (!query) {
        filtered = [...cachedModels];
      } else {
        const lowerQuery = query.toLowerCase();
        filtered = cachedModels.filter((m) => m.toLowerCase().includes(lowerQuery));
      }
      selectedIndex = 0;
      scrollOffset = 0;
    };

    const cleanup = () => {
      stdin.setRawMode(false);
      stdin.removeAllListeners("data");
      stdout.write("\x1b[?25h");
      stdout.write("\n\n");
      rl.resume();
    };

    const handleKey = (buf: Buffer) => {
      const key = buf.toString();

      if (key.length > 6 || key.startsWith("\x1b[M") || key.startsWith("\x1b[<")) {
        return;
      }

      if (key === "\x1b[A") {
        if (selectedIndex > 0) {
          selectedIndex--;
          render();
        }
        return;
      }

      if (key === "\x1b[B") {
        if (selectedIndex < filtered.length - 1) {
          selectedIndex++;
          render();
        }
        return;
      }

      if (key === "\x1b" || key === "\x03") {
        cleanup();
        console.log(`${c.dim}Cancelled${c.reset}\n`);
        resolve(null);
        return;
      }

      if (key === "\r" || key === "\n") {
        if (filtered.length > 0 && filtered[selectedIndex]) {
          const selected = filtered[selectedIndex];
          cleanup();
          console.log(`${c.green}✓ Selected: ${selected}${c.reset}\n`);
          resolve(selected);
        }
        return;
      }

      if (key === "\x7f" || key === "\b") {
        if (query.length > 0) {
          query = query.slice(0, -1);
          updateFilter();
          render();
        }
        return;
      }

      const code = key.charCodeAt(0);
      if (code >= 32 && code <= 126) {
        query += key;
        updateFilter();
        render();
      }
    };

    stdout.write("\x1b[?25l");
    stdout.write("\n".repeat(totalLines));
    stdin.on("data", handleKey);
    render();
  });
}

async function runSetup(rl: readline.Interface): Promise<void> {
  console.log(`\n${c.cyan}━━━ Setup ━━━${c.reset}\n`);

  console.log(`${c.dim}Current: ${config.apiUrl || "not set"}${c.reset}`);
  const urlInput = await ask(rl, `${c.yellow}API URL${c.reset} ${c.dim}(Enter to keep)${c.reset}: `);
  if (urlInput) {
    config.apiUrl = urlInput.endsWith("/") ? urlInput.slice(0, -1) : urlInput;
    cachedModels = [];
    console.log(`${c.green}✓ URL set${c.reset}`);
  }

  console.log(`${c.dim}Current: ${config.apiKey ? "****" + config.apiKey.slice(-4) : "Not set"}${c.reset}`);
  const keyInput = await ask(rl, `${c.yellow}API Key${c.reset} ${c.dim}(Enter to keep)${c.reset}: `);
  if (keyInput) {
    config.apiKey = keyInput;
    cachedModels = [];
    console.log(`${c.green}✓ Key set${c.reset}`);
  }

  console.log(`${c.dim}Current timeout: ${(config.timeout || 120000) / 1000}s${c.reset}`);
  const timeoutInput = await ask(rl, `${c.yellow}Timeout (seconds)${c.reset} ${c.dim}(Enter to keep)${c.reset}: `);
  if (timeoutInput) {
    const secs = parseInt(timeoutInput);
    if (!isNaN(secs) && secs > 0) {
      config.timeout = secs * 1000;
      console.log(`${c.green}✓ Timeout set to ${secs}s${c.reset}`);
    }
  }

  console.log();

  cachedModels = [];
  const model = await searchModel(rl);

  if (model) {
    config.model = model;
    saveConfigToDisk();
    initAgent();
  } else {
    saveConfigToDisk();
  }
}

async function runReSetup(rl: readline.Interface): Promise<void> {
  console.log(`\n${c.cyan}━━━ ReSetup (Update config.ts) ━━━${c.reset}\n`);
  console.log(`${c.dim}This will update the config.ts file with new API credentials.${c.reset}\n`);

  console.log(`${c.dim}Current API URL: ${config.apiUrl || "not set"}${c.reset}`);
  const urlInput = await ask(rl, `${c.yellow}New API URL${c.reset} ${c.dim}(Enter to keep)${c.reset}: `);
  const newUrl = urlInput ? (urlInput.endsWith("/") ? urlInput.slice(0, -1) : urlInput) : config.apiUrl;

  console.log(`${c.dim}Current API Key: ${config.apiKey ? "****" + config.apiKey.slice(-4) : "Not set"}${c.reset}`);
  const keyInput = await ask(rl, `${c.yellow}New API Key${c.reset} ${c.dim}(Enter to keep)${c.reset}: `);
  const newKey = keyInput || config.apiKey;

  if (!newUrl || !newKey) {
    console.log(`${c.red}API URL and Key are required${c.reset}\n`);
    return;
  }

  console.log(`\n${c.dim}Updating config.ts...${c.reset}`);

  const success = updateConfigTsFile(newUrl, newKey);

  if (success) {
    config.apiUrl = newUrl;
    config.apiKey = newKey;
    cachedModels = [];

    saveConfigToDisk();

    console.log(`${c.green}✓ Configuration updated successfully${c.reset}`);

    const selectModel = await ask(rl, `\n${c.yellow}Select a new model?${c.reset} [Y/n]: `);
    if (selectModel.toLowerCase() !== "n") {
      const model = await searchModel(rl);
      if (model) {
        config.model = model;
        saveConfigToDisk();
      }
    }

    console.log();
    initAgent();
  } else {
    console.log(`${c.red}✗ Failed to update config.ts${c.reset}`);
    console.log(`${c.dim}You may need to update it manually.${c.reset}\n`);
  }
}

function initAgent(): void {
  agent = new CodingAgent({
    ...config,
    timeout: config.timeout || 120000,
  });
  isFirstMessage = true;
  console.log(`${c.green}✓ Ready (${config.model})${c.reset}\n`);
  saveSession();
}

function showStatus(): void {
  const timeoutSecs = (config.timeout || 120000) / 1000;
  console.log(`
${c.yellow}━━━ Status ━━━${c.reset}
  URL:       ${config.apiUrl || c.dim + "not set" + c.reset}
  Model:     ${config.model || c.dim + "not set" + c.reset}
  API Key:   ${config.apiKey ? c.green + "✓ Set" + c.reset : c.red + "✗ Not set" + c.reset}
  Timeout:   ${timeoutSecs}s
  Connected: ${agent ? c.green + "✓ Yes" + c.reset : c.dim + "No" + c.reset}
  Project:   ${path.basename(currentDir)}
  Auto-save: ${autoAcceptAll ? "ON" : "OFF"}
  Config:    ${CONFIG_FILE}
`);
}

function buildStructure(dir: string, indent = "", depth = 0): string[] {
  const lines: string[] = [];
  const maxDepth = 4;
  const maxFilesPerDir = 30;
  const skipDirs = [
    "node_modules",
    "__pycache__",
    "dist",
    "build",
    "venv",
    ".git",
    "coverage",
    ".next",
    ".cache",
  ];

  if (depth > maxDepth) return lines;

  try {
    const items = fs.readdirSync(dir);
    const filtered = items
      .filter((i) => {
        if (i.startsWith(".")) return false;
        if (skipDirs.includes(i)) return false;
        return true;
      })
      .sort((a, b) => {
        const aPath = path.join(dir, a);
        const bPath = path.join(dir, b);
        try {
          const aIsDir = fs.statSync(aPath).isDirectory();
          const bIsDir = fs.statSync(bPath).isDirectory();
          if (aIsDir && !bIsDir) return -1;
          if (!aIsDir && bIsDir) return 1;
        } catch {}
        return a.localeCompare(b);
      })
      .slice(0, maxFilesPerDir);

    for (const item of filtered) {
      const p = path.join(dir, item);
      try {
        const stat = fs.statSync(p);
        if (stat.isDirectory()) {
          lines.push(`${indent}${item}/`);
          const subLines = buildStructure(p, indent + "  ", depth + 1);
          lines.push(...subLines);
        } else {
          lines.push(`${indent}${item}`);
        }
      } catch {}
    }
  } catch {}

  return lines;
}

function getStructureText(): string {
  projectStructure = [`${path.basename(currentDir)}/`];
  const structure = buildStructure(currentDir, "  ", 0);
  projectStructure.push(...structure);

  if (projectStructure.length <= 1) {
    projectStructure.push("  (empty or no readable files)");
  }

  return projectStructure.join("\n");
}

function resolvePath(p: string): string {
  if (p.startsWith("~")) p = p.replace("~", process.env.HOME || process.env.USERPROFILE || "");
  return path.isAbsolute(p) ? path.normalize(p) : path.resolve(currentDir, p);
}

function getFileIcon(ext: string): string {
  const icons: Record<string, string> = {
    ".py": "🐍",
    ".js": "📜",
    ".ts": "💠",
    ".tsx": "⚛️",
    ".jsx": "⚛️",
    ".json": "📋",
    ".md": "📝",
    ".txt": "📄",
    ".sh": "⚡",
    ".bash": "⚡",
    ".zsh": "⚡",
    ".html": "🌐",
    ".css": "🎨",
    ".scss": "🎨",
    ".yaml": "⚙️",
    ".yml": "⚙️",
    ".toml": "⚙️",
    ".env": "🔒",
    ".go": "🐹",
    ".rs": "🦀",
    ".rb": "💎",
    ".php": "🐘",
    ".java": "☕",
    ".c": "©️",
    ".cpp": "©️",
    ".h": "©️",
  };
  return icons[ext.toLowerCase()] || "📄";
}

function getDisplayTree(dir: string, prefix = "", depth = 0): string {
  if (depth >= 4) return "";
  let result = "";

  try {
    const items = fs.readdirSync(dir).filter((i) => {
      if (i.startsWith(".")) return false;
      if (["node_modules", "dist", "build", ".git"].includes(i)) return false;
      return true;
    });

    items.forEach((item, idx) => {
      const p = path.join(dir, item);
      const isLast = idx === items.length - 1;
      const connector = isLast ? "└── " : "├── ";

      try {
        if (fs.statSync(p).isDirectory()) {
          result += `${prefix}${connector}📁 ${c.cyan}${item}${c.reset}\n`;
          result += getDisplayTree(p, prefix + (isLast ? "    " : "│   "), depth + 1);
        } else {
          result += `${prefix}${connector}${getFileIcon(path.extname(item))} ${item}\n`;
        }
      } catch {}
    });
  } catch {}

  return result;
}

async function askSave(rl: readline.Interface, file: PendingFile): Promise<"y" | "n" | "a" | "p"> {
  console.log(`\n${c.dim}── ${file.filename} ──${c.reset}`);
  const lines = file.content.split("\n");
  console.log(lines.slice(0, 10).join("\n"));
  if (lines.length > 10) console.log(`${c.dim}... (${lines.length - 10} more lines)${c.reset}`);

  return new Promise((resolve) => {
    rl.question(`\n${c.yellow}Save?${c.reset} [Y/n/a/p]: `, (ans) => {
      const a = ans.trim().toLowerCase();
      resolve(a === "n" ? "n" : a === "a" ? "a" : a === "p" ? "p" : "y");
    });
  });
}

function saveFile(file: PendingFile): boolean {
  try {
    const dir = path.dirname(file.fullPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file.fullPath, file.content);
    getStructureText();
    return true;
  } catch (err: any) {
    console.log(`${c.red}Error saving file: ${err.message}${c.reset}`);
    return false;
  }
}

async function processPending(rl: readline.Interface): Promise<void> {
  if (!pendingFiles.length) return;
  let all = false;

  for (const file of pendingFiles) {
    if (autoAcceptAll || all) {
      console.log(saveFile(file) ? `${c.green}✓ ${file.filename}${c.reset}` : `${c.red}✗ ${file.filename}${c.reset}`);
      continue;
    }

    const choice = await askSave(rl, file);
    if (choice === "y") {
      console.log(saveFile(file) ? `${c.green}✓ Saved${c.reset}` : `${c.red}✗ Failed${c.reset}`);
    } else if (choice === "n") {
      console.log(`${c.dim}Skipped${c.reset}`);
    } else if (choice === "a") {
      all = true;
      saveFile(file) && console.log(`${c.green}✓ ${file.filename}${c.reset}`);
    } else if (choice === "p") {
      autoAcceptAll = true;
      saveFile(file) && console.log(`${c.green}✓ ${file.filename}${c.reset}`);
    }
  }

  pendingFiles = [];
}

class CodeExtractor {
  private buffer = "";
  private inBlock = false;
  private filename = "";
  private code = "";
  private dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  process(chunk: string): void {
    this.buffer += chunk;

    if (!this.inBlock) {
      const m = this.buffer.match(/```(\w+):([^\n]+)\n/);
      if (m) {
        this.inBlock = true;
        this.filename = m[2].trim();
        this.code = "";
        this.buffer = this.buffer.slice(this.buffer.indexOf(m[0]) + m[0].length);
      } else {
        if (this.buffer.length > 100) {
          this.buffer = this.buffer.slice(-100);
        }
      }
      return;
    }

    const end = this.buffer.indexOf("```");
    if (end !== -1) {
      this.code += this.buffer.slice(0, end);
      pendingFiles.push({
        filename: this.filename,
        content: this.code.trim(),
        fullPath: path.isAbsolute(this.filename) ? this.filename : path.join(this.dir, this.filename),
      });
      this.buffer = this.buffer.slice(end + 3);
      this.inBlock = false;
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
      pendingFiles.push({
        filename: this.filename,
        content: this.code.trim(),
        fullPath: path.isAbsolute(this.filename) ? this.filename : path.join(this.dir, this.filename),
      });
    }
    this.buffer = "";
    this.inBlock = false;
    this.code = "";
    this.filename = "";
  }

  hasPending(): boolean {
    return pendingFiles.length > 0;
  }
}

async function main(): Promise<void> {
  const baseConfig = loadConfig();
  const savedConfig = loadSavedConfig();

  config = {
    ...baseConfig,
    ...savedConfig,
    timeout: savedConfig.timeout || baseConfig.timeout || 120000,
  } as Config;

  const warmupPromise = config.apiUrl && config.apiKey ? warmConnection() : Promise.resolve();

  printBanner();

  const session = loadSession();
  if (session) {
    const age = Date.now() - session.timestamp;
    if (age < 24 * 60 * 60 * 1000) {
      console.log(`${c.dim}Last session: ${path.basename(session.lastProject)} (${session.lastModel})${c.reset}`);
    }
  }

  console.log(`${c.dim}Project: ${path.basename(currentDir)}${c.reset}`);
  console.log(`${c.dim}Config: ${CONFIG_FILE}${c.reset}`);

  await warmupPromise;

  if (config.apiUrl && config.model && config.apiKey) {
    initAgent();
  } else {
    console.log(`${c.yellow}Run /setup to configure${c.reset}\n`);
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: process.stdin.isTTY ?? false,
  });

  const prompt = (): void => {
    const icon = agent ? `${c.green}●${c.reset}` : `${c.red}○${c.reset}`;
    rl.question(`${icon} ${c.green}You → ${c.reset}`, async (input) => {
      const trimmed = input.trim();
      if (!trimmed) {
        prompt();
        return;
      }

      if (trimmed.startsWith("/")) {
        await handleCmd(trimmed, rl);
        prompt();
        return;
      }

      if (!agent) {
        console.log(`${c.yellow}Run /setup first${c.reset}\n`);
        prompt();
        return;
      }

      lastUserMessage = trimmed;

      try {
        await sendMessage(trimmed, rl);
      } catch (err: any) {
        if (err.name === "AbortError" || err.message?.includes("timeout")) {
          console.error(`\n${c.red}Request timed out. Try /retry or /timeout <seconds>${c.reset}\n`);
        } else {
          console.error(`\n${c.red}Error: ${err.message || err}${c.reset}\n`);
        }
      }

      prompt();
    });
  };

  prompt();
}

async function sendMessage(message: string, rl: readline.Interface): Promise<void> {
  let fullMessage = message;

  if (isFirstMessage) {
    const structure = getStructureText();
    fullMessage = `Project structure:\n${structure}\n\nHelp me code. Use \`\`\`lang:filename.ext for files.\n\nUser request: ${message}`;
    isFirstMessage = false;
  }

  process.stdout.write(`${c.blue}Cody → ${c.reset}`);
  const ext = new CodeExtractor(currentDir);

  try {
    for await (const chunk of agent!.sendStream(fullMessage)) {
      process.stdout.write(chunk);
      ext.process(chunk);
    }
  } catch (err) {
    ext.flush();
    throw err;
  }

  ext.flush();
  console.log("\n");

  if (ext.hasPending()) {
    await processPending(rl);
    if (agent) {
      try {
        await agent.send(`[Updated]\n${getStructureText()}`);
      } catch {}
    }
  }
}

async function handleCmd(input: string, rl: readline.Interface): Promise<void> {
  const parts = input.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
  const cmd = parts[0]?.toLowerCase();
  const args = parts.slice(1);
  const arg = (i: number) => args[i]?.replace(/^"|"$/g, "");

  switch (cmd) {
    case "/q":
    case "/quit":
    case "/exit":
      saveSession();
      console.log(`${c.cyan}Bye!${c.reset}\n`);
      rl.close();
      process.exit(0);

    case "/h":
    case "/help":
      printHelp();
      break;

    case "/setup":
      await runSetup(rl);
      break;

    case "/resetup":
      await runReSetup(rl);
      break;

    case "/models":
    case "/model": {
      const model = await searchModel(rl);
      if (model) {
        config.model = model;
        saveConfigToDisk();
        initAgent();
      }
      break;
    }

    case "/status":
      showStatus();
      break;

    case "/save":
      saveConfigToDisk();
      console.log(`${c.green}✓ Config saved${c.reset}\n`);
      break;

    case "/timeout":
      if (arg(0)) {
        const secs = parseInt(arg(0));
        if (!isNaN(secs) && secs > 0) {
          config.timeout = secs * 1000;
          saveConfigToDisk();
          console.log(`${c.green}✓ Timeout set to ${secs}s${c.reset}\n`);
        } else {
          console.log(`${c.red}Invalid timeout value${c.reset}\n`);
        }
      } else {
        console.log(`${c.yellow}Current timeout: ${(config.timeout || 120000) / 1000}s${c.reset}`);
        console.log(`${c.dim}Usage: /timeout <seconds>${c.reset}\n`);
      }
      break;

    case "/retry":
      if (!agent) {
        console.log(`${c.yellow}/setup first${c.reset}\n`);
        break;
      }
      if (!lastUserMessage) {
        console.log(`${c.yellow}No message to retry${c.reset}\n`);
        break;
      }
      console.log(`${c.dim}Retrying: ${lastUserMessage.slice(0, 50)}...${c.reset}\n`);
      try {
        await sendMessage(lastUserMessage, rl);
      } catch (err: any) {
        console.error(`\n${c.red}Retry failed: ${err.message || err}${c.reset}\n`);
      }
      break;

    case "/auto":
      autoAcceptAll = !autoAcceptAll;
      console.log(`${c.magenta}Auto-accept: ${autoAcceptAll ? "ON" : "OFF"}${c.reset}\n`);
      break;

    case "/structure":
      console.log(`\n${projectStructure.join("\n")}\n`);
      break;

    case "/pwd":
      console.log(`${currentDir}\n`);
      break;

    case "/cd": {
      const cdPath = arg(0) ? resolvePath(arg(0)) : process.env.HOME || "";
      if (cdPath && fs.existsSync(cdPath) && fs.statSync(cdPath).isDirectory()) {
        currentDir = cdPath;
        getStructureText();
        console.log(`${c.green}→ ${currentDir}${c.reset}\n`);
      } else {
        console.log(`${c.red}Not found${c.reset}\n`);
      }
      break;
    }

    case "/ls": {
      const lsPath = arg(0) ? resolvePath(arg(0)) : currentDir;
      if (!fs.existsSync(lsPath)) {
        console.log(`${c.red}Not found${c.reset}\n`);
        break;
      }
      console.log();
      try {
        const items = fs.readdirSync(lsPath);
        items
          .filter((i) => !i.startsWith("."))
          .sort()
          .forEach((item) => {
            const p = path.join(lsPath, item);
            try {
              const isDir = fs.statSync(p).isDirectory();
              console.log(
                `  ${
                  isDir
                    ? "📁 " + c.cyan + item + "/" + c.reset
                    : getFileIcon(path.extname(item)) + " " + item
                }`
              );
            } catch {}
          });
      } catch (err: any) {
        console.log(`${c.red}Error: ${err.message}${c.reset}`);
      }
      console.log();
      break;
    }

    case "/tree": {
      const treePath = arg(0) ? resolvePath(arg(0)) : currentDir;
      if (!fs.existsSync(treePath)) {
        console.log(`${c.red}Not found${c.reset}\n`);
        break;
      }
      console.log(`\n${c.yellow}📁 ${path.basename(treePath)}${c.reset}`);
      console.log(getDisplayTree(treePath));
      break;
    }

    case "/cat": {
      if (!arg(0)) {
        console.log(`${c.red}Usage: /cat <file>${c.reset}\n`);
        break;
      }
      const catPath = resolvePath(arg(0));
      if (fs.existsSync(catPath)) {
        try {
          console.log(`\n${c.dim}── ${path.basename(catPath)} ──${c.reset}`);
          console.log(fs.readFileSync(catPath, "utf-8"));
          console.log();
        } catch (err: any) {
          console.log(`${c.red}Error: ${err.message}${c.reset}\n`);
        }
      } else {
        console.log(`${c.red}Not found${c.reset}\n`);
      }
      break;
    }

    case "/rm":
      if (!arg(0)) {
        console.log(`${c.red}Usage: /rm <file>${c.reset}\n`);
        break;
      }
      try {
        fs.unlinkSync(resolvePath(arg(0)));
        getStructureText();
        console.log(`${c.green}✓ Deleted${c.reset}\n`);
      } catch (err: any) {
        console.log(`${c.red}Error: ${err.message}${c.reset}\n`);
      }
      break;

    case "/run":
    case "/x": {
      if (!arg(0)) {
        console.log(`${c.red}Usage: /run <file>${c.reset}\n`);
        break;
      }
      const runPath = resolvePath(arg(0));
      if (!fs.existsSync(runPath)) {
        console.log(`${c.red}Not found${c.reset}\n`);
        break;
      }
      console.log(`${c.dim}Running...${c.reset}\n`);
      try {
        const result = await runScript(path.dirname(runPath), path.basename(runPath));
        if (result.output) console.log(result.output);
        if (result.error) console.log(`${c.red}${result.error}${c.reset}`);
        console.log(`${result.success ? c.green + "✓" : c.red + "✗"}${c.reset}\n`);
      } catch (err: any) {
        console.log(`${c.red}Error: ${err.message}${c.reset}\n`);
      }
      break;
    }

    case "/sh":
      if (args.length) {
        const shellCmd = args.join(" ").replace(/^"|"$/g, "");
        console.log(`${c.dim}$ ${shellCmd}${c.reset}\n`);
        try {
          const r = await runCommand(shellCmd, [], currentDir);
          if (r.output) console.log(r.output);
          if (r.error) console.log(`${c.red}${r.error}${c.reset}`);
        } catch (err: any) {
          console.log(`${c.red}Error: ${err.message}${c.reset}`);
        }
        console.log();
      } else {
        console.log(`${c.red}Usage: /sh <command>${c.reset}\n`);
      }
      break;

    case "/c":
    case "/clear":
      if (agent) {
        agent.clearHistory();
        isFirstMessage = true;
        console.log(`${c.yellow}Cleared${c.reset}\n`);
      } else {
        console.log(`${c.yellow}Not connected${c.reset}\n`);
      }
      break;

    case "/add": {
      if (!agent) {
        console.log(`${c.yellow}/setup first${c.reset}\n`);
        break;
      }
      if (!arg(0)) {
        console.log(`${c.red}Usage: /add <file>${c.reset}\n`);
        break;
      }
      const addPath = resolvePath(arg(0));
      if (!fs.existsSync(addPath)) {
        console.log(`${c.red}Not found${c.reset}\n`);
        break;
      }
      try {
        const fileContent = fs.readFileSync(addPath, "utf-8");
        process.stdout.write(`${c.blue}Cody → ${c.reset}`);
        for await (const chunk of agent.sendStream(`File: ${arg(0)}\n\`\`\`\n${fileContent}\n\`\`\``)) {
          process.stdout.write(chunk);
        }
        console.log("\n");
      } catch (err: any) {
        console.log(`${c.red}Error: ${err.message}${c.reset}\n`);
      }
      break;
    }

    default:
      console.log(`${c.red}Unknown: ${cmd}${c.reset}`);
      console.log(`${c.dim}Type /help for available commands${c.reset}\n`);
  }
}

main().catch((err) => {
  console.error(`${c.red}Fatal error: ${err.message || err}${c.reset}`);
  process.exit(1);
});