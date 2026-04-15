// Vercel Edge Middleware — runs on every /album/:slug request.
//
// For link-preview crawlers (Twitter, KakaoTalk, Slack, Discord, Facebook,
// LinkedIn, Googlebot, etc.) we fetch the album from api.dig.haus and return
// a minimal HTML shell with OG/Twitter tags baked in so the shared link
// renders as a rich card with cover art + title.
//
// Real users fall through to the static SPA (index.html) — zero latency,
// no bundle changes.

export const config = {
  matcher: '/album/:path*',
};

const API_ORIGIN = 'https://api.dig.haus';
const SITE_ORIGIN = 'https://dig.haus';

const CRAWLER_UA = new RegExp(
  [
    'facebookexternalhit',
    'facebookcatalog',
    'Twitterbot',
    'LinkedInBot',
    'Slackbot',
    'Discordbot',
    'TelegramBot',
    'WhatsApp',
    'kakaotalk-scrap',
    'KAKAOTALK',
    'Googlebot',
    'bingbot',
    'Applebot',
    'DuckDuckBot',
    'YandexBot',
    'Baiduspider',
    'Yahoo! Slurp',
    'Pinterest',
    'redditbot',
    'embedly',
    'mastodon',
    'fediverse',
  ].join('|'),
  'i'
);

function escapeAttr(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#39;';
      default: return ch;
    }
  });
}

function buildOgHtml(params: {
  url: string;
  title: string;
  description: string;
  image: string | null;
  artist: string;
  releaseDate: string | null;
}): string {
  const { url, title, description, image, artist, releaseDate } = params;
  const imgTags = image
    ? `
  <meta property="og:image" content="${escapeAttr(image)}" />
  <meta name="twitter:image" content="${escapeAttr(image)}" />`
    : '';
  const releaseDateTag =
    releaseDate && /^\d{4}-\d{2}-\d{2}$/.test(releaseDate)
      ? `<meta property="music:release_date" content="${escapeAttr(releaseDate)}" />`
      : '';

  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <title>${escapeAttr(title)}</title>
  <meta name="description" content="${escapeAttr(description)}" />
  <link rel="canonical" href="${escapeAttr(url)}" />
  <meta property="og:type" content="music.album" />
  <meta property="og:site_name" content="dig.haus" />
  <meta property="og:url" content="${escapeAttr(url)}" />
  <meta property="og:title" content="${escapeAttr(title)}" />
  <meta property="og:description" content="${escapeAttr(description)}" />
  <meta property="og:locale" content="ko_KR" />
  <meta property="music:musician" content="${escapeAttr(artist)}" />
  ${releaseDateTag}
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escapeAttr(title)}" />
  <meta name="twitter:description" content="${escapeAttr(description)}" />${imgTags}
</head>
<body>
  <h1>${escapeAttr(title)}</h1>
  <p>${escapeAttr(description)}</p>
  <p><a href="${escapeAttr(url)}">Open on dig.haus</a></p>
</body>
</html>
`;
}

export default async function middleware(request: Request): Promise<Response | undefined> {
  const ua = request.headers.get('user-agent') || '';
  if (!CRAWLER_UA.test(ua)) return; // real user — fall through to SPA

  const { pathname } = new URL(request.url);
  const slug = decodeURIComponent(pathname.replace(/^\/album\//, '').replace(/\/$/, ''));
  if (!slug) return;

  try {
    const apiRes = await fetch(`${API_ORIGIN}/api/albums/${encodeURIComponent(slug)}`, {
      headers: { accept: 'application/json' },
    });
    if (!apiRes.ok) return;

    const data = (await apiRes.json()) as {
      album?: {
        title?: string;
        artist?: string;
        releaseDate?: string;
        label?: string | null;
        coverArtUrl?: string | null;
        coverArtFallbacks?: string[];
      };
    };
    const album = data.album;
    if (!album?.title || !album?.artist) return;

    const year = (album.releaseDate || '').slice(0, 4);
    const titleLine = `${album.title} — ${album.artist}`;
    const descParts: string[] = [];
    if (year) descParts.push(year);
    if (album.label) descParts.push(album.label);
    descParts.push('리뷰, 구매처, 유사 앨범 정보');
    const description = descParts.join(' · ');

    // CoverArtArchive exposes /front-250 for thumbs and /front-500 for a
    // mid-size version — swap up so the social preview isn't a tiny tile.
    const rawImage = album.coverArtUrl || album.coverArtFallbacks?.[0] || null;
    const image = rawImage?.replace(
      /^(https:\/\/coverartarchive\.org\/release(?:-group)?\/[^/]+\/front)-250(\.[a-z]+)?$/i,
      '$1-500$2'
    ) || rawImage;

    const html = buildOgHtml({
      url: `${SITE_ORIGIN}/album/${slug}`,
      title: `${titleLine} | dig.haus`,
      description,
      image,
      artist: album.artist,
      releaseDate: album.releaseDate || null,
    });

    return new Response(html, {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'public, s-maxage=3600, stale-while-revalidate=86400',
      },
    });
  } catch {
    return; // on any failure, fall through to SPA
  }
}
