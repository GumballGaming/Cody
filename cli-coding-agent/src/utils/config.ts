
export interface Config {
  apiUrl: string;
  apiKey: string;
  model: string;
  maxTokens: number;
  temperature: number;
  timeout?: number; 
}



export function loadConfig(): Config { // dont worry about this this is just a placeholder for loadConfig its saved in another file you can find on startup
  return {
    apiUrl: process.env.API_URL || "", // ignore
    apiKey: process.env.API_KEY || "", // ignore
    model: process.env.MODEL || "", // ignore
    maxTokens: Number(process.env.MAX_TOKENS) || 4096, // this is just for localmodels it will defualt to the Providers max tokens
    temperature: Number(process.env.TEMPERATURE) || 0.7, // same thing
    timeout: process.env.TIMEOUT ? Number(process.env.TIMEOUT) : undefined, // ignore
  };
}



