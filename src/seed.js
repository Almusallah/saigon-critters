// Demo critters around HCMC so the map isn't empty on first launch.
// They are flagged `demo: true`, never synced, and can be hidden in Profile.

const PLACES = {
  benThanh:   [10.7725, 106.6980],
  notreDame:  [10.7798, 106.6990],
  taoDan:     [10.7745, 106.6925],
  jadePagoda: [10.7922, 106.6980],
  nhieuLoc:   [10.7915, 106.6805],
  d4:         [10.7590, 106.7040],
  buiVien:    [10.7670, 106.6930],
  thaoDien:   [10.8030, 106.7340],
  binhThanh:  [10.8170, 106.7240],
  d7:         [10.7290, 106.7190],
  binhTay:    [10.7500, 106.6510],
  tanDinh:    [10.7885, 106.6900],
  canGio:     [10.4180, 106.9570],
  canGio2:    [10.4420, 106.8850],
  binhQuoi:   [10.8290, 106.7340],
  binhChanh:  [10.7080, 106.6110],
  leVanTam:   [10.7880, 106.6950],
  giaDinh:    [10.8120, 106.6780],
  park239:    [10.7690, 106.6950],
  phuNhuan:   [10.7990, 106.6820],
  cafeD1:     [10.7790, 106.7030],
};

const USERS = {
  lan:  { userId: 'demo-lan',  userName: 'Lan',  userAvatar: '🦊' },
  minh: { userId: 'demo-minh', userName: 'Minh', userAvatar: '🐯' },
  bao:  { userId: 'demo-bao',  userName: 'Bảo',  userAvatar: '🐼' },
  thao: { userId: 'demo-thao', userName: 'Thảo', userAvatar: '🐰' },
  hh:   { userId: 'demo-hh',   userName: 'Hẻm Heroes', userAvatar: '🦸' },
};

const H = 3600e3;

const RAW = [
  ['dog', 'Mực', 'lan', 'd4', 0.7, { status: 'urgent', r: [1, 2], note: 'Hit by a motorbike, can\'t stand up. A lady from the bánh mì cart is staying with her.' }],
  ['dog', 'Lucky', 'minh', 'benThanh', 2, { status: 'urgent', r: [1], note: 'Limping on back leg, hiding under parked motorbikes near the market gate.' }],
  ['cat', 'Mèo Mun', 'bao', 'buiVien', 5, { status: 'help', r: [2], note: 'Very thin mum cat with 3 kittens behind the phở stall.' }],
  ['cat', 'Su Su', 'thao', 'phuNhuan', 8, { status: 'help', r: [2, 3], note: 'Eye infection, super friendly, lets you pick her up.' }],
  ['dog', 'Bắp', 'lan', 'binhThanh', 26, { status: 'help', r: [2], note: 'Chained all day in the sun, no water bowl.' }],
  ['dog', 'Vàng', 'minh', 'park239', 30, { status: 'ok', r: [4, 4, 3], note: 'Community dog. The xe ôm drivers feed him every morning.' }],
  ['cat', 'Bơ', 'bao', 'tanDinh', 3, { status: 'owned', r: [5], note: 'Chubby shop cat, king of the pharmacy counter.' }],
  ['cat', 'Đen', 'thao', 'binhTay', 12, { status: 'ok', r: [3], note: 'Market cat, keeps the rice sacks safe.' }],
  ['dog', 'Đậu', 'hh', 'd7', 50, { status: 'help', r: [2], note: 'Was sleeping in the rain by the canal.',
    resolved: { userId: 'demo-hh', name: 'Hẻm Heroes', outcome: 'rescued' } }],
  ['cat', 'Kem', 'thao', 'phuNhuan', 20, { ownPet: true, status: 'owned', r: [5], note: '3-month-old kitten, litter trained, loves cuddles and chasing geckos.',
    adoption: { age: '3 months', sterilized: false, vaccinated: true, contact: '' } }],
  ['dog', 'Chè', 'lan', 'thaoDien', 40, { ownPet: true, status: 'owned', r: [5], note: '2-year-old mixed breed, great with kids, walks nicely on a leash.',
    adoption: { age: '2 years', sterilized: true, vaccinated: true, contact: '' } }],
  ['cat', 'Mochi', 'minh', 'd7', 60, { ownPet: true, status: 'owned', r: [5], note: 'Bonded pair with her brother Tofu, indoor cats. We are moving abroad 😢',
    adoption: { age: '4 years', sterilized: true, vaccinated: true, contact: '' } }],
  ['chicken', 'Captain Gà', 'bao', 'd4', 4, { r: [5], note: 'Crows at 4am sharp. Every. Single. Day.' }],
  ['pigeon', 'The Flock', 'thao', 'notreDame', 6, {}],
  ['squirrel', 'Hạt Dẻ', 'lan', 'taoDan', 9, { note: 'Stole a peanut from my hand!' }],
  ['turtle', 'Grandpa Rùa', 'minh', 'jadePagoda', 28, { note: 'Sunbathing in the pagoda pond.' }],
  ['monitor', 'Canal Dragon', 'bao', 'nhieuLoc', 72, { note: 'At least 1.2m long, swimming in Nhiêu Lộc canal!' }],
  ['monkey', 'Sunglasses Thief', 'thao', 'canGio', 96, { note: 'Took a tourist\'s sunglasses and ran up a tree.' }],
  ['otter', 'Rái Rái', 'lan', 'canGio2', 120, { note: 'Saw it slip into the mangrove at low tide.' }],
  ['gecko', 'Tchk', 'minh', 'tanDinh', 1, {}],
  ['koi', 'Mr. Orange', 'bao', 'cafeD1', 14, { note: 'Café pond, very fat, very fancy.' }],
  ['duck', 'Duck Squad', 'thao', 'binhQuoi', 22, {}],
  ['frog', 'Ộp Ộp', 'lan', 'giaDinh', 10, { note: 'After-rain concert.' }],
  ['tokay', 'To-Kay!', 'minh', 'thaoDien', 34, {}],
  ['buffalo', 'Big Trâu', 'bao', 'binhChanh', 48, {}],
  ['owl', 'Night Watch', 'thao', 'giaDinh', 80, { note: 'Barn owl on a lamp post. Couldn\'t believe it.' }],
  ['butterfly', 'Lụa', 'lan', 'leVanTam', 7, {}],
  ['rat', 'Ninja', 'minh', 'binhTay', 11, {}],
  ['sparrow', 'Crumbs', 'bao', 'benThanh', 2.5, {}],
];

export function demoSightings() {
  const now = Date.now();
  return RAW.map(([species, nickname, user, place, hoursAgo, x], i) => {
    const [lat, lng] = PLACES[place];
    const at = now - hoursAgo * H;
    // Small jitter so stacked demo critters don't overlap exactly.
    const j = () => (Math.sin(i * 12.9898) * 0.0015);
    return {
      id: `demo-${i}`,
      demo: true,
      createdAt: at,
      updatedAt: at,
      ...USERS[user],
      species,
      nickname,
      note: x.note || '',
      photo: null,
      lat: lat + j(),
      lng: lng + j() * 0.7,
      status: x.status || null,
      ratings: (x.r || []).map((score, k) => ({ userId: `demo-r${k}`, score, at })),
      ownPet: !!x.ownPet,
      adoption: x.adoption ? { open: true, ...x.adoption } : null,
      helper: null,
      resolved: x.resolved ? { ...x.resolved, at: at + 6 * H } : null,
    };
  });
}
