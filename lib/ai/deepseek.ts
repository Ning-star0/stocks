import OpenAI from "openai";
import type { ChatCompletion, ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";

type DeepSeekChatRequest = ChatCompletionCreateParamsNonStreaming & {
  thinking?: { type: "enabled" | "disabled" };
};

export async function createChatCompletion(
  client: OpenAI,
  request: ChatCompletionCreateParamsNonStreaming
): Promise<ChatCompletion> {
  const baseUrl = process.env.OPENAI_BASE_URL?.toLowerCase() ?? "";
  if (!baseUrl.includes("deepseek.com")) {
    return client.chat.completions.create(request);
  }

  const deepSeekRequest: DeepSeekChatRequest = {
    ...request,
    thinking: { type: "disabled" }
  };
  return client.chat.completions.create(deepSeekRequest);
}
