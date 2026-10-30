import { describe, it, expect } from 'vitest';
import { absolutizeUrls, cleanDocument } from '../../extension/lib/cleaner.js';

const parse = (html) => new DOMParser().parseFromString(html, 'text/html');
const prose = (topic) => `<p>${`This paragraph explains ${topic} in detail, with examples, caveats, and notes. `.repeat(8)}</p>`;

const ARTICLE = `<!doctype html><html><head><title>Install Guide</title></head><body>
<nav><a href="/">Home</a> <a href="/about">About us</a></nav>
<article><h1>Install Guide</h1>${prose('installation')}
<p>Continue with <a href="setup">the setup page</a> when you are done reading this part of the guide.</p>
${prose('configuration')}<img src="img/a.png" alt="Diagram"></article>
<footer>Copyright footer text</footer></body></html>`;

const LISTING = `<html><head><title>Downloads</title></head><body>
<nav>Home About</nav><div class="cookie-banner">Accept cookies</div>
<main><ul><li>Release one</li><li>Release two</li></ul>
<img src="/px.gif" width="1" height="1"><img src="/shot.png" alt="Screenshot"></main>
<footer>Footer links</footer></body></html>`;

describe('cleanDocument', () => {
  const page = cleanDocument(parse(ARTICLE), 'https://docs.example.com/guide/intro');

  it('keeps the article and drops navigation and footer', () => {
    expect(page.url).toBe('https://docs.example.com/guide/intro');
    expect(page.title).toBe('Install Guide');
    expect(page.contentHtml).toContain('explains installation');
    expect(page.contentHtml).not.toContain('Copyright footer');
    expect(page.contentHtml).not.toContain('About us');
    expect(page.textLength).toBeGreaterThanOrEqual(200);
  });

  it('makes link and image URLs absolute', () => {
    expect(page.contentHtml).toContain('href="https://docs.example.com/guide/setup"');
    expect(page.contentHtml).toContain('src="https://docs.example.com/guide/img/a.png"');
  });

  it('falls back to the cleaned body when there is no real article', () => {
    const listing = cleanDocument(parse(LISTING), 'https://site.example.com/downloads');
    expect(listing.title).toBe('Downloads');
    expect(listing.contentHtml).toContain('Release one');
    expect(listing.contentHtml).not.toContain('Accept cookies');
    expect(listing.contentHtml).not.toContain('Home About');
    expect(listing.contentHtml).not.toContain('Footer links');
    expect(listing.textLength).toBeLessThan(200);
  });

  it('removes 1x1 tracking pixels but keeps real images', () => {
    const listing = cleanDocument(parse(LISTING), 'https://site.example.com/downloads');
    expect(listing.contentHtml).not.toContain('px.gif');
    expect(listing.contentHtml).toContain('src="https://site.example.com/shot.png"');
  });

  it('uses the URL as the title when the page has none', () => {
    const page2 = cleanDocument(parse('<html><body><main><p>Short</p></main></body></html>'), 'https://x.com/untitled');
    expect(page2.title).toBe('https://x.com/untitled');
  });
});

describe('absolutizeUrls', () => {
  it('resolves protocol-relative, relative, srcset and lazy-load URLs', () => {
    const doc = parse('<img src="//cdn.example.com/a.png" srcset="small.png 480w, /big.png 1200w" data-src="lazy.png"><a id="top" href="#top">t</a><a id="mail" href="mailto:a@b.com">m</a><img id="inline" src="data:image/png;base64,AAAA">');
    absolutizeUrls(doc, 'https://site.example.com/docs/page');
    const img = doc.querySelector('img');
    expect(img.getAttribute('src')).toBe('https://cdn.example.com/a.png');
    expect(img.getAttribute('srcset')).toBe('https://site.example.com/docs/small.png 480w, https://site.example.com/big.png 1200w');
    expect(img.getAttribute('data-src')).toBe('https://site.example.com/docs/lazy.png');
    expect(doc.getElementById('top').getAttribute('href')).toBe('https://site.example.com/docs/page#top');
    expect(doc.getElementById('mail').getAttribute('href')).toBe('mailto:a@b.com');
    expect(doc.getElementById('inline').getAttribute('src')).toBe('data:image/png;base64,AAAA');
  });

  it('resolves relative URLs against the page base element', () => {
    const page3 = cleanDocument(parse('<html><head><base href="/docs/"></head><body><main><a href="intro">Intro</a><img src="pic.png"></main></body></html>'), 'https://site.com/app/page');
    expect(page3.contentHtml).toContain('href="https://site.com/docs/intro"');
    expect(page3.contentHtml).toContain('src="https://site.com/docs/pic.png"');
  });
});
