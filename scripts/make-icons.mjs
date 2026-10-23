// Generates the PWA icons and (if android/ exists) Android launcher icons + splash screens
// from one vector design: a coral map pin with a paw, on mango yellow.
import sharp from 'sharp';
import { existsSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const YELLOW = '#FFC93C', CREAM = '#FFF8E7', INK = '#1D2B53', CORAL = '#FF6B4A';

const pin = `
  <path d="M512 880 C 400 720, 252 610, 252 430 A 260 260 0 1 1 772 430 C 772 610, 624 720, 512 880 Z"
        fill="${CORAL}" stroke="${INK}" stroke-width="34" stroke-linejoin="round"/>
  <circle cx="512" cy="430" r="170" fill="#fff" stroke="${INK}" stroke-width="26"/>
  <g fill="${INK}">
    <ellipse cx="512" cy="475" rx="62" ry="52"/>
    <ellipse cx="434" cy="398" rx="27" ry="34" transform="rotate(-20 434 398)"/>
    <ellipse cx="482" cy="355" rx="27" ry="35"/>
    <ellipse cx="542" cy="355" rx="27" ry="35"/>
    <ellipse cx="590" cy="398" rx="27" ry="34" transform="rotate(20 590 398)"/>
  </g>
  <circle cx="640" cy="250" r="22" fill="#fff" opacity=".8"/>`;

const svg = ({ bg, scale = 1, round = false }) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  ${bg ? (round ? `<circle cx="512" cy="512" r="512" fill="${bg}"/>` : `<rect width="1024" height="1024" fill="${bg}"/>`) : ''}
  <g transform="translate(512 512) scale(${scale}) translate(-512 -512)">${pin}</g>
</svg>`;

const png = (s, size) => sharp(Buffer.from(s)).resize(size, size).png().toBuffer();

async function write(path, buf) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, buf);
}

// PWA
await write(join(root, 'public/icon-192.png'), await png(svg({ bg: YELLOW, scale: 0.86 }), 192));
await write(join(root, 'public/icon-512.png'), await png(svg({ bg: YELLOW, scale: 0.72 }), 512));
await write(join(root, 'resources/icon.png'), await png(svg({ bg: YELLOW, scale: 0.86 }), 1024));
console.log('PWA icons written');

// Android
const res = join(root, 'android/app/src/main/res');
if (existsSync(res)) {
  const dens = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
  for (const [d, k] of Object.entries(dens)) {
    const dir = join(res, `mipmap-${d}`);
    await write(join(dir, 'ic_launcher.png'), await png(svg({ bg: YELLOW, scale: 0.86 }), 48 * k));
    await write(join(dir, 'ic_launcher_round.png'), await png(svg({ bg: YELLOW, scale: 0.8, round: true }), 48 * k));
    // Adaptive foreground: keep the pin inside the 66% safe zone.
    await write(join(dir, 'ic_launcher_foreground.png'), await png(svg({ scale: 0.6 }), 108 * k));
  }
  const bgXml = join(res, 'values/ic_launcher_background.xml');
  writeFileSync(bgXml, `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${YELLOW}</color>\n</resources>\n`);

  // Replace every splash.png with a cream screen + centered pin, keeping each file's size.
  const walk = dir => readdirSync(dir).flatMap(f => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : f === 'splash.png' ? [p] : [];
  });
  for (const p of walk(res)) {
    const { width, height } = await sharp(p).metadata();
    const side = Math.round(Math.min(width, height) * 0.38);
    const icon = await png(svg({ scale: 1 }), side);
    const out = await sharp({ create: { width, height, channels: 4, background: CREAM } })
      .composite([{ input: icon, gravity: 'center' }]).png().toBuffer();
    await write(p, out);
  }
  console.log('Android icons + splash written');
}
