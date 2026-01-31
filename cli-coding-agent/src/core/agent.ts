import { APIClient, type Message } from "./api";
import type { Config } from "../utils/config";

export const SYSTEM_PROMPT = `You are Cody, a friendly and expert coding assistant.

## How to Respond:

### Just Chat (NO code blocks) when users:
- Greet you (hi, hello, hey, etc.)
- Ask questions about concepts or ideas
- Want explanations, advice, or opinions
- Are having a casual conversation
- Ask "what is", "how does", "why", "explain", etc.

For these, respond naturally in plain text. No code blocks unless they specifically ask for code.

### Write Code when users explicitly:
- Say "create", "make", "build", "write", "generate" a file/project
- Ask you to fix or modify existing code
- Request implementation of something specific

## File Creation Format:
ONLY when creating/modifying files, use this exact format:

\`\`\`language:exact/path/to/file.ext
code here
\`\`\`

Examples:
\`\`\`python:script.py
print("hello")
\`\`\`

\`\`\`typescript:src/utils/helper.ts
export const helper = () => {};
\`\`\`

## CRITICAL Path Rules:
1. ALWAYS preserve exact case sensitivity (src not SRC, lib not Lib)
2. Use paths EXACTLY as shown in the project structure
3. If user says "in src folder", use "src/" not "SRC/"
4. Match existing directory names exactly
5. Use forward slashes for paths

## When Writing Code:
- Write complete, functional code
- Include error handling
- Follow best practices for the language
- Keep explanations brief - code is the focus

## Your Expertise:
Full-stack development, system scripts, APIs, CLIs, any language or framework.

Remember: Chat naturally for questions, only use code blocks when explicitly asked to create/write code.`;

export class CodingAgent {
  private client: APIClient;
  private conversationHistory: Message[];
  private pendingUserMessage: Message | null = null;

  constructor(config: Config) {
    this.client = new APIClient(config);
    this.conversationHistory = [{ role: "system", content: SYSTEM_PROMPT }];
  }

  async send(userMessage: string): Promise<string> {
    const userMsg: Message = { role: "user", content: userMessage };
    this.conversationHistory.push(userMsg);

    try {
      const response = await this.client.chat(this.conversationHistory);
      this.conversationHistory.push({
        role: "assistant",
        content: response,
      });
      return response;
    } catch (error) {
      this.conversationHistory.pop();
      throw error;
    }
  }

  async *sendStream(userMessage: string): AsyncGenerator<string> {
    const userMsg: Message = { role: "user", content: userMessage };
    this.pendingUserMessage = userMsg;
    this.conversationHistory.push(userMsg);

    let fullResponse = "";
    let success = false;

    try {
      for await (const chunk of this.client.chatStream(this.conversationHistory)) {
        fullResponse += chunk;
        yield chunk;
      }
      success = true;
    } finally {
      if (success && fullResponse) {
        this.conversationHistory.push({
          role: "assistant",
          content: fullResponse,
        });
      } else if (!success) {
        const idx = this.conversationHistory.indexOf(userMsg);
        if (idx !== -1) {
          this.conversationHistory.splice(idx, 1);
        }
      }
      this.pendingUserMessage = null;
    }
  }

  abort(): void {
    this.client.abort();
  }

  getLastResponse(): string {
    const lastAssistant = [...this.conversationHistory]
      .reverse()
      .find((m) => m.role === "assistant");
    return lastAssistant?.content || "";
  }

  clearHistory(): void {
    this.conversationHistory = [{ role: "system", content: SYSTEM_PROMPT }];
    this.pendingUserMessage = null;
  }

  getHistory(): Message[] {
    return [...this.conversationHistory];
  }

  getMessageCount(): number {
    return this.conversationHistory.filter((m) => m.role !== "system").length;
  }

  updateSystemPrompt(addition: string): void {
    if (this.conversationHistory[0]?.role === "system") {
      this.conversationHistory[0].content = SYSTEM_PROMPT + "\n\n" + addition;
    }
  }
}