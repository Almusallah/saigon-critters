// The Saigon Critter-Dex: every animal you can spot around HCMC.
// `welfare: true` means the animal gets the dog/cat rescue + adoption flow.

export const RARITY = {
  common:   { label: 'Common',     xp: 10,  color: '#5BBF7A', order: 0 },
  uncommon: { label: 'Uncommon',   xp: 25,  color: '#4D96FF', order: 1 },
  rare:     { label: 'Rare',       xp: 60,  color: '#9B5DE5', order: 2 },
  legend:   { label: 'Super rare', xp: 150, color: '#F4A300', order: 3 },
};

export const SPECIES = [
  // Common
  { id: 'dog',      name: 'Dog',            vn: 'Chó',        emoji: '🐕', rarity: 'common', welfare: true,
    fact: 'Many hẻm dogs have a whole alley family who feeds them.', treat: '🦴' },
  { id: 'cat',      name: 'Cat',            vn: 'Mèo',        emoji: '🐈', rarity: 'common', welfare: true,
    fact: 'Shop cats guard the rice sacks. Some have been on duty for years.', treat: '🐟' },
  { id: 'chicken',  name: 'Chicken',        vn: 'Gà',         emoji: '🐓', rarity: 'common',
    fact: 'Saigon roosters do your 4am wake-up call for free.', treat: '🌽' },
  { id: 'gecko',    name: 'House Gecko',    vn: 'Thạch sùng', emoji: '🦎', rarity: 'common',
    fact: 'Free mosquito control, living on your ceiling.', treat: '🦟' },
  { id: 'pigeon',   name: 'Pigeon',         vn: 'Bồ câu',     emoji: '🕊️', rarity: 'common',
    fact: 'The flock at Notre-Dame Cathedral poses for more photos than anyone.', treat: '🌾' },
  { id: 'sparrow',  name: 'Sparrow',        vn: 'Chim sẻ',    emoji: '🐦', rarity: 'common',
    fact: 'Tiny, loud, and always first at the bánh mì crumbs.', treat: '🍞' },
  { id: 'rat',      name: 'Rat',            vn: 'Chuột',      emoji: '🐀', rarity: 'common',
    fact: 'The night-shift worker of every market.', treat: '🧀' },

  // Uncommon
  { id: 'duck',     name: 'Duck',           vn: 'Vịt',        emoji: '🦆', rarity: 'uncommon',
    fact: 'City ducks commute in a straight line. Respect the line.', treat: '🌾' },
  { id: 'frog',     name: 'Frog',           vn: 'Ếch',        emoji: '🐸', rarity: 'uncommon',
    fact: 'Rainy-season choir. Loudest right after a storm.', treat: '🦗' },
  { id: 'squirrel', name: 'Squirrel',       vn: 'Sóc',        emoji: '🐿️', rarity: 'uncommon',
    fact: 'Tao Đàn Park is their favourite hangout.', treat: '🥜' },
  { id: 'butterfly',name: 'Butterfly',      vn: 'Bướm',       emoji: '🦋', rarity: 'uncommon',
    fact: 'Look for them around flower stalls and park hedges.', treat: '🌸' },
  { id: 'koi',      name: 'Koi & Pond Fish',vn: 'Cá Koi',     emoji: '🐟', rarity: 'uncommon',
    fact: 'Pagoda and café ponds hide some very old, very fat koi.', treat: '🍙' },
  { id: 'snail',    name: 'Snail',          vn: 'Ốc',         emoji: '🐌', rarity: 'uncommon',
    fact: 'Saigon\'s favourite snack. Let this one go free.', treat: '🥬' },

  // Rare
  { id: 'turtle',   name: 'Turtle',         vn: 'Rùa',        emoji: '🐢', rarity: 'rare',
    fact: 'The Jade Emperor Pagoda pond is famous for its turtles.', treat: '🥬' },
  { id: 'tokay',    name: 'Tokay Gecko',    vn: 'Tắc kè',     emoji: '🐲', rarity: 'rare',
    fact: 'Shouts its own name: "To-kay!". A pocket dragon.', treat: '🦗' },
  { id: 'snake',    name: 'Snake',          vn: 'Rắn',        emoji: '🐍', rarity: 'rare', wild: true,
    fact: 'Most city snakes are harmless, but never touch one.', treat: '🥚' },
  { id: 'goat',     name: 'Goat',           vn: 'Dê',         emoji: '🐐', rarity: 'rare',
    fact: 'Found grazing on the green edges of the city.', treat: '🌿' },
  { id: 'buffalo',  name: 'Water Buffalo',  vn: 'Trâu',       emoji: '🐃', rarity: 'rare',
    fact: 'Still working the fields out toward Củ Chi and Bình Chánh.', treat: '🌾' },
  { id: 'bat',      name: 'Bat',            vn: 'Dơi',        emoji: '🦇', rarity: 'rare', wild: true,
    fact: 'Dusk patrol over the river, eating mosquitoes by the thousand.', treat: '🦟' },
  { id: 'parrot',   name: 'Parrot',         vn: 'Vẹt',        emoji: '🦜', rarity: 'rare',
    fact: 'Some of them say "xin chào" better than tourists.', treat: '🌻' },
  { id: 'rabbit',   name: 'Rabbit',         vn: 'Thỏ',        emoji: '🐇', rarity: 'rare',
    fact: 'Usually someone\'s pet on a very fancy leash.', treat: '🥕' },

  // Super rare
  { id: 'monkey',   name: 'Macaque',        vn: 'Khỉ',        emoji: '🐒', rarity: 'legend', wild: true,
    fact: 'Cần Giờ mangrove gang. They WILL steal your sunglasses.', treat: '🍌' },
  { id: 'otter',    name: 'Otter',          vn: 'Rái cá',     emoji: '🦦', rarity: 'legend', wild: true,
    fact: 'Shy mangrove swimmer. Seeing one is pure luck.', treat: '🐟' },
  { id: 'monitor',  name: 'Water Monitor',  vn: 'Kỳ đà',      emoji: '🐉', rarity: 'legend', wild: true,
    fact: 'The canal dragon. Sometimes spotted along Nhiêu Lộc canal.', treat: '🥚' },
  { id: 'owl',      name: 'Owl',            vn: 'Cú',         emoji: '🦉', rarity: 'legend', wild: true,
    fact: 'A city owl is a once-in-a-year sighting.', treat: '🐭' },

  // Catch-all
  { id: 'other',    name: 'Mystery Critter',vn: 'Bí ẩn',      emoji: '❓', rarity: 'uncommon',
    fact: 'Something new? Tell us in the notes!', treat: '🍪' },
];

// Null prototype, so synced junk like species "constructor" doesn't resolve to Object.prototype members.
export const SPECIES_BY_ID = Object.assign(Object.create(null), Object.fromEntries(SPECIES.map(s => [s.id, s])));

export const STATUS = {
  urgent: { label: 'Urgent!',          short: 'Urgent',    emoji: '🚨', color: '#FF4D4D',
            hint: 'Injured, sick, trapped or in danger' },
  help:   { label: 'Needs help',       short: 'Needs help', emoji: '🩹', color: '#FF9F1C',
            hint: 'Skinny, hungry, no shelter' },
  ok:     { label: 'Street & fine',    short: 'Doing fine', emoji: '😺', color: '#2EC4B6',
            hint: 'Community animal, looks OK' },
  owned:  { label: 'Has a home',       short: 'Has a home', emoji: '🏠', color: '#4D96FF',
            hint: 'Collar, owner nearby, well looked after' },
};

export const CONDITION = [
  { score: 1, label: 'Rough',      emoji: '😿' },
  { score: 2, label: 'Struggling', emoji: '😟' },
  { score: 3, label: 'Okay',       emoji: '😐' },
  { score: 4, label: 'Good',       emoji: '🙂' },
  { score: 5, label: 'Thriving',   emoji: '😻' },
];

const NAMES = ['Bơ', 'Mít', 'Xoài', 'Bún', 'Phở', 'Cà Phê', 'Sữa Đá', 'Bánh Bao', 'Lúa', 'Mập',
  'Đậu', 'Tiêu', 'Gạo', 'Kem', 'Bông', 'Mochi', 'Tofu', 'Chè', 'Bắp', 'Sầu Riêng', 'Nem',
  'Chả Giò', 'Bánh Mì', 'Ớt', 'Mướp', 'Su Su', 'Khoai', 'Nấm', 'Mèo Mun', 'Vàng', 'Mực', 'Cốm'];
const TITLES = ['Captain', 'Lord', 'Little', 'Big', 'Sir', 'Lady', 'Chef', 'Boss', 'Uncle', 'Auntie'];

export function randomName() {
  const n = NAMES[Math.floor(Math.random() * NAMES.length)];
  return Math.random() < 0.35 ? `${TITLES[Math.floor(Math.random() * TITLES.length)]} ${n}` : n;
}
