// Shared bits of markup: critter art, badges, condition paws, the detail sheet.

import { SPECIES_BY_ID, RARITY, STATUS, CONDITION } from './species.js';
import { conditionOf, me, awaitsCheck } from './store.js';
import { isShelter } from './account.js';
import { esc, timeAgo, distanceKm, fmtDistance, directionsUrl } from './ui.js';
import { myPos } from './map.js';

export const spOf = s => SPECIES_BY_ID[s.species] || SPECIES_BY_ID.other;

export function art(s, cls = '') {
  const sp = spOf(s);
  return s.photo
    ? `<div class="art ${cls}"><img src="${esc(s.photo)}" alt="${esc(s.nickname)}" loading="lazy"></div>`
    : `<div class="art art-emoji r-${sp.rarity} ${cls}"><span>${sp.emoji}</span></div>`;
}

export const rarityBadge = sp =>
  `<span class="rarity r-${sp.rarity}">${sp.rarity === 'legend' ? '🌟 ' : ''}${RARITY[sp.rarity].label}</span>`;

export function statusBadge(s) {
  if (awaitsCheck(s)) return `<span class="status st-check">🕓 To confirm</span>`;
  if (s.resolved) return `<span class="status st-resolved">💚 ${s.resolved.outcome === 'adopted' ? 'Adopted' : 'Helped'}</span>`;
  if (s.adoption?.open) return `<span class="status st-adopt">💗 Up for adoption</span>`;
  const st = STATUS[s.status];
  return st ? `<span class="status st-${s.status}">${st.emoji} ${st.short}</span>` : '';
}

export function paws(score, { size = '' } = {}) {
  if (score == null) return `<span class="paws muted ${size}">Not rated yet</span>`;
  const full = Math.round(score);
  const c = CONDITION[full - 1];
  return `<span class="paws ${size}" title="${c.label}">${'🐾'.repeat(full)}<i>${'🐾'.repeat(5 - full)}</i> <b>${c.emoji} ${c.label}</b></span>`;
}

export const distanceTo = s => fmtDistance(distanceKm(myPos, s));

function contactButtons(s) {
  const c = s.adoption?.contact?.trim();
  if (s.demo) return `<p class="muted small">Demo listing, no real contact.</p>`;
  if (!c) return `<p class="muted small">${s.userId === me.id ? 'Add a phone or Zalo so adopters can reach you.' : 'No contact given yet.'}</p>`;
  const digits = c.replace(/[^\d+]/g, '');
  const phoneish = digits.replace('+', '').length >= 8;
  return `<div class="contact">
    <p class="contact-text">📞 ${esc(c)}</p>
    ${phoneish ? `<a class="btn btn-pink" href="tel:${esc(digits)}">Call</a>
      <a class="btn btn-blue" href="https://zalo.me/${esc(digits.replace(/^\+84/, '0'))}" target="_blank" rel="noopener">Zalo</a>` : ''}
  </div>`;
}

/** The full card shown when you tap any critter. Actions use data-act + data-id. */
export function detailHtml(s) {
  const sp = spOf(s);
  const cond = conditionOf(s);
  const myRating = s.ratings?.find(r => r.userId === me.id)?.score;
  const needsHelp = (s.status === 'urgent' || s.status === 'help') && !s.resolved && !s.ownPet;
  // A styled badge, not text, so nobody can fake it by putting ✅ in their name.
  const tick = p => (p?.verified ? ' <span class="vbadge" title="Verified shelter">Verified shelter</span>' : '');
  const dist = distanceTo(s);

  let welfare = '';
  if (sp.welfare && !s.ownPet) {
    welfare = `
      <div class="block">
        <h4>How's ${esc(s.nickname || 'it')} doing now?</h4>
        <div class="rate-row">${[1, 2, 3, 4, 5].map(n =>
          `<button class="rate ${myRating === n ? 'on' : ''}" data-act="rate" data-id="${esc(s.id)}" data-score="${n}">
            ${CONDITION[n - 1].emoji}<small>${CONDITION[n - 1].label}</small></button>`).join('')}
        </div>
        <div class="status-row">${Object.entries(STATUS).map(([k, v]) =>
          `<button class="chip st-${k} ${s.status === k ? 'on' : ''}" data-act="status" data-id="${esc(s.id)}" data-status="${k}">${v.emoji} ${v.short}</button>`).join('')}
        </div>
      </div>`;
  }

  let rescue = '';
  if (needsHelp) {
    const mine = s.helper?.userId === me.id;
    rescue = `<div class="block rescue-block">
      ${s.helper ? `<p class="helper">🙋 <b>${esc(s.helper.name)}</b>${tick(s.helper)} is on it · ${timeAgo(s.helper.at)}</p>` : '<p class="helper">Nobody is on it yet. Could it be you?</p>'}
      <div class="btn-row">
        <a class="btn btn-ghost" href="${directionsUrl(s)}" target="_blank" rel="noopener">📍 Directions</a>
        <button class="btn ${mine ? 'btn-ghost' : 'btn-orange'}" data-act="claim" data-id="${esc(s.id)}">${mine ? '↩️ Not me' : '🙋 I\'m on it'}</button>
        <button class="btn btn-green" data-act="resolve" data-id="${esc(s.id)}">✅ Helped!</button>
      </div>
    </div>`;
  } else if (awaitsCheck(s)) {
    // A player said it's been helped; on a shared board a verified shelter has to confirm it.
    rescue = `<div class="block check-block">
      <p>🕓 <b>${esc(s.resolved.name)}</b> reported this animal as helped · ${timeAgo(s.resolved.at)}</p>
      ${isShelter()
        ? `<p class="small">Can you confirm it? Your ✅ closes the case for everyone.</p>
           <div class="btn-row">
             <a class="btn btn-ghost" href="${directionsUrl(s)}" target="_blank" rel="noopener">📍 Directions</a>
             <button class="btn btn-green" data-act="resolve" data-id="${esc(s.id)}">✅ Confirm helped</button>
           </div>`
        : '<p class="small muted">It stays on the rescue board until a verified shelter confirms. Still in trouble? Set it back to 🚨 or 🩹 below.</p>'}
    </div>`;
  } else if (s.resolved) {
    rescue = `<div class="block resolved-block">💚 ${s.resolved.outcome === 'adopted' ? 'Found a home' : 'Helped'} by <b>${esc(s.resolved.name)}</b>${tick(s.resolved)} · ${timeAgo(s.resolved.at)}</div>`;
  }

  let adoption = '';
  if (s.adoption?.open) {
    const a = s.adoption;
    adoption = `<div class="block adopt-block">
      <h4>💗 Looking for a home</h4>
      <div class="tags">
        ${a.age ? `<span class="tag">🎂 ${esc(a.age)}</span>` : ''}
        <span class="tag ${a.vaccinated ? '' : 'off'}">💉 ${a.vaccinated ? 'Vaccinated' : 'Not vaccinated'}</span>
        <span class="tag ${a.sterilized ? '' : 'off'}">✂️ ${a.sterilized ? 'Sterilized' : 'Not sterilized'}</span>
      </div>
      ${contactButtons(s)}
      ${s.userId === me.id ? `<button class="btn btn-green wide" data-act="adopted" data-id="${esc(s.id)}">🎉 Found a home! Close listing</button>` : ''}
      <p class="muted small">Location blurred to ~300 m for the owner's privacy.</p>
    </div>`;
  }

  const wildTip = sp.wild ? `<div class="block tip">🌿 <b>Wild animal.</b> Don't feed, touch or chase it. Seen one caged or for sale? Call the free ENV wildlife hotline <a href="tel:18001522">1800-1522</a>.</div>` : '';

  return `<article class="detail">
    ${art(s, 'art-hero')}
    <div class="detail-head">
      <div>
        <h2>${esc(s.nickname || sp.name)}</h2>
        <p class="sub">${sp.emoji} ${sp.name} · <i>${sp.vn}</i></p>
      </div>
      ${rarityBadge(sp)}
    </div>
    <div class="meta-row">${statusBadge(s)} ${sp.welfare && !s.ownPet ? paws(cond) : ''}
      ${s.ratings?.length > 1 ? `<span class="muted small">(${s.ratings.length} checks)</span>` : ''}</div>
    ${s.note ? `<p class="note">“${esc(s.note)}”</p>` : ''}
    <p class="byline">${esc(s.userAvatar || '🧢')} Spotted by <b>${esc(s.userId === me.id ? 'you' : s.userName)}</b> · ${timeAgo(s.createdAt)}${dist ? ` · ${dist} away` : ''}${s.demo ? ' · <span class="demo-tag">demo</span>' : ''}</p>
    ${rescue}${adoption}${welfare}${wildTip}
    <p class="fact">💡 ${esc(sp.fact)}</p>
  </article>`;
}
