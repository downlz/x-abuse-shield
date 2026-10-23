import { detectPageContext } from './context';
import { X } from './selectors';

/**
 * Snapshots X's main column as a standalone HTML file for extractor tests.
 * The file contains the posts on screen — keep fixtures out of public repos.
 */
export function captureFixture(): { filename: string; html: string; posts: number } | null {
  const column = document.querySelector(X.primaryColumn);
  if (!column) return null;

  const clone = column.cloneNode(true) as Element;
  clone.querySelectorAll('script, noscript, iframe, link, video source').forEach((node) => node.remove());

  const context = detectPageContext();
  const posts = column.querySelectorAll(X.post).length;
  const meta = {
    context,
    path: location.pathname,
    capturedAt: new Date().toISOString(),
    viewport: `${innerWidth}x${innerHeight}`,
    posts,
  };
  const stamp = meta.capturedAt.replace(/[:.]/g, '-').slice(0, 19);
  const html = `<!doctype html>
<html lang="${document.documentElement.lang}" dir="${document.documentElement.dir}">
<head>
<meta charset="utf-8">
<meta name="x-fixture" content="${escapeAttribute(JSON.stringify(meta))}">
<title>x fixture · ${context}</title>
</head>
<body>
${clone.outerHTML}
</body>
</html>
`;
  return { filename: `x-${context}-${stamp}.html`, html, posts };
}

export function downloadFile(filename: string, contents: string, type = 'text/html'): void {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const link = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
