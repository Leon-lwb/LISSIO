import { describe, expect, it } from 'vitest';

import { preprocessWebPage } from '../webpage';

describe('preprocessWebPage', () => {
  it('extracts article Markdown and removes scripts, styles, and navigation noise', () => {
    const article = preprocessWebPage({
      requested_url: 'https://example.com/original',
      final_url: 'https://example.com/docs/page',
      content_type: 'text/html; charset=utf-8',
      html: `<!doctype html>
        <html>
          <head>
            <title>API Guide</title>
            <meta name="author" content="Ada">
            <meta property="og:site_name" content="Example Docs">
            <style>.secret { color: red }</style>
            <script>window.bad = true</script>
          </head>
          <body>
            <nav>Home | Login</nav>
            <article>
              <h1>API Guide</h1>
              <p>Use the <strong>read</strong> endpoint.</p>
              <p>See <a href="../reference">the reference</a>.</p>
              <table><thead><tr><th>Name</th></tr></thead><tbody><tr><td>read</td></tr></tbody></table>
            </article>
            <aside>Related links</aside>
            <script>alert('x')</script>
            <style>.noise { display: none }</style>
          </body>
        </html>`,
    });

    expect(article.title).toBe('API Guide');
    expect(article.site_name).toBe('Example Docs');
    expect(article.byline).toBe('Ada');
    expect(article.url).toBe('https://example.com/docs/page');
    expect(article.markdown).toContain('Use the **read** endpoint.');
    expect(article.markdown).toContain('https://example.com/reference');
    expect(article.markdown).toContain('| Name |');
    expect(article.markdown).not.toContain('window.bad');
    expect(article.markdown).not.toContain('alert');
    expect(article.markdown).not.toContain('Home | Login');
    expect(article.markdown).not.toContain('Related links');
    expect(article.truncated).toBe(false);
  });

  it('falls back to readable body text and reports truncation', () => {
    const longParagraph = `A${' very'.repeat(10_000)} long paragraph`;
    const article = preprocessWebPage({
      requested_url: 'https://example.com/short',
      final_url: 'https://example.com/short',
      content_type: 'text/html',
      html: `<html><head><title>Fallback</title></head><body><p>${longParagraph}</p></body></html>`,
    });

    expect(article.title).toBe('Fallback');
    expect(article.markdown.length).toBeLessThan(51_000);
    expect(article.markdown).toContain('已截断');
    expect(article.truncated).toBe(true);
  });
});
