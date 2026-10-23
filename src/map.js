// The overworld: a Leaflet map of Saigon with every critter as a bubble.

import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { SPECIES_BY_ID } from './species.js';
import { all, me, isOpenCase, awaitsCheck } from './store.js';
import { esc, locate, toast } from './ui.js';

export const HCMC = { lat: 10.7769, lng: 106.7009 };

let map, layer, meMarker, meCircle;
export let myPos = null;

export const FILTERS = {
  all:    { label: '🌏 All',        test: () => true },
  rescue: { label: '🆘 Needs help', test: isOpenCase },
  adopt:  { label: '💗 Adopt me',   test: s => s.adoption?.open },
  rare:   { label: '✨ Rare',       test: s => ['rare', 'legend'].includes(SPECIES_BY_ID[s.species]?.rarity) },
  dog:    { label: '🐕 Dogs',       test: s => s.species === 'dog' },
  cat:    { label: '🐈 Cats',       test: s => s.species === 'cat' },
  mine:   { label: '⭐ Mine',       test: s => s.userId === me.id },
};
export let filter = 'all';

// Some tile servers are unreachable from some networks, so fall back down the list.
const OSM = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const TILES = [
  { url: 'https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png', subdomains: 'abc', attribution: `${OSM}, style HOT / OSM France` },
  { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: OSM },
  { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', attribution: 'Tiles © Esri' },
];

function addTiles(i) {
  const t = TILES[i];
  let loaded = false, errors = 0;
  const tl = L.tileLayer(t.url, { maxZoom: 19, subdomains: t.subdomains || 'abc', attribution: t.attribution });
  tl.on('tileload', () => { loaded = true; });
  tl.on('tileerror', () => {
    if (!loaded && ++errors >= 4 && i + 1 < TILES.length) {
      map.removeLayer(tl);
      addTiles(i + 1);
    }
  });
  tl.addTo(map);
}

export function initMap(el, onSelect) {
  map = L.map(el, { zoomControl: false, attributionControl: true }).setView([HCMC.lat, HCMC.lng], 14);
  addTiles(0);
  layer = L.layerGroup().addTo(map);
  map.on('click', () => el.dispatchEvent(new CustomEvent('mapclick')));
  el.addEventListener('pinclick', e => onSelect(e.detail));
  return map;
}

function pinHtml(s) {
  const sp = SPECIES_BY_ID[s.species] || SPECIES_BY_ID.other;
  const st = awaitsCheck(s) ? 'check' : s.resolved ? 'resolved' : s.adoption?.open ? 'adopt' : s.status || 'none';
  const face = s.photo
    ? `<img src="${esc(s.photo)}" alt="">`
    : `<span class="pin-emoji">${sp.emoji}</span>`;
  const flag = awaitsCheck(s) ? '🕓' : s.resolved ? '💚' : s.adoption?.open ? '💗' : s.status === 'urgent' ? '🚨'
    : s.status === 'help' ? '🩹' : sp.rarity === 'legend' ? '🌟' : '';
  return `<div class="pin r-${sp.rarity} st-${st}">
    <div class="pin-face">${face}</div>
    ${flag ? `<span class="pin-flag">${flag}</span>` : ''}
  </div>`;
}

export function renderPins() {
  if (!layer) return;
  layer.clearLayers();
  const test = FILTERS[filter].test;
  for (const s of all()) {
    if (!test(s)) continue;
    const icon = L.divIcon({ className: 'pin-wrap', html: pinHtml(s), iconSize: [52, 52], iconAnchor: [26, 26] });
    const z = s.status === 'urgent' && !s.resolved ? 1000 : 0;
    L.marker([s.lat, s.lng], { icon, zIndexOffset: z, title: s.nickname || '' })
      .on('click', () => map.getContainer().dispatchEvent(new CustomEvent('pinclick', { detail: s.id })))
      .addTo(layer);
  }
}

export function setFilter(f) {
  filter = f;
  renderPins();
}

export function showMe(pos) {
  myPos = pos;
  const icon = L.divIcon({ className: 'pin-wrap', html: `<div class="me-pin">${esc(me.avatar)}</div>`, iconSize: [44, 44], iconAnchor: [22, 22] });
  if (!meMarker) {
    meMarker = L.marker([pos.lat, pos.lng], { icon, zIndexOffset: 2000, interactive: false }).addTo(map);
    meCircle = L.circle([pos.lat, pos.lng], { radius: Math.min(pos.accuracy || 60, 300), className: 'me-radius' }).addTo(map);
  } else {
    meMarker.setLatLng([pos.lat, pos.lng]).setIcon(icon);
    meCircle.setLatLng([pos.lat, pos.lng]);
  }
}

export async function locateMe(fly = true) {
  const pos = await locate();
  if (!pos) {
    if (fly) toast('📍 Couldn\'t get your location. Showing central Saigon.');
    return null;
  }
  showMe(pos);
  if (fly) map.flyTo([pos.lat, pos.lng], 16, { duration: 0.8 });
  return pos;
}

export const center = () => { const c = map.getCenter(); return { lat: c.lat, lng: c.lng }; };
export const flyTo = (s, z = 17) => map.flyTo([s.lat, s.lng], z, { duration: 0.8 });
export const invalidate = () => map?.invalidateSize();
