import { PluginID } from '@/types/plugins';
import { executeWebSearchTool } from '@/lib/ai/tools/web-search';
import { executeTerminalAgent } from '@/lib/ai/tools/terminal-agent';
import { executeReasonLLMTool } from '@/lib/ai/tools/reason-llm';
import { executeReasoningWebSearchTool } from '@/lib/ai/tools/reasoning-web-search';
import { terminalPlugins } from '@/lib/ai/terminal-utils';
import { createStreamResponse } from '@/lib/ai-helper';
import type { AgentMode } from '@/types/llms';

interface ToolHandlerConfig {
  messages: any[];
  profile: any;
  isTerminalContinuation: boolean;
  selectedPlugin: PluginID;
  isLargeModel: boolean;
  agentMode: AgentMode;
  confirmTerminalCommand: boolean;
  abortSignal: AbortSignal;
  chatMetadata?: { newChat: boolean };
  title: Promise<string>;
}

export async function handleToolExecution(config: ToolHandlerConfig) {
  const {
    messages,
    profile,
    isTerminalContinuation,
    selectedPlugin,
    isLargeModel,
    agentMode,
    confirmTerminalCommand,
    abortSignal,
    chatMetadata,
    title,
  } = config;

  switch (selectedPlugin) {
    case PluginID.WEB_SEARCH:
      return createStreamResponse(async (dataStream) => {
        await Promise.all([
          executeWebSearchTool({
            config: {
              messages,
              profile,
              dataStream,
              isLargeModel,
              directToolCall: true,
            },
          }),
          (async () => {
            if (chatMetadata?.newChat) {
              dataStream.writeData({ chatTitle: await title });
            }
          })(),
        ]);
      });

    case PluginID.TERMINAL:
      return createStreamResponse(async (dataStream) => {
        await Promise.all([
          executeTerminalAgent({
            config: {
              messages,
              profile,
              dataStream,
              agentMode,
              confirmTerminalCommand,
              abortSignal,
            },
          }),
          (async () => {
            if (chatMetadata?.newChat) {
              dataStream.writeData({ chatTitle: await title });
            }
          })(),
        ]);
      });

    case PluginID.REASONING:
      return createStreamResponse(async (dataStream) => {
        await Promise.all([
          executeReasonLLMTool({
            config: {
              messages,
              profile,
              dataStream,
              isLargeModel,
            },
          }),
          (async () => {
            if (chatMetadata?.newChat) {
              dataStream.writeData({ chatTitle: await title });
            }
          })(),
        ]);
      });

    case PluginID.REASONING_WEB_SEARCH:
      return createStreamResponse(async (dataStream) => {
        await Promise.all([
          executeReasoningWebSearchTool({
            config: {
              messages,
              profile,
              dataStream,
              isLargeModel,
            },
          }),
          (async () => {
            if (chatMetadata?.newChat) {
              dataStream.writeData({ chatTitle: await title });
            }
          })(),
        ]);
      });

    default:
      if (
        isTerminalContinuation ||
        confirmTerminalCommand ||
        terminalPlugins.includes(selectedPlugin as PluginID)
      ) {
        return createStreamResponse(async (dataStream) => {
          await Promise.all([
            executeTerminalAgent({
              config: {
                messages,
                profile,
                dataStream,
                selectedPlugin: selectedPlugin as PluginID,
                agentMode,
                confirmTerminalCommand,
                abortSignal,
              },
            }),
            (async () => {
              if (chatMetadata?.newChat) {
                dataStream.writeData({ chatTitle: await title });
              }
            })(),
          ]);
        });
      }
  }

  return null;
}
