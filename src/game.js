// XP, levels, badges and daily quests. Playful on top, purposeful underneath:
// the biggest rewards go to reporting and helping animals, not just collecting.

import { me, saveMe, mine } from './store.js';
import { SPECIES_BY_ID, RARITY } from './species.js';

export const XP = {
  report: 15,      // filling in a dog/cat status + condition
  rate: 5,         // rating an animal someone else found
  claim: 10,       // "I'm on it"
  rescue: 40,      // marking an animal as helped / rescued
  adoptPost: 30,   // putting your pet up for adoption
  newSpecies: 25,  // first card of a species
  quest: 50,
};

const TITLES = [
  [1, 'Hẻm Rookie'], [2, 'Alley Scout'], [3, 'Street Ranger'], [5, 'Critter Whisperer'],
  [8, 'Saigon Guardian'], [12, 'Legend of the Hẻm'],
];

export const levelOf = xp => Math.floor(Math.sqrt(xp / 50)) + 1;
export const xpForLevel = lvl => 50 * (lvl - 1) ** 2;
export const titleOf = lvl => TITLES.filter(([l]) => lvl >= l).pop()[1];

export function levelProgress() {
  const lvl = levelOf(me.xp);
  const from = xpForLevel(lvl), to = xpForLevel(lvl + 1);
  return { lvl, title: titleOf(lvl), pct: (me.xp - from) / (to - from), toNext: to - me.xp };
}

export const BADGES = [
  { id: 'first',    emoji: '🎉', name: 'First Catch',     desc: 'Add your first critter to the deck' },
  { id: 'five',     emoji: '📒', name: 'Collector',       desc: 'Spot 5 different species' },
  { id: 'ten',      emoji: '🏅', name: 'Dex Master',      desc: 'Spot 10 different species' },
  { id: 'legend',   emoji: '🌟', name: 'Legend Spotter',  desc: 'Spot a super rare critter' },
  { id: 'samaritan',emoji: '🩹', name: 'Good Samaritan',  desc: 'Report a dog or cat that needs help' },
  { id: 'hero',     emoji: '🦸', name: 'Rescue Hero',     desc: 'Mark an animal on the rescue board as helped' },
  { id: 'match',    emoji: '💗', name: 'Matchmaker',      desc: 'Put a pet up for adoption' },
  { id: 'eye',      emoji: '👀', name: 'Caring Eye',      desc: 'Rate the condition of 5 animals' },
];

function checkBadges() {
  const mySpecies = new Set(mine().map(s => s.species));
  const has = id => me.badges.includes(id);
  const earned = [];
  const rules = {
    first: mine().length >= 1,
    five: mySpecies.size >= 5,
    ten: mySpecies.size >= 10,
    legend: [...mySpecies].some(id => SPECIES_BY_ID[id]?.rarity === 'legend'),
    samaritan: mine().some(s => s.status === 'urgent' || s.status === 'help'),
    hero: me.stats.rescued >= 1,
    match: me.stats.adoptions >= 1,
    eye: me.stats.rated >= 5,
  };
  for (const b of BADGES) if (rules[b.id] && !has(b.id)) { me.badges.push(b.id); earned.push(b); }
  return earned;
}

// ---------- daily quests ----------

const QUESTS = [
  { id: 'catch', emoji: '📸', text: 'Spot 3 critters', goal: 3 },
  { id: 'rate',  emoji: '🐾', text: 'Rate 2 animals\' condition', goal: 2 },
  { id: 'help',  emoji: '🆘', text: 'Check in on the rescue board', goal: 1 },
];
// Local calendar date, so quests roll over at midnight in Saigon, not 07:00 (UTC midnight).
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function quests() {
  if (me.quests?.date !== today()) me.quests = { date: today(), catch: 0, rate: 0, help: 0, done: [] };
  return QUESTS.map(q => ({ ...q, progress: Math.min(me.quests[q.id], q.goal), done: me.quests.done.includes(q.id) }));
}

function bumpQuest(id, gains) {
  quests();
  me.quests[id] += 1;
  const q = QUESTS.find(x => x.id === id);
  if (me.quests[id] >= q.goal && !me.quests.done.includes(id)) {
    me.quests.done.push(id);
    gains.push({ xp: XP.quest, label: `Daily quest: ${q.text}` });
  }
}

/**
 * Apply a game event; returns { gains, total, levelUp, badges } for the UI to celebrate.
 * events: catch | rate | claim | rescue | visitRescue
 */
export function reward(event, ctx = {}) {
  const gains = [];
  const before = levelOf(me.xp);

  // Counters go up on the player and on this phone's own tally (what syncs to an account).
  const bump = k => { me.stats[k]++; me.dev.stats[k] = (me.dev.stats[k] || 0) + 1; };

  if (event === 'catch') {
    const sp = SPECIES_BY_ID[ctx.species];
    gains.push({ xp: RARITY[sp.rarity].xp, label: `${RARITY[sp.rarity].label} ${sp.name}` });
    if (ctx.firstOfSpecies) gains.push({ xp: XP.newSpecies, label: 'New species in your deck!' });
    if (ctx.reported) gains.push({ xp: XP.report, label: 'Welfare report' });
    if (ctx.adoption) { gains.push({ xp: XP.adoptPost, label: 'Adoption post' }); bump('adoptions'); }
    bump('catches');
    bumpQuest('catch', gains);
    if (ctx.reported) { bump('rated'); bumpQuest('rate', gains); }
  } else if (event === 'rate') {
    gains.push({ xp: XP.rate, label: 'Condition check' });
    bump('rated');
    bumpQuest('rate', gains);
  } else if (event === 'claim') {
    gains.push({ xp: XP.claim, label: 'On my way!' });
    bump('helped');
    bumpQuest('help', gains);
  } else if (event === 'rescue') {
    gains.push({ xp: XP.rescue, label: 'Animal helped' });
    bump('rescued');
    bumpQuest('help', gains);
  } else if (event === 'visitRescue') {
    if (!quests().find(q => q.id === 'help').done) bumpQuest('help', gains);
  }

  const total = gains.reduce((a, g) => a + g.xp, 0);
  me.xp += total;
  me.dev.xp += total;
  const badges = checkBadges();
  saveMe();
  const after = levelOf(me.xp);
  return { gains, total, levelUp: after > before ? after : null, badges };
}
