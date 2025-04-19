import { PluginID } from '@/types/plugins';

export const getFreePlugins = (): PluginID[] => [
  PluginID.TERMINAL,
  PluginID.SUBDOMAIN_FINDER,
  PluginID.WAF_DETECTOR,
  PluginID.WHOIS_LOOKUP,
];

export const getTerminalPlugins = (): PluginID[] => [
  PluginID.WAF_DETECTOR,
  PluginID.WHOIS_LOOKUP,
  PluginID.SUBDOMAIN_FINDER,
  PluginID.TERMINAL,
];

export const isFreePlugin = (plugin: PluginID): boolean =>
  getFreePlugins().includes(plugin);

export const isTerminalPlugin = (plugin: PluginID): boolean =>
  getTerminalPlugins().includes(plugin);

export const getTerminalTemplate = (plugin: PluginID): string => {
  return isFreePlugin(plugin)
    ? 'free-terminal-plugins-v1'
    : 'pro-terminal-plugins-v1';
};
