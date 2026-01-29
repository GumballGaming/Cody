
export const commandAliases: Record<string, string> = {

  "/q": "/quit",
  "/e": "/exit",
  "/quit": "/exit",

  "/h": "/help",
  "/?": "/help",
  
 
  "/c": "/clear",
  "/cls": "/clear",
  

  "/hist": "/history",
  

  "/cfg": "/config",
  "/settings": "/config",

  "/l": "/list",
  "/ls": "/list",
  "/dir": "/list",
  
  "/s": "/save",
  "/w": "/save",
  "/write": "/save",
  
  "/r": "/read",
  "/cat": "/read",
  "/show": "/read",
  
  "/d": "/delete",
  "/del": "/delete",
  "/rm": "/delete",

  "/x": "/run",
  "/exec": "/run",
  

  "/sh": "/shell",
  "/$": "/shell",
  "/cmd": "/shell",
};

// Resolve command alias to full command
export function resolveCommand(input: string): string {
  const parts = input.split(" ");
  const cmd = parts[0].toLowerCase();
  
  if (commandAliases[cmd]) {
    parts[0] = commandAliases[cmd];
    return parts.join(" ");
  }
  
  return input;
}


export function parseCommand(input: string): { command: string; args: string[] } {
  const resolved = resolveCommand(input);
  const parts = resolved.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
  
  const command = parts[0]?.toLowerCase() || "";
  const args = parts.slice(1).map((arg) => arg.replace(/^"|"$/g, ""));
  
  return { command, args };
}