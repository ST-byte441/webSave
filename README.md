# webSave

A Chrome and Firefox extension that saves a web page, or a page plus the pages it links to, as one clean PDF. It works on pages you're logged into, because it reads them inside your own browser.

With **Pick pages myself** you browse normally and press **Add this page** on each page you want. The popup lists them with a count (also shown on the toolbar icon), and **Save PDF** combines them into one document. The list lasts until you discard it or quit the browser.

## Develop

```bash
npm install
npm run vendor   # copies Readability and the browser polyfill into extension/vendor
npm test
```

## Load the extension

- **Chrome:** open `chrome://extensions`, turn on Developer mode, choose **Load unpacked** and pick the `extension` folder.
- **Firefox:** open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on** and pick `extension/manifest.json`. Temporary add-ons are removed when Firefox restarts.
- **From WSL:** a Windows browser can load the folder through the Linux entry in File Explorer's sidebar.

## Manual checklist

Run this in both Chrome and Firefox before calling a change done:

1. On a public article, save **This page**. The PDF has the title page, the article without nav or ads, images, and selectable text.
2. On a page you're logged into, save **This page**. The content is the logged-in version.
3. On a docs site, save **This page + linked pages** at depth 2. The PDF has a table of contents, each page starts on a new sheet, links between pages jump to sections, and the capture report lists any skipped pages.
4. Open a JavaScript-heavy page in the crawl (for example a single-page-app docs site). Its section has content (method `background-tab` in the report), and no extra tabs stay open.
5. Press **Cancel** during a crawl, then **Make PDF**. The PDF contains only the pages captured so far.
6. Decline the all-sites permission prompt. **This page** still works, and **This page + linked pages** shows the access message.
7. Open the popup on `chrome://extensions` or `about:addons`. Save is disabled with an explanation.
8. Firefox only: if the popup closes when the permission prompt appears, grant access and press Save again. The second Save must work without a prompt.
9. Choose **Pick pages myself**. Add 3 pages across 2 sites, closing and reopening the popup between adds. The list and the toolbar badge show 3.
10. Press Add again on an already-added page. Add is disabled with "This page is already in the list".
11. Remove the middle page with ✕. Count and badge show 2.
12. **Save PDF (2 pages)**. The PDF has a table of contents and two sections in the order added. Reopen the popup: the 2 pages are still there.
13. **Discard all…** → **Keep** leaves the list; **Discard all…** → **Discard** empties it and clears the badge.
14. Add a page, quit and reopen the browser. The collection is empty.
15. Decline the all-sites prompt on Save PDF. The capture tab shows the missing-images warning and the PDF is still produced.
