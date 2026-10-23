// Renders the extension icon: a shield around a plain "X" letterform (not X
// Corp's logo, which is a trademark). Writes public/icon/<size>.png, which WXT
// puts in the manifest, and design/icon.svg as the editable source.
//
//   npm run icons
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const root = join(import.meta.dirname, '..');
const SIZES = [16, 32, 48, 128];

/**
 * A black shield (X's own colour) with a white X. The X is a letterform with
 * flat, horizontal terminals, so it reads as the letter rather than a
 * round-capped "close" ✕. The grey outline keeps the shield visible on dark
 * toolbars. Small sizes get heavier bars and outline so they stay legible.
 */
function iconSvg(small: boolean): string {
  const bar = small ? 21 : 16; // horizontal width of each diagonal bar
  const outline = small ? 4 : 3;
  const [top, bottom, left, right] = [38, 88, 40 - (bar - 16) / 2, 88 + (bar - 16) / 2];
  const bars = [
    [left, top, left + bar, top, right, bottom, right - bar, bottom],
    [right - bar, top, right, top, left + bar, bottom, left, bottom],
  ].map((p) => `<polygon points="${p.join(' ')}"/>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <defs>
    <linearGradient id="shield" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2f3336"/>
      <stop offset="1" stop-color="#000000"/>
    </linearGradient>
  </defs>
  <path d="M64 6 L112 21 C112.5 34 113 46 113 58 C113 90 92 112 64 123 C36 112 15 90 15 58 C15 46 15.5 34 16 21 Z"
        fill="url(#shield)" stroke="#8b98a5" stroke-width="${outline}" stroke-linejoin="round"/>
  <g fill="#ffffff">
    ${bars.join('\n    ')}
  </g>
</svg>
`;
}

mkdirSync(join(root, 'public', 'icon'), { recursive: true });
mkdirSync(join(root, 'design'), { recursive: true });
writeFileSync(join(root, 'design', 'icon.svg'), iconSvg(false));
for (const size of SIZES) {
  // Rasterise large, then downscale, for clean edges at every size.
  await sharp(Buffer.from(iconSvg(size <= 32)), { density: 576 })
    .resize(size, size)
    .png()
    .toFile(join(root, 'public', 'icon', `${size}.png`));
}
console.log(`Wrote public/icon/{${SIZES.join(',')}}.png and design/icon.svg`);
