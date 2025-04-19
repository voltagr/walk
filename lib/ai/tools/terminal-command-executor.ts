import PostHogClient from '@/app/posthog';
import { executeTerminalCommand } from '@/lib/tools/e2b/terminal-executor';
import {
  streamTerminalOutput,
  reduceTerminalOutput,
} from '@/lib/ai/terminal-utils';
import type { Sandbox } from '@e2b/code-interpreter';
import { PluginID } from '@/types/plugins';
import { ensureSandboxConnection } from './agent/utils/sandbox-utils';
import { PLUGIN_COMMAND_MAP } from './agent/types';

interface TerminalCommandExecutorConfig {
  userID: string;
  dataStream: any;
  isPremiumUser: boolean;
  selectedPlugin?: PluginID;
  terminalTemplate: string;
  setSandbox: (sandbox: Sandbox) => void;
  initialSandbox?: Sandbox;
  initialPersistentSandbox?: boolean;
  messages: any[];
}

export async function executeTerminalCommandWithConfig({
  userID,
  dataStream,
  isPremiumUser,
  selectedPlugin,
  terminalTemplate,
  setSandbox,
  initialSandbox,
  initialPersistentSandbox,
  messages,
}: TerminalCommandExecutorConfig) {
  const lastAssistantMessageContent = messages[messages.length - 2]?.content;
  const isConfirmedCommand =
    lastAssistantMessageContent?.includes('<terminal-command');

  if (!isConfirmedCommand) {
    return { messages, output: null };
  }

  const confirmedCommandRegex =
    /<terminal-command(?:\s+exec-dir="([^"]*)")?>([\s\S]*?)<\/terminal-command>/g;

  const matches = Array.from(
    lastAssistantMessageContent.matchAll(confirmedCommandRegex),
  );
  const lastMatch = matches[matches.length - 1] as RegExpMatchArray | undefined;

  if (!lastMatch) {
    return { messages, output: null };
  }

  const [, exec_dir, command] = lastMatch;

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

  const reducedOutput = reduceTerminalOutput(terminalOutput);

  const updatedMessages = [...messages];
  const lastMessage = updatedMessages[updatedMessages.length - 1];
  if (lastMessage) {
    lastMessage.content = `${lastMessage.content || ''}\n\n${reducedOutput}`;
  }

  return { messages: updatedMessages };
}
