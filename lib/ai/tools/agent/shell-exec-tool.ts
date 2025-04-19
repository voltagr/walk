import { tool } from 'ai';
import { z } from 'zod';
import {
  type ToolContext,
  SANDBOX_TEMPLATE,
  PLUGIN_COMMAND_MAP,
} from './types';
import { executeTerminalCommand } from '@/lib/tools/e2b/terminal-executor';
import {
  streamTerminalOutput,
  reduceTerminalOutput,
} from '@/lib/ai/terminal-utils';
import PostHogClient from '@/app/posthog';
import { ensureSandboxConnection } from './utils/sandbox-utils';
import { PluginID } from '@/types/plugins';

/**
 * Creates a terminal tool for executing commands in the sandbox environment
 * @param context - The context needed for tool execution
 * @returns The terminal tool
 */
export const createShellExecTool = (context: ToolContext) => {
  const {
    dataStream,
    sandbox: initialSandbox,
    userID,
    persistentSandbox: initialPersistentSandbox = true,
    selectedPlugin,
    terminalTemplate = SANDBOX_TEMPLATE,
    setSandbox,
    isPremiumUser,
  } = context;

  return tool({
    description:
      'Execute commands in the sandbox environment. Use for running code, installing packages, or managing files.',
    parameters: z.object({
      exec_dir: z
        .string()
        .describe(
          'Working directory for command execution (must use absolute path)',
        ),
      command: z.string().describe('Shell command to execute'),
    }),
    execute: async (args) => {
      const { exec_dir, command } = args as {
        exec_dir: string;
        command: string;
      };

      // Validate plugin-specific commands
      if (selectedPlugin && selectedPlugin !== PluginID.NONE) {
        const expectedCommand = PLUGIN_COMMAND_MAP[selectedPlugin];
        if (expectedCommand && !command.trim().startsWith(expectedCommand)) {
          dataStream.writeData({
            type: 'text-delta',
            content: `Command must start with "${expectedCommand}" for this plugin`,
          });
          return `Command must start with "${expectedCommand}" for this plugin`;
        }
      }

      // Ensure sandbox connection
      const { sandbox, persistentSandbox } = await ensureSandboxConnection(
        {
          userID,
          dataStream,
          isPremiumUser,
          selectedPlugin,
          terminalTemplate,
          setSandbox,
        },
        {
          initialSandbox,
          initialPersistentSandbox,
        },
      );

      const posthog = PostHogClient();
      if (posthog) {
        posthog.capture({
          distinctId: userID,
          event: selectedPlugin
            ? `${selectedPlugin}_executed`
            : 'terminal_executed',
          properties: {
            command: command,
            persistentSandbox: persistentSandbox,
          },
        });
      }

      dataStream.writeData({
        type: 'tool-call',
        content: 'terminal',
      });

      dataStream.writeData({
        type: 'text-delta',
        content: `<terminal-command exec-dir="${exec_dir}">${command}</terminal-command>`,
      });

      // Execute command
      const terminalStream = await executeTerminalCommand({
        userID,
        command,
        exec_dir,
        sandbox,
      });

      let terminalOutput = '';
      await streamTerminalOutput(terminalStream, (chunk) => {
        dataStream.writeData({
          type: 'text-delta',
          content: chunk,
        });
        terminalOutput += chunk;
      });

      return reduceTerminalOutput(terminalOutput);
    },
  });
};
