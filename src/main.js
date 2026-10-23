import '@fontsource/baloo-2/600.css';
import '@fontsource/baloo-2/800.css';
import '@fontsource/nunito/400.css';
import '@fontsource/nunito/700.css';
import './styles.css';

import { App } from '@capacitor/app';
import * as store from './store.js';
import { me, settings } from './store.js';
import { reward, levelProgress } from './game.js';
import { SPECIES_BY_ID } from './species.js';
import { initMap, renderPins, setFilter, FILTERS, filter, locateMe, flyTo, invalidate, HCMC } from './map.js';
import { startCatch } from './catch.js';
import { detailHtml } from './cards.js';
import { deckView, speciesCardsHtml, rescueView, adoptView, profileView, questsHtml, onboardingHtml, ui,
  authHtml, recoveryCodeHtml, shelterFormHtml } from './views.js';
import * as account from './account.js';
import { $, esc, openSheet, closeSheet, hasSheet, toast, confetti, isNative, compress, setPanelOpen } from './ui.js';

let tab = 'map';
let detail = null; // { id, sheet }

const PANELS = { deck: deckView, rescue: rescueView, adopt: adoptView, profile: profileView };

// ---------- shell ----------

function renderTopbar() {
  const p = levelProgress();
  $('#trainer').innerHTML = `<span class="tav">${esc(me.avatar)}</span>
    <span class="tinfo"><b>${esc(me.name || 'Trainer')}</b><small>Lv ${p.lvl} · ${p.title}</small>
    <span class="tbar"><i style="width:${Math.round(p.pct * 100)}%"></i></span></span>`;
  const n = store.rescueList().filter(s => s.status === 'urgent' && !s.demo && !store.awaitsCheck(s)).length;
  const badge = $('#rescueBadge');
  badge.textContent = n;
  badge.hidden = !n;
}

function renderChips() {
  $('#mapChips').innerHTML = Object.entries(FILTERS).map(([k, f]) =>
    `<button class="chip ${filter === k ? 'on' : ''}" data-act="filter" data-val="${k}">${f.label}</button>`).join('');
}

function renderPanel() {
  const panel = $('#panel');
  setPanelOpen(tab !== 'map');
  if (tab === 'map') { panel.hidden = true; invalidate(); }
  else {
    const scroll = panel.dataset.view === tab ? panel.scrollTop : 0;
    panel.hidden = false;
    panel.dataset.view = tab;
    panel.innerHTML = PANELS[tab]();
    panel.scrollTop = scroll;
  }
  document.querySelectorAll('.tabbar [data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
}

function renderAll() {
  renderTopbar();
  renderPins();
  // Don't clobber a text field the user is typing in.
  const ae = document.activeElement;
  const typing = $('#panel').contains(ae) && ae.matches('textarea, input:not([type=checkbox]):not([type=radio])');
  if (tab !== 'map' && !typing) renderPanel();
  if (detail) {
    const s = store.byId(detail.id);
    if (s) detail.sheet.el.innerHTML = detailHtml(s);
  }
}

function go(t) {
  tab = t;
  if (t === 'rescue') celebrate(reward('visitRescue'));
  renderPanel();
}

function celebrate(r) {
  if (!r.total) return;
  toast(`<b>+${r.total} XP</b> ${esc(r.gains.map(g => g.label).join(' · '))}`);
  if (r.levelUp) { confetti(); toast(`⬆️ <b>Level ${r.levelUp}!</b> ${esc(levelProgress().title)}`, 3500); }
  r.badges.forEach(b => toast(`${b.emoji} Badge unlocked: <b>${esc(b.name)}</b>`, 3500));
  renderTopbar();
}

function openDetail(id) {
  const s = store.byId(id);
  if (!s) return;
  if (detail) detail.sheet.close();
  const sheet = openSheet(detailHtml(s), { onClose: () => { if (detail?.id === id) detail = null; } });
  detail = { id, sheet };
}

// ---------- actions (event delegation) ----------

/** True the first time this player earns `kind` XP for this sighting (no farming by toggling). */
function firstTime(kind, id) {
  me.rewarded ||= {};
  const key = `${kind}:${id}`;
  if (me.rewarded[key]) return false;
  me.rewarded[key] = 1;
  store.saveMe();
  return true;
}

async function act(el) {
  const a = el.dataset.act, id = el.dataset.id;
  switch (a) {
    case 'filter': setFilter(el.dataset.val); renderChips(); break;
    case 'open': openDetail(id); break;
    case 'dex': openSheet(speciesCardsHtml(el.dataset.sp)); break;
    case 'dex-locked': {
      const sp = SPECIES_BY_ID[el.dataset.sp];
      toast(`${sp.emoji} Not spotted yet! Hint: ${esc(sp.fact)}`, 3500);
      break;
    }
    case 'ui': ui[el.dataset.key] = el.dataset.val; renderPanel(); break;
    case 'rate': {
      const s = store.byId(id);
      if (!s) break;
      await store.rate(id, +el.dataset.score);
      if (s.userId !== me.id && firstTime('rate', id)) celebrate(reward('rate'));
      else toast('🐾 Condition updated');
      break;
    }
    case 'status': {
      const s = store.byId(id);
      if (s.resolved && (el.dataset.status === 'urgent' || el.dataset.status === 'help')) await store.reopen(id);
      await store.setStatus(id, el.dataset.status);
      toast(`Status: ${el.textContent.trim()}`);
      break;
    }
    case 'claim': {
      const s = store.byId(id);
      if (!s) break;
      const wasMine = s.helper?.userId === me.id;
      await store.claim(id);
      if (!wasMine && firstTime('claim', id)) celebrate(reward('claim'));
      break;
    }
    case 'resolve': {
      const s = store.byId(id);
      // Double-tap guard; the one exception is a verified shelter confirming a player's report.
      if (!s || (s.resolved && !(store.awaitsCheck(s) && account.isShelter()))) break;
      await store.resolve(id, 'rescued');
      confetti(['💚', '🐾', '✨', '🦸']);
      if (firstTime('rescue', id)) celebrate(reward('rescue'));
      else toast('💚 Marked as helped');
      break;
    }
    case 'adopted':
      if (store.byId(id)?.resolved) break;
      await store.resolve(id, 'adopted');
      confetti(['💗', '🏡', '✨', '🎉']);
      toast('🏡 Yay! Listing closed. Thank you!');
      break;
    case 'post-adoption': startCatch({ adoption: true }, afterCatch); break;
    case 'avatar':
      me.avatar = el.dataset.val; store.touchProfile();
      renderPanel(); renderTopbar();
      break;
    case 'save-server': {
      const url = store.normUrl($('[data-set="serverUrl"]').value);
      if (url && !/^https?:\/\//.test(url)) { toast('Server URL should start with http:// or https://'); break; }
      let health = null;
      if (url) {
        try { health = await store.testServer(url); toast('🟢 Connected to community server'); }
        catch (e) { toast(`🔴 Can't reach server: ${esc(e.message)}`); break; }
      }
      await store.setServer(url, health?.serverId || null);
      renderPanel();
      break;
    }
    case 'sync': await store.sync(); renderPanel(); break;
    case 'auth': openAuth(el.dataset.mode); break;
    case 'logout':
      if (confirm('Sign out? Your deck and XP stay saved in your account. This phone goes back to a new player.')) {
        try { await account.logout(); location.reload(); }
        catch (e) { toast(`⚠️ ${esc(e.message)}`, 5000); }
      }
      break;
    case 'shelter-apply': openShelterForm(); break;
    case 'toggle-demo': settings.showDemo = el.checked; store.saveSettings(); renderAll(); break;
    case 'restore-demo': await store.restoreDemo(); toast('Demo critters are back 🐒'); break;
    case 'reset':
      if (confirm('Delete your deck, XP and all saved critters on this device?')) {
        await store.resetEverything();
        location.reload();
      }
      break;
  }
}

// ---------- accounts ----------

function formError(form, msg) {
  form.querySelector('.form-error').textContent = msg;
  form.querySelector('button[type=submit]').disabled = false;
}

function openAuth(mode) {
  const sheet = openSheet(authHtml(mode));
  const form = sheet.el.querySelector('form');
  sheet.el.addEventListener('click', e => {
    const m = e.target.closest('[data-auth-mode]');
    if (m) { sheet.close(); openAuth(m.dataset.authMode); }
  });
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(form));
    if (mode !== 'login' && f.password !== f.password2) return formError(form, 'The two passwords are different.');
    form.querySelector('button[type=submit]').disabled = true;
    form.querySelector('.form-error').textContent = '';
    try {
      if (mode === 'register') {
        const r = await account.register(f.username.trim(), f.password);
        sheet.close();
        showRecoveryCode(r.recoveryCode, true);
      } else if (mode === 'recover') {
        const r = await account.recover(f.username.trim(), f.code, f.password);
        sheet.close();
        showRecoveryCode(r.recoveryCode, false);
      } else {
        await account.login(f.username.trim(), f.password);
        sheet.close();
        toast(`☁️ Welcome back, ${esc(me.name)}! Your deck and XP are on this phone now.`, 3500);
      }
      renderAll();
    } catch (err) {
      formError(form, err.message);
    }
  });
}

function showRecoveryCode(code, fresh) {
  const sheet = openSheet(recoveryCodeHtml(code, fresh));
  sheet.el.addEventListener('click', async e => {
    const b = e.target.closest('[data-copy]');
    if (!b) return;
    try { await navigator.clipboard.writeText(b.dataset.copy); toast('📋 Copied'); }
    catch { toast('Press and hold the code to copy it'); }
  });
}

function openShelterForm() {
  const sheet = openSheet(shelterFormHtml());
  const form = sheet.el.querySelector('form');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    form.querySelector('button[type=submit]').disabled = true;
    try {
      await account.applyAsShelter(Object.fromEntries(new FormData(form)));
      sheet.close();
      toast('🏥 Application sent! An admin will review it.', 3500);
      renderPanel();
    } catch (err) {
      formError(form, err.message);
    }
  });
}

function afterCatch(s) {
  go('map');
  if (s) { setFilter('all'); renderChips(); flyTo(s); }
}

// ---------- boot ----------

function onboarding() {
  return new Promise(resolve => {
    let avatar = '🧢', thenSignIn = false;
    // However the sheet closes (button, back button, backdrop), keep what was entered or the defaults.
    const finish = () => {
      me.name = sheet.el.querySelector('[data-ob="name"]')?.value.trim() || me.name || 'Hẻm Hunter';
      me.avatar = avatar;
      store.saveMe();
      resolve();
      if (thenSignIn) openAuth('login');
    };
    const sheet = openSheet(onboardingHtml(), { full: true, onClose: finish });
    sheet.el.closest('.sheet').querySelector('.sheet-close').remove();
    sheet.el.addEventListener('click', e => {
      const av = e.target.closest('[data-ob-avatar]');
      if (av) {
        avatar = av.dataset.obAvatar;
        sheet.el.querySelectorAll('[data-ob-avatar]').forEach(b => b.classList.toggle('on', b === av));
      }
      if (e.target.closest('[data-ob="go"]')) sheet.close();
      if (e.target.closest('[data-ob="signin"]')) { thenSignIn = true; sheet.close(); }
    });
  });
}

async function boot() {
  await store.init();
  initMap($('#map'), openDetail);
  renderChips();
  renderAll();
  store.subscribe(renderAll);

  document.addEventListener('click', e => {
    const tabBtn = e.target.closest('.tabbar [data-tab]');
    if (tabBtn) return go(tabBtn.dataset.tab);
    const el = e.target.closest('[data-act]');
    if (el && el.tagName !== 'INPUT') act(el);
  });
  document.addEventListener('change', e => {
    if (e.target.dataset.act === 'toggle-demo') act(e.target);
  });
  document.addEventListener('input', e => {
    if (e.target.dataset.me === 'name') { me.name = e.target.value; store.touchProfile(); renderTopbar(); }
  });
  $('#catchBtn').addEventListener('click', () => startCatch({}, afterCatch));
  $('#trainer').addEventListener('click', () => go('profile'));
  $('#locateBtn').addEventListener('click', () => locateMe(true));
  $('#questBtn').addEventListener('click', () => openSheet(`<h2>📜 Daily quests</h2>
    <p class="muted">Fresh every day. Each one is worth +50 XP.</p>${questsHtml()}`));

  let restoredPhoto = null;
  if (isNative) {
    App.addListener('backButton', () => {
      if (hasSheet()) closeSheet();
      else if (tab !== 'map') go('map');
      else App.exitApp();
    });
    // Android may kill the app while the camera is open; pick the photo back up when it restarts.
    App.addListener('appRestoredResult', async r => {
      if (r.pluginId !== 'Camera' || r.methodName !== 'getPhoto' || !r.success || !r.data?.dataUrl) return;
      restoredPhoto = await compress(r.data.dataUrl);
      if (me.name) { startCatch({ photo: restoredPhoto }, afterCatch); restoredPhoto = null; }
    });
  } else if ('serviceWorker' in navigator && import.meta.env.PROD) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  if (!me.name) await onboarding();
  if (restoredPhoto) startCatch({ photo: restoredPhoto }, afterCatch);
  renderTopbar();
  // Show the player on the map without jumping away from Saigon if GPS is elsewhere.
  locateMe(false).then(p => {
    if (p && Math.abs(p.lat - HCMC.lat) < 0.6 && Math.abs(p.lng - HCMC.lng) < 0.6) flyTo(p, 15);
  });
}

boot();
