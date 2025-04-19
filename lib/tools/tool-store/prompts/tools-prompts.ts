import { PluginID } from '@/types/plugins';

export const getPluginPrompt = (pluginID: PluginID): string => {
  switch (pluginID) {
    case PluginID.WAF_DETECTOR:
      return `
The user has selected the WAF Detector plugin, which uses the wafw00f tool in the terminal. This tool fingerprints Web Application Firewalls (WAFs) behind target applications. Remember:
1. Focus on identifying and fingerprinting WAFs protecting the target web application.
2. Provide wafw00f-specific options and explanations for effective WAF detection.
`;
    case PluginID.WHOIS_LOOKUP:
      return `
The user has selected the WHOIS Lookup plugin, which uses the whois tool in the terminal. This tool retrieves domain registration information and network details. Remember:
1. Focus on gathering domain ownership, registration dates, name servers, and other relevant information.
2. Provide whois-specific options and explanations for effective domain information retrieval.
`;
    case PluginID.SUBDOMAIN_FINDER:
      return `
The user has selected the Subdomain Finder plugin, which uses the subfinder tool in the terminal. This tool discovers subdomains of a given domain. Remember:
1. Focus on efficiently enumerating subdomains of the target domain.
2. Provide subfinder-specific options and explanations for effective subdomain discovery.
`;
    default:
      return '';
  }
};
