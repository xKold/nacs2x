import type { MetadataRoute } from 'next';

const BASE_URL = 'https://nacs2x.vercel.app';

const BLOCKED_AI_BOTS = [
  'GPTBot',
  'ChatGPT-User',
  'OAI-SearchBot',
  'ClaudeBot',
  'Claude-Web',
  'anthropic-ai',
  'PerplexityBot',
  'Bytespider',
  'Amazonbot',
  'CCBot',
  'Google-Extended',
  'FacebookBot',
  'meta-externalagent',
  'meta-externalfetcher',
  'Applebot-Extended',
  'cohere-ai',
  'Diffbot',
  'YouBot',
  'ImagesiftBot',
  'omgili',
  'DataForSeoBot',
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/', '/players/lookup', '/search'],
      },
      ...BLOCKED_AI_BOTS.map((bot) => ({
        userAgent: bot,
        disallow: '/',
      })),
    ],
    sitemap: `${BASE_URL}/sitemap.xml`,
    host: BASE_URL,
  };
}
