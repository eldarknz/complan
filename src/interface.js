import { catalog } from './catalog.js';

export function initializeInterface(onAdd) {
  const $ = (selector) => document.querySelector(selector);
  $('#save').insertAdjacentHTML('beforebegin', '<button id="undo" class="quiet" type="button" title="Отменить — Cmd/Ctrl+Z" aria-label="Отменить действие" disabled>↶</button><button id="redo" class="quiet" type="button" title="Повторить — Cmd/Ctrl+Shift+Z" aria-label="Повторить действие" disabled>↷</button>');
  $('.catalog h1').textContent = 'Соберите свою систему.';
  $('.category .count').textContent = catalog.length;
  $('#add').outerHTML = `<div class="catalog-filters"><input id="catalog-search" type="search" placeholder="Найти элемент…" aria-label="Поиск по библиотеке" /><div class="presets"><button data-filter="all" class="active">Все · ${catalog.length}</button>${[110, 50].map((diameter) => `<button data-filter="${diameter}">Ø${diameter} · ${catalog.filter((item) => item.diameter === diameter).length}</button>`).join('')}</div></div><div id="catalog-list"></div>`;
  $('.catalog-filters').insertAdjacentHTML('beforeend', '<select id="catalog-kind" aria-label="Тип компонента"><option value="all">Все типы компонентов</option><option value="pipe">Трубы и патрубки</option><option value="elbow">Отводы</option><option value="tee">Тройники</option><option value="cross">Крестовины</option><option value="coupling">Муфты</option><option value="reducer">Переходы и редукции</option><option value="service">Сервисные элементы</option></select>');
  $('#viewport').insertAdjacentHTML('beforeend', '<label class="snap-toggle"><input id="snap-enabled" type="checkbox" checked /> Магнитная стыковка <span id="snap-status">до 90 мм</span></label>');
  $('.catalog-note p').textContent = 'При включённом магните новая деталь пристыкуется к выбранному свободному концу. При перетаскивании подведите совместимые концы ближе 90 мм и отпустите мышь.';
  $('.selected-heading .muted').textContent = 'Канализация · HT';
  $('#properties').insertAdjacentHTML('afterbegin', '<div class="assembly-status"><p id="assembly-status" class="muted small"></p><button id="detach-element" type="button" hidden>Отсоединить деталь</button></div>');
  $('.assembly-status').insertAdjacentHTML('beforeend', `<div id="joint-rotation" hidden>
    <label class="field-label" for="rotation-scope">Что вращать</label><select id="rotation-scope"><option value="joint">Деталь вокруг стыка</option><option value="assembly">Всю сборку</option></select>
    <div id="joint-settings"><label class="field-label" for="rotation-port">Ось соединения</label><select id="rotation-port"></select>
    <p class="muted small">Нажмите E и тяните кольцо. Вращается выбранная сторона стыка, другая остаётся на месте.</p>
    <label class="field-label" for="joint-angle">Повернуть на, °</label><div class="joint-angle-row"><input id="joint-angle" type="number" min="-360" max="360" step="15" value="90" /><button id="apply-joint-angle" type="button">Повернуть</button></div></div></div>`);
  $('.diameter strong').id = 'element-diameter';
  $('.badge').textContent = 'ТОЧКИ';
  $('#connect').previousElementSibling.textContent = 'Нажмите точку на детали или выберите конец ниже. Соединённые детали перемещаются вместе.';
  $('#connect').insertAdjacentHTML('beforebegin', `<label class="field-label" for="port-select">Точка выбранной детали</label><select id="port-select"></select>
    <div id="join-controls"><label class="field-label" for="join-mode">Что присоединить</label><select id="join-mode"><option value="new">Новый элемент из библиотеки</option><option value="existing">Элемент из сцены</option></select>
    <label class="field-label" for="target-select">Присоединяемый элемент</label><select id="target-select"></select>
    <label class="field-label" for="target-port">Конец присоединяемой детали</label><select id="target-port"></select>
    <label class="field-label" for="join-roll">Поворот вокруг стыка, °</label><input id="join-roll" type="number" min="-360" max="360" step="15" value="0" /></div>
    <div id="occupied-controls" hidden><p class="muted small">Повернуть выбранную сторону сборки вокруг этого стыка:</p><div class="presets"><button id="twist-minus">−15°</button><button id="twist-plus">+15°</button><button id="twist-quarter">+90°</button></div><button id="disconnect" class="text-button">Разъединить стык</button></div>`);
  $('#connect').textContent = '＋ Присоединить элемент';
  $('.inspector-footer').innerHTML = 'Эскизные модели HT Ø110 / Ø50<br><span>Монтажные размеры уточняйте по каталогу производителя.</span>';
  let filter = 'all';
  const symbols = { pipe: '━', tee: '┳', cross: '╋', elbow: '╰', inspection: '⊕', coupling: '═', cap: '⊣', toilet: '◎', clamp: 'Ω', fire: '▣', sleeve: '▤', roof: '△', reducer: '⋙', drain: '▦', funnel: '▽', vacuum: '⊤', check: '▸' };
  function renderCatalog() {
    const query = $('#catalog-search').value.trim().toLocaleLowerCase();
    const kind = $('#catalog-kind').value;
    const primaryKinds = ['pipe', 'elbow', 'tee', 'cross', 'coupling', 'reducer'];
    const items = catalog.filter((item) => (filter === 'all' || item.diameter === +filter) && (kind === 'all' || kind === item.kind || kind === 'service' && !primaryKinds.includes(item.kind)) && `${item.name} ${item.description}`.toLocaleLowerCase().includes(query));
    $('#catalog-list').replaceChildren();
    for (const item of items) {
      const button = document.createElement('button');
      const entry = document.createElement('div');
      entry.className = 'catalog-entry';
      button.className = 'catalog-item';
      button.dataset.typeId = item.id;
      button.innerHTML = `<span class="catalog-symbol">${symbols[item.kind]}</span><span><strong>${item.name}</strong><small>${item.description || (item.accessory ? 'Монтажный элемент' : 'Внутренняя канализация · HT')}</small></span><span class="catalog-plus">+</span>`;
      entry.append(button);
      let lengths;
      if (item.lengths) {
        lengths = document.createElement('select');
        lengths.setAttribute('aria-label', `Длина ${item.name}`);
        lengths.replaceChildren(...item.lengths.map((length) => new Option(`${length} мм`, length)));
        lengths.value = item.length;
        entry.append(lengths);
      }
      button.onclick = () => onAdd(item, lengths ? +lengths.value : item.length);
      $('#catalog-list').append(entry);
    }
    if (!items.length) $('#catalog-list').textContent = 'Элементы не найдены';
  }
  $('#catalog-search').addEventListener('input', renderCatalog);
  $('#catalog-kind').onchange = renderCatalog;
  document.querySelectorAll('[data-filter]').forEach((button) => button.onclick = () => {
    filter = button.dataset.filter;
    document.querySelectorAll('[data-filter]').forEach((other) => other.classList.toggle('active', other === button));
    renderCatalog();
  });
  renderCatalog();
}
