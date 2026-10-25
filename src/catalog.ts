export interface CatalogItem {
  id: string;
  name: string;
  kind: string;
  diameter: number;
  length: number;
  description: string;
  lengths?: number[];
  branch?: number;
  angle?: number;
  outlet?: number;
  accessory?: boolean;
  plain?: boolean;
  cuff?: boolean;
  fixed?: boolean;
  socketDepth?: number;
  plastic?: boolean;
  twoPlane?: boolean;
  eccentric?: boolean;
  internal?: boolean;
}
export const catalog: CatalogItem[] = [];
function add(id: string, name: string, kind: string, diameter: number, options: Partial<CatalogItem> = {}) {
  catalog.push({ id, name, kind, diameter, length: diameter * 2.5, description: '', ...options });
}
add('pipe-110', 'Труба HT Ø110', 'pipe', 110, { length: 1000 });
add('tee-110-110-87', 'Тройник HTEA Ø110/110/87°', 'tee', 110, { branch: 110, angle: 87, description: 'Для подключения унитаза' });
add('tee-110-50-87', 'Тройник HTEA Ø110/50/87°', 'tee', 110, { branch: 50, angle: 87, description: 'Ветка ванны и раковины' });
add('tee-110-50-45', 'Косой тройник HTEA Ø110/50/45°', 'tee', 110, { branch: 50, angle: 45, description: 'Кухня и ветки Ø50 в горизонтальный коллектор' });
for (const angle of [45, 15, 30]) add(`elbow-110-${angle}`, `Отвод HTB Ø110/${angle}°`, 'elbow', 110, { angle });
add('inspection-110', 'Ревизия HTRE Ø110', 'inspection', 110);
add('coupling-110', 'Муфта ремонтная Ø110', 'coupling', 110, { length: 150 });
add('cap-110', 'Заглушка Ø110', 'cap', 110, { length: 65 });
add('toilet-110', 'Манжета для унитаза Ø110', 'toilet', 110, { length: 120 });
add('clamp-110', 'Хомут Ø110 с резиновой вставкой', 'clamp', 110, { length: 28, accessory: true });
add('fire-110', 'Противопожарная муфта Ø110', 'fire', 110, { length: 60, accessory: true, description: 'Проход через межэтажное перекрытие' });
add('sleeve-110', 'Гильза DN150 под трубу Ø110', 'sleeve', 110, { length: 220, accessory: true, description: 'Проход через перекрытие' });
add('roof-110', 'Кровельная проходка Ø110', 'roof', 110, { length: 230, accessory: true, description: 'Для фановой трубы' });
add('pipe-50', 'Труба HT Ø50', 'pipe', 50, { length: 1000 });
for (const angle of [45, 87]) add(`tee-50-50-${angle}`, `Тройник HTEA Ø50/50/${angle}°`, 'tee', 50, { branch: 50, angle });
for (const angle of [45, 30, 15, 87]) add(`elbow-50-${angle}`, `Отвод HTB Ø50/${angle}°`, 'elbow', 50, { angle });
add('inspection-50', 'Ревизия HTRE Ø50', 'inspection', 50);
add('coupling-50', 'Муфта ремонтная Ø50', 'coupling', 50, { length: 90 });
add('cap-50', 'Заглушка Ø50', 'cap', 50, { length: 40 });
add('reducer-50-40', 'Переход Ø50/40', 'reducer', 50, { outlet: 40, length: 90, description: 'Для сифонов и стиральной машины' });
add('drain-50', 'Трап Ø50 с сухим затвором', 'drain', 50, { length: 140, description: 'Слив в бойлерной' });
add('funnel-50', 'Воронка разрыва струи Ø50', 'funnel', 50, { length: 140, description: 'Слив предохранительного клапана бойлера / котла' });
add('clamp-50', 'Хомут Ø50 с резиновой вставкой', 'clamp', 50, { length: 24, accessory: true });
add('reducer-110-50', 'Переход Ø110/50', 'reducer', 110, { outlet: 50, length: 150 });
add('cross-110-110-87', 'Крестовина Ø110/110/87°', 'cross', 110, { branch: 110, angle: 87, description: 'Одноплоскостная · два боковых выхода Ø110' });
add('cross-110-50-87', 'Крестовина Ø110/50/87°', 'cross', 110, { branch: 50, angle: 87, description: 'Одноплоскостная · два боковых выхода Ø50' });
add('cross-50-50-87', 'Крестовина Ø50/50/87°', 'cross', 50, { branch: 50, angle: 87, description: 'Одноплоскостная · два боковых выхода Ø50' });
const pipeLengths = [150, 250, 500, 750, 1000, 1500, 2000, 3000];
for (const diameter of [50, 110]) {
  Object.assign(catalog.find((item) => item.id === `pipe-${diameter}`), { name: `Труба HTEM Ø${diameter}`, lengths: pipeLengths, description: 'С раструбом · 150–3000 мм' });
  add(`pipe-plain-${diameter}`, `Труба HTGL Ø${diameter}`, 'pipe', diameter, { length: 5000, lengths: [5000], plain: true, description: 'Без раструба · 5000 мм · возможна подрезка' });
  for (const angle of [15, 30, 45, 67, 87]) {
    if (!catalog.some((item) => item.id === `elbow-${diameter}-${angle}`)) add(`elbow-${diameter}-${angle}`, `Отвод HTB Ø${diameter}/${angle}°`, 'elbow', diameter, { angle });
  }
  Object.assign(catalog.find((item) => item.id === `coupling-${diameter}`), { name: `Муфта HTU Ø${diameter}`, description: 'Надвижная, ремонтная' });
  Object.assign(catalog.find((item) => item.id === `cap-${diameter}`), { name: `Заглушка HTM Ø${diameter}` });
  Object.assign(catalog.find((item) => item.id === `clamp-${diameter}`), { name: `Металлический хомут Ø${diameter}`, description: 'С резиновой вставкой' });
  for (const [code, description, factor] of [['HTMM', 'Двойная, двухраструбная', 1.8], ['HTAM', 'Насадная с уплотнительной манжетой', 1.6]] as const) {
    add(`${code.toLowerCase()}-${diameter}`, `Муфта ${code} Ø${diameter}`, 'coupling', diameter, { length: diameter * factor, description, cuff: code === 'HTAM' });
  }
  add(`htl-${diameter}`, `Муфта HTL Ø${diameter}`, 'pipe', diameter, { length: diameter * 3, fixed: true, socketDepth: diameter * 1.4, description: 'Компенсационный патрубок · длинный раструб' });
  add(`vacuum-${diameter}`, `Клапан вакуумный Ø${diameter}`, 'vacuum', diameter, { length: diameter * 1.8 });
  add(`check-${diameter}`, `Обратный клапан Ø${diameter}`, 'check', diameter, { length: diameter * 3 });
  add(`clamp-plastic-${diameter}`, `Пластиковый хомут Ø${diameter}`, 'clamp', diameter, { length: 25, accessory: true, plastic: true });
}
add('fire-50', 'Противопожарная манжета Ø50', 'fire', 50, { length: 40, accessory: true });
add('htsm-110', 'Восстановитель раструба HTSM Ø110/110', 'coupling', 110, { length: 130, description: 'Эскизная модель восстановителя раструба' });
for (const [diameter, branch] of [[50, 50], [50, 40], [110, 50], [110, 75], [110, 110]]) {
  for (const angle of [45, 67, 87]) {
    const id = `tee-${diameter}-${branch}-${angle}`;
    if (!catalog.some((item) => item.id === id)) add(id, `Тройник HTEA Ø${diameter}/${branch}/${angle}°`, 'tee', diameter, { branch, angle });
  }
}
for (const item of catalog.filter((item) => item.kind === 'cross')) item.name = `Крестовина HTDA Ø${item.diameter}/${item.branch}/${item.branch}`;
add('cross-two-plane-110', 'Крестовина HTED Ø110/110/110', 'cross', 110, { branch: 110, angle: 87, twoPlane: true, description: 'Угловая двухплоскостная' });
for (const [diameter, outlet] of [[50, 40], [110, 50], [110, 75], [110, 90]]) {
  const shortId = `reducer-${diameter}-${outlet}`;
  if (!catalog.some((item) => item.id === shortId)) add(shortId, '', 'reducer', diameter, { outlet, length: 150 });
  Object.assign(catalog.find((item) => item.id === shortId), { name: `Редукция HTR короткая Ø${diameter}/${outlet}` });
  add(`reducer-ecc-${diameter}-${outlet}`, `Редукция HTR эксцентрическая Ø${diameter}/${outlet}`, 'reducer', diameter, { outlet, length: diameter * 1.8, eccentric: true });
  add(`reducer-inner-${diameter}-${outlet}`, `Переход HTRI внутренний Ø${diameter}/${outlet}`, 'reducer', diameter, { outlet, length: diameter === 50 ? 65 : 100, internal: true });
}
export const catalogById = new Map(catalog.map((item) => [item.id, item]));
