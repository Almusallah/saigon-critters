// The catch flow: snap → pick species → quick welfare check → throw a treat → card reveal.

import { SPECIES, SPECIES_BY_ID, RARITY, STATUS, CONDITION, randomName } from './species.js';
import { addSighting, mine, emitChange } from './store.js';
import { reward } from './game.js';
import { openSheet, takePhoto, esc, confetti, locate } from './ui.js';
import { center, showMe } from './map.js';
import { art, rarityBadge } from './cards.js';

/**
 * opts.adoption = true opens straight into "post my pet" mode.
 * opts.photo resumes with a photo already taken (Android restored the app after the camera).
 */
export function startCatch(opts = {}, onDone) {
  const st = {
    step: opts.photo ? 'species' : 'photo',
    photo: opts.photo || null,
    species: null,
    ownPet: !!opts.adoption,
    adoptionOpen: !!opts.adoption,
    status: null,
    condition: null,
    nickname: randomName(),
    note: '',
    age: '', vaccinated: false, sterilized: false, contact: '',
    loc: null, locSource: 'pending',
    filter: '',
  };

  const locText = () => st.locSource === 'gps' ? `📍 Using your GPS (±${Math.round(st.loc.accuracy || 0)} m)`
    : st.locSource === 'map' ? '📍 GPS unavailable, pinned to the map center'
    : '📍 Finding your location…';

  let closed = false;
  const sheet = openSheet('', { full: true, onClose: () => { closed = true; } });
  const el = sheet.el;

  // Start GPS right away so it's ready by the time the user finishes.
  // Only the location line is updated, so a late fix never redraws the form under the user.
  const gps = locate().then(p => {
    if (p) { st.loc = p; st.locSource = 'gps'; showMe(p); }
    else { st.loc = center(); st.locSource = 'map'; }
    const line = el.querySelector('.loc');
    if (st.step === 'details' && line) line.textContent = locText();
  });

  const allowedSpecies = () => opts.adoption ? SPECIES.filter(s => s.welfare) : SPECIES;
  const isOwnPet = () => SPECIES_BY_ID[st.species]?.welfare && st.ownPet;
  const needsContact = () => isOwnPet() && st.adoptionOpen && !st.contact.trim();

  function photoStep() {
    return `<div class="catch catch-photo">
      <p class="step">Step 1 of 3</p>
      <h2>${opts.adoption ? 'Snap your pet 💗' : 'Spotted a critter? 👀'}</h2>
      <p class="muted">${opts.adoption ? 'A clear, happy photo helps them find a home fast.' : 'Take a photo to add it to your deck. Be gentle, keep your distance.'}</p>
      <div class="photo-drop">${st.photo ? `<img src="${st.photo}" alt="">` : '<span>📷</span>'}</div>
      <div class="btn-col">
        <button class="btn btn-yellow big" data-c="camera">📸 ${st.photo ? 'Retake' : 'Take photo'}</button>
        <button class="btn btn-ghost" data-c="gallery">🖼️ Choose from gallery</button>
        ${st.photo ? '<button class="btn btn-green big" data-c="next">Next →</button>' : ''}
      </div>
    </div>`;
  }

  function speciesListHtml() {
    const q = st.filter.toLowerCase();
    const list = allowedSpecies().filter(s => !q || (s.name + ' ' + s.vn).toLowerCase().includes(q));
    const groups = Object.keys(RARITY).map(r => {
      const items = list.filter(s => s.rarity === r);
      if (!items.length) return '';
      return `<h4 class="group r-${r}">${RARITY[r].label} · +${RARITY[r].xp} XP</h4>
        <div class="species-grid">${items.map(s => `
          <button class="species r-${s.rarity} ${st.species === s.id ? 'on' : ''}" data-c="species" data-id="${s.id}">
            <span class="e">${s.emoji}</span><b>${s.name}</b><small>${s.vn}</small>
          </button>`).join('')}</div>`;
    }).join('');
    return groups || '<p class="muted">No match. Try "Mystery Critter" ❓</p>';
  }

  function speciesStep() {
    return `<div class="catch">
      <p class="step">Step 2 of 3</p>
      <h2>What did you find?</h2>
      ${opts.adoption ? '' : `<input class="input" type="search" placeholder="Search… (dog, mèo, gecko)" value="${esc(st.filter)}" data-c="filter">`}
      <div class="species-list">${speciesListHtml()}</div>
    </div>`;
  }

  function detailsStep() {
    const sp = SPECIES_BY_ID[st.species];

    let welfare = '';
    if (sp.welfare) {
      welfare = `
        ${opts.adoption ? '' : `<div class="seg">
          <button class="${!st.ownPet ? 'on' : ''}" data-c="own" data-v="0">🧭 Found it out and about</button>
          <button class="${st.ownPet ? 'on' : ''}" data-c="own" data-v="1">🏡 It's my pet</button>
        </div>`}
        ${st.ownPet ? `
          <label class="toggle"><input type="checkbox" data-c="adopt" ${st.adoptionOpen ? 'checked' : ''}>
            <span>💗 Put up for adoption</span></label>
          ${st.adoptionOpen ? `<div class="adopt-fields">
            <input class="input" placeholder="Age (e.g. 3 months)" value="${esc(st.age)}" data-f="age">
            <label class="check"><input type="checkbox" data-f="vaccinated" ${st.vaccinated ? 'checked' : ''}> 💉 Vaccinated</label>
            <label class="check"><input type="checkbox" data-f="sterilized" ${st.sterilized ? 'checked' : ''}> ✂️ Sterilized</label>
            <input class="input" placeholder="Phone / Zalo for adopters" value="${esc(st.contact)}" data-f="contact" inputmode="tel">
            <p class="muted small">Your location is blurred to ~300 m on the map.</p>
          </div>` : ''}
        ` : `
          <h4>How is it doing? <span class="muted small">(this tells shelters who needs help)</span></h4>
          <div class="status-pick">${Object.entries(STATUS).map(([k, v]) => `
            <button class="status-opt st-${k} ${st.status === k ? 'on' : ''}" data-c="status" data-v="${k}">
              <span>${v.emoji}</span><b>${v.label}</b><small>${v.hint}</small></button>`).join('')}
          </div>
          <h4>Condition score</h4>
          <div class="rate-row">${CONDITION.map(c => `
            <button class="rate ${st.condition === c.score ? 'on' : ''}" data-c="cond" data-v="${c.score}">${c.emoji}<small>${c.label}</small></button>`).join('')}
          </div>`}`;
    } else if (sp.wild) {
      welfare = `<div class="block tip">🌿 Wild animal: don't feed, touch or chase. Seen one caged or for sale? Free ENV hotline <a href="tel:18001522">1800-1522</a>.</div>`;
    }

    const needsStatus = sp.welfare && !st.ownPet && (!st.status || !st.condition);
    const contactMissing = needsContact();
    return `<div class="catch">
      <p class="step">Step 3 of 3</p>
      <div class="mini-head">${st.photo ? `<img src="${st.photo}" alt="">` : ''}<div>
        <h2>${sp.emoji} ${sp.name}</h2>${rarityBadge(sp)}</div></div>
      <label class="lbl">Give it a nickname</label>
      <div class="name-row"><input class="input" value="${esc(st.nickname)}" maxlength="40" data-f="nickname">
        <button class="btn btn-ghost dice" data-c="dice" aria-label="Random name">🎲</button></div>
      ${welfare}
      <label class="lbl">Notes <span class="muted small">(where exactly, what you noticed)</span></label>
      <textarea class="input" rows="2" maxlength="280" placeholder="${sp.welfare && !st.ownPet ? 'e.g. limping, near the phở stall on Lê Lợi' : 'Anything fun or useful?'}" data-f="note">${esc(st.note)}</textarea>
      <p class="muted small loc">${locText()}</p>
      <button class="btn btn-yellow big wide" data-c="throw" ${needsStatus || contactMissing ? 'disabled' : ''}>
        ${isOwnPet() && st.adoptionOpen ? '💗 Post for adoption' : `${sp.treat} Throw a treat!`}</button>
      ${needsStatus ? '<p class="muted small center">Pick a status and condition first. It really helps!</p>' : ''}
      ${isOwnPet() && st.adoptionOpen ? `<p class="muted small center contact-hint" ${contactMissing ? '' : 'hidden'}>Add a phone or Zalo so adopters can reach you.</p>` : ''}
    </div>`;
  }

  function render() {
    const html = st.step === 'photo' ? photoStep() : st.step === 'species' ? speciesStep() : detailsStep();
    el.innerHTML = (st.step !== 'photo' ? '<button class="back" data-c="back">← Back</button>' : '') + html;
  }

  async function doThrow() {
    if (st.step !== 'details') return;
    st.step = 'throwing';
    const sp = SPECIES_BY_ID[st.species];
    const own = isOwnPet();
    if (st.locSource === 'pending') {
      const line = el.querySelector('.loc');
      if (line) line.textContent = '📍 Waiting for GPS…';
      el.inert = true; // nothing in the form can change while we wait
      await gps;
      el.inert = false;
      if (closed) return; // user backed out: don't save anything
    }
    const first = !mine().some(s => s.species === sp.id);
    let loc = st.loc || center();
    // Blur pet-owner locations so homes aren't pinpointed.
    if (own) loc = { lat: loc.lat + (Math.random() - 0.5) * 0.005, lng: loc.lng + (Math.random() - 0.5) * 0.005 };

    const s = await addSighting({
      species: sp.id,
      photo: st.photo,
      nickname: st.nickname.trim() || randomName(),
      note: st.note.trim(),
      lat: loc.lat, lng: loc.lng,
      ownPet: !!own,
      status: sp.welfare ? (own ? 'owned' : st.status) : null,
      condition: sp.welfare && !own ? st.condition : (own ? 5 : null),
      adoption: own && st.adoptionOpen
        ? { open: true, age: st.age.trim(), vaccinated: st.vaccinated, sterilized: st.sterilized, contact: st.contact.trim() }
        : null,
    });
    const r = reward('catch', {
      species: sp.id,
      firstOfSpecies: first,
      reported: sp.welfare && !own,
      adoption: !!s.adoption,
    });
    emitChange(); // refresh the XP bar behind the sheet

    // Throw animation, then reveal.
    el.innerHTML = `<div class="throw-stage">
      <div class="target r-${sp.rarity}">${st.photo ? `<img src="${st.photo}" alt="">` : `<span>${sp.emoji}</span>`}</div>
      <div class="treat">${sp.treat}</div>
      <p class="throw-text">Throwing a treat…</p>
    </div>`;
    setTimeout(() => { const t = el.querySelector('.throw-text'); if (t) t.textContent = '…wiggle… wiggle…'; }, 900);
    setTimeout(() => reveal(s, sp, r, first), 2300);
  }

  function reveal(s, sp, r, first) {
    confetti(sp.rarity === 'legend' ? ['🌟', '✨', '👑', sp.emoji] : ['🎉', '✨', sp.emoji, '🐾']);
    el.innerHTML = `<div class="reveal">
      <h2 class="gotcha">${s.adoption ? 'Posted! 💗' : 'Gotcha!'}</h2>
      ${first ? '<p class="new-species">✨ NEW SPECIES ✨</p>' : ''}
      <div class="trade-card r-${sp.rarity}">
        ${art(s, 'art-card')}
        <div class="tc-body">
          <h3>${esc(s.nickname)}</h3>
          <p>${sp.emoji} ${sp.name} · <i>${sp.vn}</i></p>
          ${rarityBadge(sp)}
        </div>
      </div>
      <ul class="gains">${r.gains.map(g => `<li><span>${esc(g.label)}</span><b>+${g.xp} XP</b></li>`).join('')}</ul>
      ${r.levelUp ? `<p class="levelup">⬆️ Level up! You're now level ${r.levelUp}</p>` : ''}
      ${r.badges.map(b => `<p class="badge-earned">${b.emoji} Badge unlocked: <b>${b.name}</b></p>`).join('')}
      ${s.status === 'urgent' || s.status === 'help' ? '<p class="thanks">🙏 Thank you! It\'s now on the rescue board for shelters and volunteers.</p>' : ''}
      <div class="btn-col">
        <button class="btn btn-yellow big" data-c="again">📸 Spot another</button>
        <button class="btn btn-ghost" data-c="done">See it on the map</button>
      </div>
    </div>`;
    st.step = 'done';
    st.result = s;
  }

  el.addEventListener('click', async e => {
    const b = e.target.closest('[data-c]');
    if (!b) return;
    const c = b.dataset.c;
    if (st.step === 'throwing') return;
    if (c === 'camera' || c === 'gallery') {
      const p = await takePhoto(c === 'gallery');
      if (p) { st.photo = p; st.step = 'species'; }
      render();
    } else if (c === 'next') { st.step = 'species'; render(); }
    else if (c === 'back') { st.step = st.step === 'details' ? 'species' : 'photo'; render(); }
    else if (c === 'species') {
      st.species = b.dataset.id;
      // Only dogs & cats can be "my pet" / up for adoption.
      if (!SPECIES_BY_ID[st.species].welfare) { st.ownPet = false; st.adoptionOpen = false; }
      st.step = 'details';
      render();
    }
    else if (c === 'own') { st.ownPet = b.dataset.v === '1'; render(); }
    else if (c === 'status') { st.status = b.dataset.v; render(); }
    else if (c === 'cond') { st.condition = +b.dataset.v; render(); }
    else if (c === 'dice') { st.nickname = randomName(); render(); }
    else if (c === 'throw') { b.disabled = true; if (!needsContact()) doThrow(); }
    else if (c === 'again') { sheet.close(); startCatch({ ...opts, photo: null }, onDone); }
    else if (c === 'done') { sheet.close(); onDone?.(st.result); }
  });

  el.addEventListener('change', e => {
    if (e.target.dataset.c === 'adopt') { st.adoptionOpen = e.target.checked; render(); }
  });

  // Search only refreshes the list, never the input, so Vietnamese IME composition isn't interrupted.
  const refreshList = () => { const list = el.querySelector('.species-list'); if (list) list.innerHTML = speciesListHtml(); };

  el.addEventListener('input', e => {
    const f = e.target.dataset.f;
    if (f) st[f] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    if (f === 'contact') {
      const missing = needsContact();
      const btn = el.querySelector('[data-c="throw"]');
      if (btn) btn.disabled = missing;
      const hint = el.querySelector('.contact-hint');
      if (hint) hint.hidden = !missing;
    }
    if (e.target.dataset.c === 'filter') {
      // Refreshing the list never touches the input, so it's safe mid-composition (Gboard composes every word).
      st.filter = e.target.value;
      refreshList();
    }
  });
  el.addEventListener('compositionend', e => {
    if (e.target.dataset.c === 'filter') { st.filter = e.target.value; refreshList(); }
  });

  render();
}
