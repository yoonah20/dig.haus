import { useEffect } from 'react';

interface Options {
  title: string;
  description?: string;
  image?: string | null;
  url?: string;
  type?: 'website' | 'music.album';
}

function upsertMeta(selector: string, attrs: Record<string, string>) {
  let el = document.head.querySelector(selector) as HTMLMetaElement | null;
  if (!el) {
    el = document.createElement('meta');
    document.head.appendChild(el);
  }
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
}

function upsertLink(rel: string, href: string) {
  let el = document.head.querySelector(`link[rel="${rel}"]`) as HTMLLinkElement | null;
  if (!el) {
    el = document.createElement('link');
    el.rel = rel;
    document.head.appendChild(el);
  }
  el.href = href;
}

// Keep the browser tab, canonical URL, and og/twitter meta tags in sync with
// the current page. Social crawlers that don't run JS are handled by the
// Vercel Edge Middleware; this hook covers browser tabs + JS-capable crawlers.
export function useDocumentHead({ title, description, image, url, type = 'website' }: Options) {
  useEffect(() => {
    document.title = title;

    upsertMeta('meta[property="og:title"]', { property: 'og:title', content: title });
    upsertMeta('meta[name="twitter:title"]', { name: 'twitter:title', content: title });
    upsertMeta('meta[property="og:type"]', { property: 'og:type', content: type });

    if (description) {
      upsertMeta('meta[name="description"]', { name: 'description', content: description });
      upsertMeta('meta[property="og:description"]', { property: 'og:description', content: description });
      upsertMeta('meta[name="twitter:description"]', { name: 'twitter:description', content: description });
    }

    if (url) {
      upsertMeta('meta[property="og:url"]', { property: 'og:url', content: url });
      upsertLink('canonical', url);
    }

    if (image) {
      upsertMeta('meta[property="og:image"]', { property: 'og:image', content: image });
      upsertMeta('meta[name="twitter:image"]', { name: 'twitter:image', content: image });
    }
  }, [title, description, image, url, type]);
}
