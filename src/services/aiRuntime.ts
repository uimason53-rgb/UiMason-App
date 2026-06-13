import { getAuthToken } from "../hooks/useSessionManager";

export const BRAIN_MODEL = "gpt-5.5";
export const BUILDER_MODEL = "deepseek-v4-pro";
export const BRAIN_PROVIDER = "openai";
export const BUILDER_PROVIDER = "deepseek";

export const aiJsonHeaders = (): Record<string, string> => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${getAuthToken()}`,
});

const sanitizeAiError = (message: string) =>
  message
    .replace(/OpenAI Brain/gi, "UiMason AI")
    .replace(/DeepSeek Builder/gi, "UiMason AI")
    .replace(/DeepSeek/gi, "UiMason AI")
    .replace(/GPT(?:-\d+(?:\.\d+)?)?/gi, "UiMason AI");

export const readApiError = async (response: Response, providerName: string): Promise<string> => {
  const fallback = `${providerName} API error: ${response.status}`;
  try {
    const payload = await response.json();
    return sanitizeAiError(payload?.error?.message || payload?.error || payload?.message || fallback);
  } catch {
    const text = await response.text().catch(() => "");
    return sanitizeAiError(text || fallback);
  }
};

const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

export const shouldRetryResponse = (response: Response): boolean => RETRYABLE_STATUS.has(response.status);

export const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

export const withAiRetry = async <T>(
  operation: () => Promise<T>,
  attempts = 2,
  backoffMs = 500
): Promise<T> => {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      await sleep(backoffMs * attempt);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("AI request failed");
};
