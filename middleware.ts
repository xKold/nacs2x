import { NextRequest, NextResponse } from 'next/server';

// AI training crawlers + known aggressive scrapers. Vercel Firewall is the
// primary defense; this middleware is defense-in-depth so a bot that slips
// past still gets a cheap 403 at the edge instead of invoking a function.
const BLOCKED_UA_PATTERN =
  /(GPTBot|ChatGPT-User|OAI-SearchBot|ClaudeBot|Claude-Web|anthropic-ai|PerplexityBot|Bytespider|Amazonbot|CCBot|Google-Extended|FacebookBot|meta-externalagent|meta-externalfetcher|Applebot-Extended|cohere-ai|Diffbot|YouBot|ImagesiftBot|omgili|DataForSeoBot)/i;

export function middleware(request: NextRequest) {
  const ua = request.headers.get('user-agent') ?? '';
  if (BLOCKED_UA_PATTERN.test(ua)) {
    return new NextResponse('Forbidden', {
      status: 403,
      headers: { 'x-robots-tag': 'noindex, nofollow' },
    });
  }
  return NextResponse.next();
}

// Skip static assets and the discovery files bots need to read (robots.txt,
// sitemap.xml) so well-behaved crawlers can still learn they're disallowed.
export const config = {
  matcher: [
    '/((?!_next|robots\\.txt|sitemap\\.xml|favicon\\.ico|icon\\.png|bannerfix\\.png).*)',
  ],
};
