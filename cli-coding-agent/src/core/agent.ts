import { APIClient, type Message } from "./api";
import type { Config } from "../utils/config";

export const SYSTEM_PROMPT = `You are Cody, a friendly and expert coding assistant.

## Your> Personality:
- You're helpful, conversational, and knowledgeable
- You chat naturally when users want to talk
- You switch to coding mode when users need code
- You're concise but not robotic

## When to Code:
Only use the file format when users:
- Ask you to create, write, or generate files
- Ask you to build something
- Request code for a specific purpose
- Say "make", "create", "build", "write code", etc.

## When to Chat:
Just respond normally when users:
- Say hi, hello, or greet you
- Ask questions about concepts
- Want explanations or advice
- Are having a conversation

## File Creation Format:
When creating files, use this exact format:

\`\`\`python:script.py
# code here
\`\`\`

\`\`\`typescript:src/utils/helper.ts
// code here
\`\`\`

Format: \`\`\`language:path/to/filename.ext

## Coding Rules (when coding):
1. Write complete, functional code
2. Include error handling
3. Follow best practices
4. Create full project structures when needed
5. Be concise - code speaks louder than explanations

## Your Expertise:
- Full-stack web development
- System scripts and automation
- APIs, CLIs, games, data processing
- Any programming language or framework

You're a developer's companion - chat when they want to chat, code when they need code.`;

export class CodingAgent {
  private client: APIClient;
  private conversationHistory: Message[];

  constructor(config: Config) {
    this.client = new APIClient(config);
    this.conversationHistory = [{ role: "system", content: SYSTEM_PROMPT }];
  }

  async send(userMessage: string): Promise<string> {
    this.conversationHistory.push({
      role: "user",
      content: userMessage,
    });

    const response = await this.client.chat(this.conversationHistory);

    this.conversationHistory.push({
      role: "assistant",
      content: response,
    });

    return response;
  }

  async *sendStream(userMessage: string): AsyncGenerator<string> {
    this.conversationHistory.push({
      role: "user",
      content: userMessage,
    });

    let fullResponse = "";

    for await (const chunk of this.client.chatStream(this.conversationHistory)) {
      fullResponse += chunk;
      yield chunk;
    }

    this.conversationHistory.push({
      role: "assistant",
      content: fullResponse,
    });
  }

  getLastResponse(): string {
    const lastAssistant = [...this.conversationHistory]
      .reverse()
      .find((m) => m.role === "assistant");
    return lastAssistant?.content || "";
  }

  clearHistory(): void {
    this.conversationHistory = [{ role: "system", content: SYSTEM_PROMPT }];
  }

  getHistory(): Message[] {
    return [...this.conversationHistory];
  }
}