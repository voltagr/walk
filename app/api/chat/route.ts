import { getAIProfile } from '@/lib/server/server-chat-helpers';
import { toVercelChatMessages } from '@/lib/ai/message-utils';
import { handleErrorResponse } from '@/lib/models/api-error';
import llmConfig from '@/lib/models/llm-config';
import { checkRatelimitOnApi } from '@/lib/server/ratelimiter';
import { createDataStreamResponse, smoothStream, streamText } from 'ai';
import { PluginID } from '@/types/plugins';
import { myProvider } from '@/lib/ai/providers';
import { terminalPlugins } from '@/lib/ai/terminal-utils';
import PostHogClient from '@/app/posthog';
import { handleToolExecution } from '@/lib/ai/tool-handler-v2';
import { createToolSchemas } from '@/lib/ai/tools/toolSchemas';
import { processRag } from '@/lib/ai/rag-processor';
import { processChatMessages } from '@/lib/ai/message-utils';
import type { LLMID } from '@/types';
import { generateTitleFromUserMessage } from '@/lib/ai/actions';

export const maxDuration = 600;

export const preferredRegion = [
  'iad1',
  'arn1',
  'bom1',
  'cdg1',
  'cle1',
  'cpt1',
  'dub1',
  'fra1',
  'gru1',
  'hnd1',
  'icn1',
  'kix1',
  'lhr1',
  'pdx1',
  'sfo1',
  'sin1',
  'syd1',
];

export async function POST(request: Request) {
  try {
    const { messages, model, modelParams, chatMetadata } = await request.json();

    const profile = await getAIProfile();
    const config = await getProviderConfig(
      model,
      profile,
      modelParams.selectedPlugin,
    );

    if (config.rateLimitCheckResult !== null) {
      return config.rateLimitCheckResult.response;
    }

    let {
      messages: validatedMessages,
      selectedModel: finalSelectedModel,
      supportsImages,
      systemPrompt,
    } = await processChatMessages(
      messages,
      config.selectedModel,
      modelParams.selectedPlugin,
      modelParams.isContinuation,
      modelParams.isTerminalContinuation,
      llmConfig.openai.apiKey,
      config.isLargeModel,
      profile.profile_context,
    );

    const title = generateTitleFromUserMessage({
      message:
        messages.find((m: { role: string }) => m.role === 'user') ||
        messages[messages.length - 1],
      abortSignal: request.signal,
    });

    const toolResponse = await handleToolExecution({
      messages: validatedMessages,
      profile,
      isTerminalContinuation: modelParams.isTerminalContinuation,
      selectedPlugin: modelParams.selectedPlugin,
      isLargeModel: config.isLargeModel,
      agentMode: modelParams.agentMode,
      confirmTerminalCommand: modelParams.confirmTerminalCommand,
      abortSignal: request.signal,
      chatMetadata,
      title,
    });
    if (toolResponse) {
      return toolResponse;
    }

    // Process RAG
    let ragUsed = false;
    let ragId: string | null = null;
    if (modelParams.isRagEnabled) {
      const ragResult = await processRag({
        messages,
        isContinuation: modelParams.isContinuation,
        profile,
        selectedChatModel: finalSelectedModel,
      });

      ragUsed = ragResult.ragUsed;
      ragId = ragResult.ragId;
      if (ragResult.systemPrompt) {
        systemPrompt = ragResult.systemPrompt;
      }
    }

    const posthog = PostHogClient();
    if (posthog) {
      posthog.capture({
        distinctId: profile.user_id,
        event: finalSelectedModel,
      });
    }

    if (!ragUsed && finalSelectedModel !== 'chat-model-large') {
      finalSelectedModel = config.isLargeModel
        ? 'chat-model-gpt-large-with-tools'
        : 'chat-model-gpt-small-with-tools';
    }

    try {
      return createDataStreamResponse({
        execute: async (dataStream) => {
          dataStream.writeData({ ragUsed, ragId });

          const baseConfig = {
            model: myProvider.languageModel(finalSelectedModel),
            system: systemPrompt,
            messages: toVercelChatMessages(validatedMessages, supportsImages),
            maxTokens: 2048,
            abortSignal: request.signal,
            experimental_transform: smoothStream({ chunking: 'word' }),
          };

          const toolConfig = {
            messages: validatedMessages,
            profile,
            agentMode: modelParams.agentMode,
            confirmTerminalCommand: modelParams.confirmTerminalCommand,
            dataStream,
            abortSignal: request.signal,
          };

          const result = streamText({
            ...baseConfig,
            ...(!ragUsed
              ? {
                  tools: createToolSchemas(toolConfig).getSelectedSchemas(
                    config.isLargeModel
                      ? ['browser', 'webSearch', 'terminal']
                      : ['browser', 'webSearch'],
                  ),
                }
              : {}),
          });

          // Run title generation and streamText in parallel
          await Promise.all([
            result.mergeIntoDataStream(dataStream),
            (async () => {
              if (chatMetadata.newChat) {
                const generatedTitle = await title;
                dataStream.writeData({ chatTitle: generatedTitle });
              }
            })(),
          ]);
        },
      });
    } catch (error) {
      return handleErrorResponse(error);
    }
  } catch (error: any) {
    const errorMessage = error.message || 'An unexpected error occurred';
    const errorCode = error.status || 500;

    return new Response(JSON.stringify({ message: errorMessage }), {
      status: errorCode,
    });
  }
}

async function getProviderConfig(
  model: LLMID,
  profile: any,
  selectedPlugin: PluginID,
) {
  // Moving away from chat-model-large to chat-model-gpt-large
  const modelMap: Record<string, string> = {
    'mistral-medium': 'chat-model-small',
    'mistral-large': 'chat-model-gpt-large',
    'gpt-4-turbo-preview': 'chat-model-gpt-large',
  };
  // Moving away from gpt-4-turbo-preview to pentestgpt-pro
  const rateLimitModelMap: Record<string, string> = {
    'mistral-medium': 'pentestgpt',
    'mistral-large': 'pentestgpt-pro',
    'gpt-4-turbo-preview': 'pentestgpt-pro',
  };

  const selectedModel = modelMap[model];
  if (!selectedModel) {
    throw new Error('Selected model is undefined');
  }
  const isLargeModel = selectedModel.includes('large');

  const rateLimitModel =
    selectedPlugin !== PluginID.NONE &&
    !terminalPlugins.includes(selectedPlugin as PluginID) &&
    selectedPlugin !== PluginID.ENHANCED_SEARCH
      ? selectedPlugin
      : rateLimitModelMap[model] || model;

  const rateLimitCheckResult = await checkRatelimitOnApi(
    profile.user_id,
    rateLimitModel,
  );

  return {
    selectedModel,
    rateLimitCheckResult,
    isLargeModel,
  };
}
