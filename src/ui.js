// Small UI helpers: escaping, sheets, toasts, confetti, camera + GPS.

import { Capacitor } from '@capacitor/core';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Geolocation } from '@capacitor/geolocation';

export const isNative = Capacitor.isNativePlatform();

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const $ = (sel, root = document) => root.querySelector(sel);

export function timeAgo(t) {
  const m = Math.round((Date.now() - t) / 60e3);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

export function distanceKm(a, b) {
  if (!a || !b) return null;
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
export function fmtDistance(km) {
  if (km == null) return '';
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(km < 10 ? 1 : 0)} km`;
}

export function toast(html, ms = 2600) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = html;
  $('#toasts').appendChild(el);
  setTimeout(() => el.classList.add('out'), ms);
  setTimeout(() => el.remove(), ms + 400);
}

// ---------- bottom sheets (stackable) ----------

const stack = [];

let panelOpen = false;
/** Pause map animations whenever something covers the map. */
const updateCovered = () => document.body.classList.toggle('covered', panelOpen || stack.length > 0);
export const setPanelOpen = open => { panelOpen = open; updateCovered(); };

export function openSheet(html, { full = false, onClose } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `<div class="sheet-backdrop"></div>
    <div class="sheet ${full ? 'full' : ''}" role="dialog" aria-modal="true">
      <button class="sheet-close" data-close aria-label="Close">✕</button>
      <div class="sheet-body">${html}</div>
    </div>`;
  document.body.appendChild(wrap);
  requestAnimationFrame(() => wrap.classList.add('open'));
  const entry = { wrap, onClose };
  stack.push(entry);
  updateCovered();
  wrap.addEventListener('click', e => {
    if (e.target.classList.contains('sheet-backdrop') || e.target.closest('[data-close]')) closeSheet(entry);
  });
  return { el: wrap.querySelector('.sheet-body'), close: () => closeSheet(entry) };
}

export function closeSheet(entry = stack[stack.length - 1]) {
  if (!entry) return false;
  const i = stack.indexOf(entry);
  if (i < 0) return false;
  stack.splice(i, 1);
  updateCovered();
  entry.wrap.classList.remove('open');
  setTimeout(() => entry.wrap.remove(), 250);
  entry.onClose?.();
  return true;
}
export const closeAllSheets = () => { while (stack.length) closeSheet(); };
export const hasSheet = () => stack.length > 0;

// ---------- confetti ----------

export function confetti(emojis = ['🎉', '✨', '⭐', '🐾', '💛']) {
  const layer = document.createElement('div');
  layer.className = 'confetti';
  for (let i = 0; i < 36; i++) {
    const s = document.createElement('span');
    s.textContent = emojis[i % emojis.length];
    s.style.left = Math.random() * 100 + 'vw';
    s.style.animationDelay = Math.random() * 0.5 + 's';
    s.style.fontSize = 16 + Math.random() * 18 + 'px';
    s.style.setProperty('--drift', (Math.random() * 120 - 60) + 'px');
    layer.appendChild(s);
  }
  document.body.appendChild(layer);
  setTimeout(() => layer.remove(), 3200);
}

// ---------- camera ----------

/** Downscale any image source to a small JPEG data URL so storage stays light. */
export function compress(src, max = 900, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k);
      c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = reject;
    img.src = src;
  });
}

function pickFile(capture) {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    if (capture) input.capture = 'environment';
    input.oncancel = () => resolve(null);
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) return resolve(null);
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.readAsDataURL(f);
    };
    input.click();
  });
}

/** Returns a compressed data URL, or null if the user backed out. */
export async function takePhoto(fromGallery = false) {
  let raw;
  if (isNative) {
    try {
      const p = await Camera.getPhoto({
        resultType: CameraResultType.DataUrl,
        source: fromGallery ? CameraSource.Photos : CameraSource.Camera,
        quality: 80,
        width: 1200,
        correctOrientation: true,
      });
      raw = p.dataUrl;
    } catch (e) {
      // Backing out of the camera is normal; anything else (permissions, no camera app) should be visible.
      if (!/cancel/i.test(e?.message || '')) toast(`📷 Couldn't get a photo: ${esc(e?.message || 'unknown error')}`, 4000);
      return null;
    }
  } else {
    raw = await pickFile(!fromGallery);
  }
  return raw ? compress(raw) : null;
}

// ---------- location ----------

export async function locate() {
  try {
    const p = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 });
    return { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy };
  } catch {
    return null;
  }
}

export function directionsUrl(s) {
  return `https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}`;
}
