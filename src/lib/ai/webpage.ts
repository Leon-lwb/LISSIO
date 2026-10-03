import { Readability } from '@mozilla/readability';
import DOMPurify from 'dompurify';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

import type { AiWebFetchPage, AiWebPageArticle } from '../../types';

const MAX_ARTICLE_CHARS = 50_000;

const SANITIZE_CONFIG = {
  ALLOWED_TAGS: [
    'html', 'head', 'body', 'title', 'meta', 'base',
    'article', 'section', 'header', 'main', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'p', 'div', 'span', 'blockquote', 'pre', 'code', 'br', 'hr',
    'ul', 'ol', 'li', 'dl', 'dt', 'dd',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption',
    'a', 'img', 'figure', 'figcaption', 'strong', 'b', 'em', 'i', 'u', 's', 'del',
    'sub', 'sup', 'abbr', 'time', 'mark',
  ],
  ALLOWED_ATTR: [
    'href', 'src', 'alt', 'title', 'lang', 'dir', 'class', 'id',
    'name', 'property', 'content', 'charset', 'datetime',
    'colspan', 'rowspan', 'scope', 'start', 'type', 'checked', 'align',
  ],
  FORBID_TAGS: [
    'script', 'style', 'noscript', 'template', 'iframe', 'object', 'embed',
    'form', 'input', 'button', 'select', 'textarea', 'nav', 'aside', 'footer',
  ],
  FORBID_CONTENTS: [
    'script', 'style', 'noscript', 'template', 'iframe', 'object', 'embed',
    'form', 'input', 'button', 'select', 'textarea', 'nav', 'aside', 'footer',
  ],
  FORBID_ATTR: ['style'],
  ALLOW_DATA_ATTR: false,
  ALLOW_ARIA_ATTR: true,
  KEEP_CONTENT: true,
};

function parseDocument(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

function ensureDocumentBase(document: Document, baseUrl: string): void {
  const existing = document.querySelector('base');
  const base = existing ?? document.createElement('base');
  base.setAttribute('href', baseUrl);
  if (!existing) document.head.prepend(base);
}

function firstText(...values: (string | null | undefined)[]): string | null {
  for (const value of values) {
    const normalized = value?.trim();
    if (normalized) return normalized;
  }
  return null;
}

function pageMeta(document: Document, key: 'name' | 'property', value: string): string | null {
  return firstText(document.querySelector(`meta[${key}="${value}"]`)?.getAttribute('content'));
}

function cleanMarkdown(markdown: string): string {
  return markdown
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function truncateArticle(markdown: string): { markdown: string; truncated: boolean } {
  if (markdown.length <= MAX_ARTICLE_CHARS) return { markdown, truncated: false };
  const cut = markdown.lastIndexOf('\n', MAX_ARTICLE_CHARS);
  const end = cut > MAX_ARTICLE_CHARS * 0.8 ? cut : MAX_ARTICLE_CHARS;
  return {
    markdown: `${markdown.slice(0, end).trimEnd()}\n\n[内容超过 50,000 字符，已截断]`,
    truncated: true,
  };
}

/**
 * Convert fetched HTML into a compact, model-facing article.
 *
 * DOMPurify removes scripts/styles and unsafe attributes, Mozilla Readability
 * isolates the main article, and Turndown emits Markdown so tag/layout noise
 * never enters the AI context.
 */
export function preprocessWebPage(page: AiWebFetchPage): AiWebPageArticle {
  const document = parseDocument(page.html);
  const originalTitle = firstText(
    document.querySelector('meta[property="og:title"]')?.getAttribute('content'),
    document.title,
    page.final_url,
    page.requested_url,
  ) ?? page.requested_url;
  const originalSiteName = pageMeta(document, 'property', 'og:site_name');
  const originalPublishedTime = firstText(
    pageMeta(document, 'property', 'article:published_time'),
    document.querySelector('time[datetime]')?.getAttribute('datetime'),
  );
  const originalAuthor = firstText(
    pageMeta(document, 'name', 'author'),
    pageMeta(document, 'property', 'article:author'),
  );

  DOMPurify.sanitize(document.documentElement, {
    ...SANITIZE_CONFIG,
    IN_PLACE: true,
  });
  const sourceUrl = firstText(page.final_url, page.requested_url) ?? page.requested_url;
  ensureDocumentBase(document, sourceUrl);

  const article = new Readability(document, {
    charThreshold: 20,
    maxElemsToParse: 5_000,
    disableJSONLD: true,
  }).parse();
  const contentHtml = article?.content ?? document.body?.innerHTML ?? '';
  const turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
    strongDelimiter: '**',
    linkStyle: 'inlined',
    bulletListMarker: '-',
  });
  turndown.use(gfm);
  turndown.remove(['script', 'style', 'nav', 'aside', 'form']);

  const converted = cleanMarkdown(turndown.turndown(contentHtml));
  const textFallback = cleanMarkdown(document.body?.textContent ?? '');
  const finalMarkdown = converted.length > 0 ? converted : textFallback;
  const { markdown, truncated } = truncateArticle(finalMarkdown);
  return {
    url: sourceUrl,
    title: firstText(article?.title, originalTitle) ?? originalTitle,
    site_name: firstText(article?.siteName, originalSiteName),
    byline: firstText(article?.byline, originalAuthor),
    published_time: firstText(article?.publishedTime, originalPublishedTime),
    excerpt: firstText(article?.excerpt),
    markdown,
    truncated,
  };
}
