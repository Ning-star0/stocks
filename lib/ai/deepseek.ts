import OpenAI from "openai";
import type { ChatCompletion, ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";

type DeepSeekChatRequest = ChatCompletionCreateParamsNonStreaming & {
  extra_body?: {
    thinking?: { type: "enabled" | "disabled" };
  };
};

export async function createChatCompletion(
  client: OpenAI,
  request: ChatCompletionCreateParamsNonStreaming
): Promise<ChatCompletion> {
  const baseUrl = process.env.OPENAI_BASE_URL?.toLowerCase() ?? "";
  if (!baseUrl.includes("deepseek.com")) {
    return client.chat.completions.create(request);
  }

  const deepSeekRequest = {
    ...request,
    extra_body: {
      ...(request as DeepSeekChatRequest).extra_body,
      thinking: { type: "disabled" }
    }
  } as DeepSeekChatRequest;
  return client.chat.completions.create(deepSeekRequest);
}
