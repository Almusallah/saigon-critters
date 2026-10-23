// Full-screen panels: Deck, Rescue board, Adoption, Profile, plus quests + onboarding.

import { SPECIES, RARITY } from './species.js';
import { me, settings, mine, all, rescueList, adoptionList, conditionOf, syncState, awaitsCheck, isClosed } from './store.js';
import { auth, signedIn, isShelter } from './account.js';
import { levelProgress, BADGES, quests } from './game.js';
import { esc, timeAgo, distanceKm } from './ui.js';
import { myPos } from './map.js';
import { art, rarityBadge, statusBadge, paws, distanceTo, spOf } from './cards.js';

export const ui = { rescueFilter: 'all', rescueSort: 'urgency', adoptFilter: 'all' };

const AVATARS = ['🧢', '🦊', '🐯', '🐼', '🐰', '🐸', '🦁', '🐵', '🐨', '🦄', '🐙', '🦖'];

const head = (title, sub) => `<header class="panel-head"><h1>${title}</h1>${sub ? `<p>${sub}</p>` : ''}</header>`;

// ---------- Deck ----------

export function deckView() {
  const my = mine();
  const bySpecies = {};
  for (const s of my) (bySpecies[s.species] ||= []).push(s);
  const found = SPECIES.filter(s => bySpecies[s.id]).length;
  const pct = Math.round((found / SPECIES.length) * 100);

  const groups = Object.keys(RARITY).map(r => `
    <h3 class="group r-${r}">${RARITY[r].label}</h3>
    <div class="dex-grid">${SPECIES.filter(s => s.rarity === r).map(sp => {
      const cards = bySpecies[sp.id];
      if (!cards) return `<button class="dex-tile locked" data-act="dex-locked" data-sp="${sp.id}">
        <span class="e">${sp.emoji}</span><b>???</b></button>`;
      const latest = cards[cards.length - 1];
      return `<button class="dex-tile r-${sp.rarity}" data-act="dex" data-sp="${sp.id}">
        ${latest.photo ? `<img src="${esc(latest.photo)}" alt="">` : `<span class="e">${sp.emoji}</span>`}
        <b>${sp.name}</b><span class="count">×${cards.length}</span></button>`;
    }).join('')}</div>`).join('');

  return head('My Critter-Dex 📒', `${found} / ${SPECIES.length} species · ${my.length} cards`) + `
    <div class="progress"><div style="width:${pct}%"></div></div>
    ${my.length ? '' : `<div class="empty">
      <p class="big-emoji">📸</p><p><b>Your deck is empty!</b></p>
      <p class="muted">Tap the yellow camera button and snap your first Saigon critter.</p></div>`}
    ${groups}`;
}

export function speciesCardsHtml(spId) {
  const sp = SPECIES.find(s => s.id === spId);
  const cards = mine().filter(s => s.species === spId).sort((a, b) => b.createdAt - a.createdAt);
  return `<h2>${sp.emoji} ${sp.name} <small class="muted">${sp.vn}</small></h2>
    ${rarityBadge(sp)}
    <p class="fact">💡 ${esc(sp.fact)}</p>
    <div class="card-grid">${cards.map(s => `
      <button class="mini-card r-${sp.rarity}" data-act="open" data-id="${esc(s.id)}">
        ${art(s)}<b>${esc(s.nickname)}</b><small>${timeAgo(s.createdAt)}</small></button>`).join('')}
    </div>`;
}

// ---------- Rescue board ----------

export function rescueView() {
  let list = rescueList();
  const open = list.filter(s => !awaitsCheck(s));
  const urgent = open.filter(s => s.status === 'urgent').length;
  const toCheck = list.length - open.length;
  if (ui.rescueFilter === 'check' && !toCheck) ui.rescueFilter = 'all';
  const helped = all().filter(s => isClosed(s) && s.resolved.outcome !== 'adopted' && !(s.demo && settings.serverUrl)).length;
  if (ui.rescueFilter === 'urgent') list = open.filter(s => s.status === 'urgent');
  if (ui.rescueFilter === 'check') list = list.filter(awaitsCheck);
  if (ui.rescueFilter === 'dog' || ui.rescueFilter === 'cat') list = list.filter(s => s.species === ui.rescueFilter);
  if (ui.rescueSort === 'near' && myPos) list = [...list].sort((a, b) => distanceKm(myPos, a) - distanceKm(myPos, b));

  const chip = (k, label, key = 'rescueFilter') =>
    `<button class="chip ${ui[key] === k ? 'on' : ''}" data-act="ui" data-key="${key}" data-val="${k}">${label}</button>`;

  return head('Rescue Board 🆘', isShelter()
      ? `🏥 ${esc(auth.user.shelter.name)}: your ✅ Helped closes a case for everyone.`
      : 'Dogs & cats that need a hand. Shelters and volunteers, start here.') + `
    <div class="stats3">
      <div class="stat red"><b>${urgent}</b><span>🚨 urgent</span></div>
      <div class="stat orange"><b>${open.length - urgent}</b><span>🩹 need help</span></div>
      <div class="stat green"><b>${helped}</b><span>💚 helped</span></div>
    </div>
    <div class="chips-row">
      ${chip('all', 'All')}${chip('urgent', '🚨 Urgent')}${toCheck ? chip('check', `🕓 To confirm (${toCheck})`) : ''}${chip('dog', '🐕 Dogs')}${chip('cat', '🐈 Cats')}
      <span class="spacer"></span>
      ${chip('urgency', '⚡ Urgency', 'rescueSort')}${chip('near', '📍 Nearest', 'rescueSort')}
    </div>
    <div class="rescue-list">${list.length ? list.map(s => {
      const sp = spOf(s);
      const d = distanceTo(s);
      return `<article class="rescue-card st-${awaitsCheck(s) ? 'check' : esc(s.status)}" data-act="open" data-id="${esc(s.id)}">
        ${art(s, 'art-thumb')}
        <div class="rc-body">
          <div class="rc-top"><b>${esc(s.nickname)}</b> ${statusBadge(s)}${s.demo ? ' <span class="demo-tag">demo</span>' : ''}</div>
          <p class="small">${sp.emoji} ${sp.name} · ${timeAgo(s.createdAt)}${d ? ` · 📍 ${d}` : ''}</p>
          ${paws(conditionOf(s), { size: 'small' })}
          ${s.note ? `<p class="rc-note">“${esc(s.note)}”</p>` : ''}
          ${awaitsCheck(s) ? `<p class="helper small">🕓 ${esc(s.resolved.name)} says it's been helped. Waiting for a shelter to confirm.</p>`
            : s.helper ? `<p class="helper small">🙋 ${esc(s.helper.name)}${s.helper.verified ? ' <span class="vbadge">Shelter</span>' : ''} is on it</p>` : ''}
        </div>
      </article>`;
    }).join('') : `<div class="empty"><p class="big-emoji">🎉</p><p><b>Nobody needs help here right now.</b></p>
      <p class="muted">Spot a dog or cat in trouble? Snap it and mark it 🚨 or 🩹.</p></div>`}
    </div>
    <details class="guide">
      <summary>🧡 How to help safely</summary>
      <ul>
        <li>Approach slowly and sideways. Scared or injured animals can bite.</li>
        <li>Offer water first, then plain food (rice + boiled chicken, no bones, no spicy food).</li>
        <li>For injuries, call a local vet or a rescue group (e.g. ARC Pet Rescue, Laws For Paws). Check their latest contacts on social media.</li>
        <li>Tap 🙋 <b>I'm on it</b> so others know someone is coming, then ✅ <b>Helped</b> when done. A verified shelter confirms it and the case closes.</li>
        <li>Wildlife caged or for sale? Free ENV hotline <a href="tel:18001522">1800-1522</a>.</li>
      </ul>
    </details>`;
}

// ---------- Adoption ----------

export function adoptView() {
  let list = adoptionList();
  if (ui.adoptFilter !== 'all') list = list.filter(s => s.species === ui.adoptFilter);
  const chip = (k, label) => `<button class="chip ${ui.adoptFilter === k ? 'on' : ''}" data-act="ui" data-key="adoptFilter" data-val="${k}">${label}</button>`;
  return head('Adopt Me 💗', 'Pets from the community looking for a new home.') + `
    <button class="btn btn-pink big wide" data-act="post-adoption">📸 Post my pet for adoption</button>
    <div class="chips-row">${chip('all', 'All')}${chip('cat', '🐈 Cats')}${chip('dog', '🐕 Dogs')}</div>
    <div class="adopt-grid">${list.length ? list.map(s => {
      const sp = spOf(s);
      const a = s.adoption;
      return `<article class="adopt-card" data-act="open" data-id="${esc(s.id)}">
        ${art(s, 'art-adopt')}
        <div class="ac-body">
          <b>${esc(s.nickname)}</b>
          <p class="small">${sp.emoji} ${sp.name}${a.age ? ` · ${esc(a.age)}` : ''}</p>
          <p class="small">${a.vaccinated ? '💉' : ''}${a.sterilized ? '✂️' : ''} ${distanceTo(s) ? '📍 ' + distanceTo(s) : ''}</p>
        </div>
      </article>`;
    }).join('') : `<div class="empty"><p class="big-emoji">🏡</p><p><b>No pets listed right now.</b></p></div>`}
    </div>`;
}

// ---------- Profile ----------

export function questsHtml() {
  return `<div class="quests">${quests().map(q => `
    <div class="quest ${q.done ? 'done' : ''}">
      <span class="qe">${q.done ? '✅' : q.emoji}</span>
      <div><b>${q.text}</b><div class="progress small"><div style="width:${(q.progress / q.goal) * 100}%"></div></div></div>
      <span class="qn">${q.progress}/${q.goal}</span>
    </div>`).join('')}</div>`;
}

export function profileView() {
  const p = levelProgress();
  const species = new Set(mine().map(s => s.species)).size;
  const sync = settings.serverUrl
    ? syncState.ok === true ? `🟢 Synced ${timeAgo(syncState.at)}`
      : syncState.ok === false ? `🔴 ${esc(syncState.error || 'Offline')}` : '⏳ Connecting…'
    : '📱 Offline mode: data stays on this phone';
  return head('Trainer Profile', '') + `
    <section class="trainer-card">
      <div class="avatar-big">${esc(me.avatar)}</div>
      <input class="input name-input" value="${esc(me.name)}" placeholder="Your trainer name" maxlength="24" data-me="name">
      <p class="title">Lv ${p.lvl} · ${p.title}</p>
      ${signedIn() ? `<p class="muted small">@${esc(auth.user.username)}${isShelter() ? ` · ✅ ${esc(auth.user.shelter.name)}` : ''}</p>` : ''}
      <div class="progress xp"><div style="width:${Math.round(p.pct * 100)}%"></div></div>
      <p class="muted small">${Number(me.xp) || 0} XP · ${p.toNext} XP to level ${p.lvl + 1}</p>
      <div class="avatar-pick">${AVATARS.map(a => `<button class="${a === me.avatar ? 'on' : ''}" data-act="avatar" data-val="${a}">${a}</button>`).join('')}</div>
    </section>
    <div class="stats4">
      <div class="stat"><b>${mine().length}</b><span>cards</span></div>
      <div class="stat"><b>${species}</b><span>species</span></div>
      <div class="stat"><b>${Number(me.stats.rated) || 0}</b><span>checks</span></div>
      <div class="stat"><b>${(Number(me.stats.rescued) || 0) + (Number(me.stats.helped) || 0)}</b><span>helps</span></div>
    </div>
    <h3>📜 Daily quests</h3>
    ${questsHtml()}
    <h3>🏅 Badges</h3>
    <div class="badges">${BADGES.map(b => `<div class="badge ${me.badges.includes(b.id) ? 'on' : ''}" title="${esc(b.desc)}">
      <span>${b.emoji}</span><b>${b.name}</b><small>${b.desc}</small></div>`).join('')}</div>
    <h3>☁️ Account</h3>
    ${accountHtml()}
    <h3>🏥 Shelters & rescue groups</h3>
    ${shelterHtml()}
    <h3>⚙️ Settings</h3>
    <div class="settings">
      <label class="lbl">Community server <span class="muted small">(shared map for shelters)</span></label>
      <div class="name-row"><input class="input" placeholder="https://your-server.example" value="${esc(settings.serverUrl)}" data-set="serverUrl" inputmode="url">
        <button class="btn btn-blue" data-act="save-server">Save</button></div>
      <p class="small">${sync} ${settings.serverUrl ? '<button class="linkish" data-act="sync">Sync now</button>' : ''}</p>
      <label class="toggle"><input type="checkbox" data-act="toggle-demo" ${settings.showDemo ? 'checked' : ''}><span>Show demo critters</span></label>
      <div class="btn-row">
        <button class="btn btn-ghost" data-act="restore-demo">↺ Restore demo</button>
        <button class="btn btn-ghost danger" data-act="reset">🗑️ Reset my data</button>
      </div>
    </div>
    <p class="about">Saigon Critters v1.0 · Spot 'em all. Help 'em all. 🐾</p>`;
}

function accountHtml() {
  if (!settings.serverUrl) {
    return `<div class="settings"><p>Accounts save your progress online so you can switch phones without losing anything.
      Connect to a community server in Settings below to create one.</p></div>`;
  }
  if (!signedIn()) {
    return `<div class="settings">
      <p>Right now your deck and XP live only on this phone. <b>Create an account</b> to back them up and keep playing on any phone.</p>
      <div class="btn-row">
        <button class="btn btn-yellow" data-act="auth" data-mode="register">✨ Create account</button>
        <button class="btn btn-ghost" data-act="auth" data-mode="login">Sign in</button>
      </div></div>`;
  }
  const at = me.syncedAt ? timeAgo(me.syncedAt) : 'not yet';
  return `<div class="settings">
    <p>Signed in as <b>@${esc(auth.user.username)}</b>. Progress saved ${at}.</p>
    <p class="muted small">New phone? Install the app, connect to the same server and sign in: your deck, XP and badges come back.</p>
    <div class="btn-row"><button class="btn btn-ghost" data-act="logout">Sign out</button></div></div>`;
}

function shelterHtml() {
  const s = auth.user?.shelter;
  if (!signedIn()) {
    return `<div class="settings"><p>Run a shelter or rescue group? Verified shelters get a ✅ badge, and their <b>Helped</b> closes cases on the rescue board.
      ${settings.serverUrl ? 'Create an account first, then apply here.' : ''}</p></div>`;
  }
  if (s?.status === 'approved') {
    return `<div class="settings"><p>✅ <b>${esc(s.name)}</b> is a verified shelter. Your <b>Helped</b> closes cases for everyone, and you can confirm reports from players.</p></div>`;
  }
  if (s?.status === 'pending') {
    return `<div class="settings"><p>🕓 Application for <b>${esc(s.name)}</b> sent ${timeAgo(s.appliedAt)}. An admin will check it and approve it soon.</p>
      <div class="btn-row"><button class="btn btn-ghost" data-act="shelter-apply">Edit application</button></div></div>`;
  }
  return `<div class="settings">
    ${s?.status === 'rejected' || s?.status === 'revoked' ? `<p class="muted">Your last application (${esc(s.name)}) was not approved. You can apply again with more details.</p>` : ''}
    <p>Run a shelter or rescue group? Apply for a verified account so your <b>Helped</b> closes cases on the rescue board.</p>
    <div class="btn-row"><button class="btn btn-pink" data-act="shelter-apply">🏥 Apply as a shelter</button></div></div>`;
}

// ---------- Account sheets ----------

export function authHtml(mode) {
  const title = { register: '✨ Create account', login: '👋 Welcome back', recover: '🔑 Recover account' }[mode];
  const intro = {
    register: 'Back up your deck, XP and badges, and play on any phone.',
    login: 'Sign in to bring your deck, XP and badges to this phone.',
    recover: 'Use the recovery code you saved when you signed up to set a new password.',
  }[mode];
  return `<form class="auth" data-auth="${mode}" novalidate>
    <h2>${title}</h2>
    <p class="muted">${intro}</p>
    <label class="lbl">Username</label>
    <input class="input" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="20" required>
    ${mode === 'recover' ? `<label class="lbl">Recovery code</label>
      <input class="input mono" name="code" placeholder="XXXX-XXXX-XXXX-XXXX" autocapitalize="characters" spellcheck="false" required>` : ''}
    <label class="lbl">${mode === 'login' ? 'Password' : 'New password'}</label>
    <input class="input" name="password" type="password" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}" minlength="6" required>
    ${mode !== 'login' ? `<label class="lbl">Repeat password</label>
      <input class="input" name="password2" type="password" autocomplete="new-password" minlength="6" required>` : ''}
    ${mode === 'register' ? '<p class="muted small">3–20 letters, numbers, _ or . · password at least 6 characters.</p>' : ''}
    <p class="form-error" role="alert"></p>
    <button class="btn btn-yellow big wide" type="submit">${{ register: 'Create account', login: 'Sign in', recover: 'Set new password' }[mode]}</button>
    <p class="auth-links small">
      ${mode !== 'login' ? '<button type="button" class="linkish" data-auth-mode="login">I already have an account</button>' : '<button type="button" class="linkish" data-auth-mode="register">Create an account</button>'}
      ${mode !== 'recover' ? ' · <button type="button" class="linkish" data-auth-mode="recover">Forgot password?</button>' : ''}
    </p>
  </form>`;
}

export function recoveryCodeHtml(code, fresh) {
  return `<div class="recovery">
    <h2>${fresh ? '🎉 Account created!' : '🔑 Password changed'}</h2>
    <p>This is your <b>recovery code</b>. If you forget your password, it's the only way back into your account.</p>
    <div class="code-box">${esc(code)}</div>
    <p class="muted small">Write it down or take a screenshot. You won't see it again.</p>
    <div class="btn-col">
      <button class="btn btn-ghost" data-copy="${esc(code)}">📋 Copy code</button>
      <button class="btn btn-yellow big" data-close>I saved it ✅</button>
    </div>
  </div>`;
}

export function shelterFormHtml() {
  const s = auth.user?.shelter || {};
  const v = k => esc(s[k] || '');
  return `<form class="auth" data-shelter-form novalidate>
    <h2>🏥 Apply as a shelter</h2>
    <p class="muted">An admin checks every application (usually by calling you) before your account gets the ✅ badge.</p>
    <label class="lbl">Shelter or group name *</label>
    <input class="input" name="name" maxlength="60" value="${v('name')}" required>
    <label class="lbl">Phone / Zalo *</label>
    <input class="input" name="phone" maxlength="30" inputmode="tel" value="${v('phone')}" required>
    <label class="lbl">Area <span class="muted small">(e.g. District 7, Thủ Đức)</span></label>
    <input class="input" name="area" maxlength="60" value="${v('area')}">
    <label class="lbl">Facebook page or website</label>
    <input class="input" name="link" maxlength="200" inputmode="url" value="${v('link')}">
    <label class="lbl">Anything else? <span class="muted small">(how many animals, since when)</span></label>
    <textarea class="input" name="note" rows="3" maxlength="400">${v('note')}</textarea>
    <p class="form-error" role="alert"></p>
    <button class="btn btn-pink big wide" type="submit">Send application</button>
  </form>`;
}

// ---------- Onboarding ----------

export function onboardingHtml() {
  return `<div class="onboard">
    <div class="ob-hero">🐕🐈🐓🦎🐒</div>
    <h1>Saigon Critters</h1>
    <p class="tagline">Spot 'em all. Help 'em all.</p>
    <ol class="ob-steps">
      <li><span>📸</span><div><b>Snap animals around the city</b><br>Every photo becomes a card in your deck. Monkeys and otters are super rare!</div></li>
      <li><span>🩹</span><div><b>Score how dogs & cats are doing</b><br>Shelters see who's urgent, who needs help, and who's doing fine.</div></li>
      <li><span>💗</span><div><b>Find a home for a pet</b><br>Post your cat or dog for adoption, or browse the ones looking for a family.</div></li>
    </ol>
    <label class="lbl">Pick your trainer name</label>
    <input class="input" placeholder="e.g. Hẻm Hunter" maxlength="24" data-ob="name">
    <div class="avatar-pick">${AVATARS.map((a, i) => `<button class="${i === 0 ? 'on' : ''}" data-ob-avatar="${a}">${a}</button>`).join('')}</div>
    <button class="btn btn-yellow big wide" data-ob="go">Let's go! 🛵</button>
    ${settings.serverUrl ? '<p class="small center"><button class="linkish" data-ob="signin">Already playing on another phone? Sign in</button></p>' : ''}
  </div>`;
}
