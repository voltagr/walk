import type { Sandbox } from '@e2b/code-interpreter';
import { PluginID } from '@/types/plugins';
import type { AgentMode } from '@/types/llms';

/**
 * Interface for tools that need access to the data stream
 */
export interface ToolContext {
  dataStream: any;
  sandbox?: Sandbox | null;
  userID: string;
  persistentSandbox?: boolean;
  selectedPlugin?: PluginID;
  terminalTemplate?: string;
  setSandbox?: (sandbox: Sandbox) => void;
  isPremiumUser?: boolean;
  agentMode: AgentMode;
}

// Constants for sandbox creation
export const SANDBOX_TEMPLATE = 'terminal-agent-sandbox';
export const BASH_SANDBOX_TIMEOUT = 15 * 60 * 1000;

// Plugin command mapping
export const PLUGIN_COMMAND_MAP: Partial<Record<PluginID, string>> = {
  [PluginID.WAF_DETECTOR]: 'wafw00f',
  [PluginID.WHOIS_LOOKUP]: 'whois',
  [PluginID.SUBDOMAIN_FINDER]: 'subfinder',
};
