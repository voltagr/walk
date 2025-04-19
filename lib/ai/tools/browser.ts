import { buildSystemPrompt } from '@/lib/ai/prompts';
import { toVercelChatMessages } from '@/lib/ai/message-utils';
import llmConfig from '@/lib/models/llm-config';
import { streamText } from 'ai';
import { myProvider } from '@/lib/ai/providers';
import FirecrawlApp, { type ScrapeResponse } from '@mendable/firecrawl-js';
import PostHogClient from '@/app/posthog';

interface BrowserToolConfig {
  profile: any;
  messages: any[];
  dataStream: any;
}

async function getProviderConfig(profile: any) {
  const systemPrompt = buildSystemPrompt(
    llmConfig.systemPrompts.pentestGPTBrowser,
    profile.profile_context,
  );

  return {
    systemPrompt,
    model: myProvider.languageModel('chat-model-gpt-small'),
  };
}

export function getLastUserMessage(messages: any[]): string {
  return (
    messages.findLast((msg) => msg.role === 'user')?.content || 'Unknown query'
  );
}

export async function browsePage(url: string): Promise<string> {
  const firecrawlApiKey = process.env.FIRECRAWL_API_KEY;

  if (!firecrawlApiKey) {
    throw new Error(
      'FIRECRAWL_API_KEY is not set in the environment variables',
    );
  }

  try {
    const app = new FirecrawlApp({ apiKey: firecrawlApiKey });
    const scrapeResult = (await app.scrapeUrl(url, {
      formats: ['markdown'],
    })) as ScrapeResponse;

    if (!scrapeResult.success) {
      throw new Error(
        `Error fetching URL: ${url}. Error: ${scrapeResult.error}`,
      );
    }

    if (!scrapeResult.markdown) {
      throw new Error(`Empty content received from URL: ${url}`);
    }

    return scrapeResult.markdown;
  } catch (error) {
    console.error('[BrowserTool] Error browsing URL:', url, error);
    throw error;
  }
}

export async function browseMultiplePages(
  urls: string[],
): Promise<Record<string, string>> {
  const results: Record<string, string> = {};
  const urlsToProcess = urls.slice(0, 3);

  try {
    await Promise.all(
      urlsToProcess.map(async (url) => {
        try {
          const content = await browsePage(url);
          results[url] = content;
        } catch (error) {
          console.error(`[BrowserTool] Error browsing URL: ${url}`, error);
          results[url] =
            `Error accessing URL: ${url}. The webpage might be empty, unavailable, or there could be an issue with the content retrieval process.`;
        }
      }),
    );
  } catch (error) {
    console.error('[BrowserTool] Error in browseMultiplePages:', error);
    throw error;
  }

  return results;
}

export function createBrowserPrompt(
  browserResult: string,
  lastUserMessage: string,
  url: string,
): string {
  return `You have just browsed a webpage. The content you found is enclosed below:

<webpage>
<source>${url}</source>
<webpage_content>${browserResult}</webpage_content>
</webpage>

The user has the following query about this webpage:

<user_query>
${lastUserMessage}
</user_query>

With the information from the webpage content above, \
respond to the user's query as if you have comprehensive knowledge of the page. \
Provide a direct and insightful answer to the query. \
If the specific details are not present, draw upon related information to \
offer valuable insights or suggest practical alternatives. \
If the webpage content is empty, irrelevant, or indicates an error, \
clearly state that you couldn't access the information and explain why.

Important: Do not refer to "the webpage content provided" or "the information given" in your response. \
Instead, answer as if you have directly attempted to view the webpage and are sharing your experience with it.`;
}

export function createMultiBrowserPrompt(
  browserResults: Record<string, string>,
  lastUserMessage: string,
): string {
  const webpageContentSections = Object.entries(browserResults)
    .map(
      ([url, content]) => `<webpage>
<source>${url}</source>
<webpage_content>${content}</webpage_content>
</webpage>`,
    )
    .join('\n\n');

  return `You have just browsed multiple webpages. The content you found is enclosed below:

${webpageContentSections}

The user has the following query about these webpages:

<user_query>
${lastUserMessage}
</user_query>

With the information from the webpage contents above, \
respond to the user's query as if you have comprehensive knowledge of the pages. \
Provide a direct and insightful answer to the query. \
If the specific details are not present, draw upon related information to \
offer valuable insights or suggest practical alternatives. \
If any webpage content is empty, irrelevant, or indicates an error, \
clearly state that you couldn't access the information and explain why.

Important: Do not refer to "the webpage content provided" or "the information given" in your response. \
Instead, answer as if you have directly attempted to view the webpages and are sharing your experience with them.`;
}

export async function executeBrowserTool({
  open_url,
  config,
}: {
  open_url: string | string[];
  config: BrowserToolConfig;
}) {
  if (!process.env.FIRECRAWL_API_KEY) {
    throw new Error(
      'FIRECRAWL_API_KEY is not set in the environment variables',
    );
  }

  const { profile, messages, dataStream } = config;
  const { systemPrompt, model } = await getProviderConfig(profile);

  const posthog = PostHogClient();
  if (posthog) {
    posthog.capture({
      distinctId: profile.user_id,
      event: 'browser_executed',
      properties: {
        model: model,
      },
    });
  }

  try {
    const lastUserMessage = getLastUserMessage(messages);
    let browserPrompt: string;

    dataStream.writeData({ type: 'tool-call', content: 'browser' });

    // Handle single URL or multiple URLs
    if (typeof open_url === 'string') {
      const browserResult = await browsePage(open_url);
      browserPrompt = createBrowserPrompt(
        browserResult,
        lastUserMessage,
        open_url,
      );
    } else {
      const browserResults = await browseMultiplePages(open_url);
      browserPrompt = createMultiBrowserPrompt(browserResults, lastUserMessage);
    }

    const { fullStream } = streamText({
      model,
      messages: [
        {
          role: 'system',
          content: systemPrompt,
        },
        ...toVercelChatMessages(messages.slice(0, -1)),
        { role: 'user', content: browserPrompt },
      ],
      maxTokens: 2048,
    });

    dataStream.writeData({ type: 'tool-call', content: 'none' });
    dataStream.writeData({ type: 'text-delta', content: '\n\n' });

    for await (const delta of fullStream) {
      if (delta.type === 'text-delta') {
        dataStream.writeData({
          type: 'text-delta',
          content: delta.textDelta,
        });
      }
    }

    return 'Browser tool executed';
  } catch (error) {
    console.error('[BrowserTool] Error:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      model,
    });
    throw error;
  }
}
