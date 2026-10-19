// Генерирует PNG-иконки PWA из public/icons/icon.svg:
//   icon-192.png, icon-512.png, icon-maskable-512.png,
//   apple-touch-icon.png (180), og-image.png (1200x630).
// Запуск: npm run icons  (нужен sharp — devDependency).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const iconsDir = join(root, 'public', 'icons');
const source = readFileSync(join(iconsDir, 'icon.svg'));

// Арт уже вписан в 512×512 с закруглением; для maskable перекладываем его
// в центр на непрозрачный фон — «безопасная зона» 80% не пострадает при обрезке.
const maskableSource = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="#171323"/>${source.toString().replace(/^<\?xml[^>]*\?>/, '')}</svg>`;

const ogSource = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#571c37"/><stop offset="1" stop-color="#171323"/></linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.42" r="0.62"><stop stop-color="#f3e8ef" stop-opacity="0.10"/><stop offset="1" stop-color="#f3e8ef" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#g)"/>
  <rect width="1200" height="630" fill="url(#glow)"/>
  <g transform="translate(344 96)">${source.toString().replace(/^<\?xml[^>]*\?>/, '')}</g>
  <text x="600" y="585" font-family="Manrope, Arial, sans-serif" font-size="62" font-weight="800" fill="#f3e8ef" text-anchor="middle" letter-spacing="1">WakanDa.<tspan fill="#e43e50">*</tspan></text>
  <text x="600" y="623" font-family="Arial, sans-serif" font-size="22" font-weight="600" fill="#c9a1b4" text-anchor="middle" letter-spacing="7">HABITS · TASKS · DISCIPLINE</text>
</svg>`;

async function render(svg, width, height, out) {
  await sharp(Buffer.from(svg), { density: 300 }).resize(width, height).png().toFile(out);
  console.log('created', out.replace(root.replaceAll('\\', '/') + '/', ''), `${width}x${height}`);
}

// Простая маскаable-версия: фон + уменьшенный арт по центру.
async function maskable(size) {
  const art = await sharp(Buffer.from(source), { density: 300 }).resize(Math.round(size * 0.72)).png().toBuffer();
  const padding = Math.round(size * 0.14);
  const background = sharp({
    create: { width: size, height: size, channels: 4, background: { r: 23, g: 19, b: 35, alpha: 1 } },
  });
  await background.composite([{ input: art, left: padding, top: padding }]).png().toFile(join(iconsDir, `icon-maskable-${size}.png`));
  console.log('created', `public/icons/icon-maskable-${size}.png`, `${size}x${size}`);
}

await render(source, 192, 192, join(iconsDir, 'icon-192.png'));
await render(source, 512, 512, join(iconsDir, 'icon-512.png'));
await maskable(512);
await render(source, 180, 180, join(root, 'public', 'apple-touch-icon.png'));
await render(ogSource, 1200, 630, join(root, 'public', 'og-image.png'));