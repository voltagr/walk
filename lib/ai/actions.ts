import { type CoreUserMessage, generateObject } from 'ai';
import { myProvider } from './providers';
import { DEFAULT_TITLE_GENERATION_PROMPT_TEMPLATE } from './prompts';
import { extractTextContent } from './message-utils';
import { z } from 'zod';

export async function generateTitleFromUserMessage({
  message,
  abortSignal,
}: {
  message: CoreUserMessage;
  abortSignal?: AbortSignal;
}) {
  const textContent = extractTextContent(message.content);

  const {
    object: { title },
  } = await generateObject({
    model: myProvider.languageModel('chat-model-small'),
    schema: z.object({
      title: z.string().describe('The generated title (3-5 words)'),
    }),
    messages: [
      {
        role: 'user',
        content: DEFAULT_TITLE_GENERATION_PROMPT_TEMPLATE(textContent),
      },
    ],
    abortSignal,
    maxTokens: 50,
  });

  return title;
}
