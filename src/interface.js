import { catalog } from './catalog.js';
import { defaultPipeColor, pipeColorById, pipeColors } from './elements.js';
import { summarizeBillOfMaterials, billOfMaterialsToAoa } from './project.js';

const $ = (selector) => document.querySelector(selector);

let currentElements = [];
let catalogColor = defaultPipeColor;

export function getCatalogColor() {
  return catalogColor;
}

function mountSwatches(container, onPick) {
  container.replaceChildren(...pipeColors.map((color) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.color = color.id;
    button.setAttribute('role', 'radio');
    button.setAttribute('aria-label', color.name);
    button.title = color.name;
    const dot = document.createElement('i');
    dot.style.background = color.hex;
    button.append(dot);
    button.onclick = () => onPick(color.id);
    return button;
  }));
}

export function syncColorSwatches(container, color) {
  if (!container) return;
  container.querySelectorAll('[data-color]').forEach((button) => {
    const active = button.dataset.color === color;
    button.classList.toggle('active', active);
    button.setAttribute('aria-checked', String(active));
  });
}

function renderBomList(rows) {
  const list = $('#bom-list');
  if (!list) return;
  if (!rows.length) {
    list.replaceChildren();
    list.innerHTML = '<p class="bom-empty">Пока нет добавленных элементов</p>';
    return;
  }
  const table = document.createElement('table');
  table.className = 'bom-table';
  table.innerHTML = '<thead><tr><th>№</th><th>Наименование</th><th>Длина</th><th>Кол-во</th></tr></thead>';
  const body = document.createElement('tbody');
  rows.forEach((row, index) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${index + 1}</td><td>${row.name}</td><td>${row.showLength ? `${row.length} мм` : '-'}</td><td>× ${row.quantity}</td>`;
    body.append(tr);
  });
  table.append(body);
  list.replaceChildren(table);
}

export function updateBillOfMaterials(elements) {
  currentElements = elements;
  const rows = summarizeBillOfMaterials(elements);
  const total = rows.reduce((sum, row) => sum + row.quantity, 0);
  const badge = $('#bom-total');
  if (badge) badge.textContent = String(total);
  const download = $('#bom-download');
  if (download) download.disabled = !rows.length;
  if ($('#bom-modal')?.classList.contains('open')) renderBomList(rows);
}

function openBomModal() {
  const modal = $('#bom-modal');
  if (!modal) return;
  renderBomList(summarizeBillOfMaterials(currentElements));
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  $('#bom-close')?.focus();
}

function closeBomModal() {
  const modal = $('#bom-modal');
  if (!modal) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
}

async function downloadBomExcel() {
  const rows = summarizeBillOfMaterials(currentElements);
  if (!rows.length) return;
  const button = $('#bom-download');
  if (button) button.disabled = true;
  try {
    const XLSX = await import('xlsx');
    const sheet = XLSX.utils.aoa_to_sheet(billOfMaterialsToAoa(rows));
    sheet['!cols'] = [{ wch: 5 }, { wch: 36 }, { wch: 12 }, { wch: 12 }, { wch: 22 }];
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, 'Спецификация');
    XLSX.writeFile(book, 'complan-specifikaciya.xlsx');
  } finally {
    if (button) button.disabled = !summarizeBillOfMaterials(currentElements).length;
  }
}

export function initializeInterface(onAdd, onRecolor) {
  $('#save').insertAdjacentHTML('beforebegin', '<button id="undo" class="quiet" type="button" title="Отменить, Cmd/Ctrl+Z" aria-label="Отменить действие" disabled><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button><button id="redo" class="quiet" type="button" title="Повторить, Cmd/Ctrl+Shift+Z" aria-label="Повторить действие" disabled><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 14l5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>');
  $('#save').insertAdjacentHTML('beforebegin', '<button id="bom-open" class="quiet" type="button" title="Спецификация" aria-label="Спецификация"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg><span id="bom-total">0</span></button>');
  document.body.insertAdjacentHTML('beforeend', `<div id="bom-modal" class="bom-modal" aria-hidden="true" role="dialog" aria-modal="true" aria-labelledby="bom-title">
    <div class="bom-backdrop" data-bom-close></div>
    <div class="bom-dialog">
      <div class="bom-dialog-header">
        <div><p class="eyebrow">ПРОЕКТ</p><h2 id="bom-title">Спецификация</h2></div>
        <button id="bom-close" class="quiet" type="button" aria-label="Закрыть">✕</button>
      </div>
      <div id="bom-list" class="bom-list"><p class="bom-empty">Пока нет добавленных элементов</p></div>
      <div class="bom-dialog-footer">
        <button id="bom-download" class="primary" type="button" disabled>Скачать в Excel</button>
      </div>
    </div>
  </div>`);
  $('#bom-open').onclick = openBomModal;
  $('#bom-close').onclick = closeBomModal;
  $('#bom-modal').querySelector('[data-bom-close]').onclick = closeBomModal;
  $('#bom-download').onclick = downloadBomExcel;
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && $('#bom-modal')?.classList.contains('open')) closeBomModal();
  });

  $('.catalog h1').textContent = 'Соберите свою систему.';
  $('.catalog > .muted').insertAdjacentHTML('afterend', `<section class="route-panel menu-fold">
    <button class="menu-fold-toggle" type="button" aria-expanded="true" aria-controls="route-panel-body"><span class="section-title">Автоподбор <span id="route-mode">линия</span></span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
    <div id="route-panel-body" class="menu-fold-body">
    <p class="muted small">Клик - прямой отрезок. Канализация соберется из труб и отводов каталога. Линия под углом врезает тройник, к гладкому концу того же диаметра труба садится своим раструбом.</p>
    <div class="presets route-diameters"><button type="button" data-route-diameter="110" class="active">Ø110</button><button type="button" data-route-diameter="50">Ø50</button></div>
    <button id="route-draw" type="button" aria-pressed="false">Рисовать линию</button>
    <label class="field-label" for="route-height">Высота по горизонтали</label>
    <div class="input-unit"><input id="route-height" type="number" step="10" value="100" aria-label="Высота горизонтального рисования, мм" /><span>мм</span></div>
    <p class="muted small">На последней точке три оси: X красная, Y зеленая вверх, Z синяя. Ведите курсор вдоль оси, Shift фиксирует ее. Правая кнопка - обзор.</p>
    <button id="route-build" class="primary" type="button" disabled>Построить канализацию</button>
    <div class="route-actions"><button id="route-undo" class="text-button" type="button" disabled>Шаг назад</button><button id="route-clear" class="text-button" type="button" disabled>Сбросить линию</button></div>
    <p id="route-meta" class="muted small">Кликните первую точку линии</p>
    </div>
  </section>`);
  $('.category .count').textContent = catalog.length;
  $('#add').outerHTML = `<div class="catalog-filters"><input id="catalog-search" type="search" placeholder="Найти элемент…" aria-label="Поиск по библиотеке" /><div class="presets"><button data-filter="all" class="active">Все · ${catalog.length}</button>${[110, 50].map((diameter) => `<button data-filter="${diameter}">Ø${diameter} · ${catalog.filter((item) => item.diameter === diameter).length}</button>`).join('')}</div></div><div id="catalog-list"></div>`;
  $('.catalog-filters').insertAdjacentHTML('beforeend', '<select id="catalog-kind" aria-label="Тип компонента"><option value="all">Все типы компонентов</option><option value="pipe">Трубы и патрубки</option><option value="elbow">Отводы</option><option value="tee">Тройники</option><option value="cross">Крестовины</option><option value="coupling">Муфты</option><option value="reducer">Переходы и редукции</option><option value="service">Сервисные элементы</option></select>');
  $('#viewport').insertAdjacentHTML('beforeend', '<label class="snap-toggle"><input id="snap-enabled" type="checkbox" checked /> Магнитная стыковка <span id="snap-status">до 90 мм</span></label>');
  $('.catalog-note p').textContent = 'При включённом магните новая деталь пристыкуется к выбранному свободному концу. При перетаскивании подведите совместимые концы ближе 90 мм и отпустите мышь.';
  $('.selected-heading .muted').textContent = 'Канализация · HT';
  document.querySelector('#properties > section').insertAdjacentHTML('afterend', '<section id="color-section"><div class="section-title">Цвет <span id="element-color-name">Серый</span></div><div id="element-colors" class="color-swatches" role="radiogroup" aria-label="Цвет выбранной детали"></div></section>');
  mountSwatches($('#element-colors'), (color) => onRecolor?.(color));
  syncColorSwatches($('#element-colors'), defaultPipeColor);
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
  $('#catalog-list').insertAdjacentHTML('beforebegin', '<div class="catalog-color"><div class="catalog-color-label"><span>Цвет новых деталей</span><strong id="catalog-color-name">Серый</strong></div><div id="catalog-colors" class="color-swatches" role="radiogroup" aria-label="Цвет новых деталей"></div></div>');
  mountSwatches($('#catalog-colors'), (color) => {
    catalogColor = color;
    $('#catalog-color-name').textContent = pipeColorById.get(color).name;
    syncColorSwatches($('#catalog-colors'), color);
  });
  syncColorSwatches($('#catalog-colors'), catalogColor);
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
  const library = document.createElement('section');
  library.className = 'menu-fold';
  const category = $('.category');
  const footer = $('.library-footer');
  category.parentElement.insertBefore(library, category);
  const libraryToggle = document.createElement('button');
  libraryToggle.type = 'button';
  libraryToggle.className = 'category menu-fold-toggle';
  libraryToggle.setAttribute('aria-expanded', 'true');
  libraryToggle.setAttribute('aria-controls', 'library-body');
  libraryToggle.innerHTML = `${category.innerHTML}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const libraryBody = document.createElement('div');
  libraryBody.id = 'library-body';
  libraryBody.className = 'menu-fold-body';
  let node = category.nextElementSibling;
  category.remove();
  while (node && node !== footer) {
    const next = node.nextElementSibling;
    libraryBody.append(node);
    node = next;
  }
  library.append(libraryToggle, libraryBody);
  document.querySelectorAll('.menu-fold-toggle').forEach((button) => button.addEventListener('click', () => {
    const fold = button.closest('.menu-fold');
    const collapsed = fold.classList.toggle('collapsed');
    button.setAttribute('aria-expanded', String(!collapsed));
  }));
  renderCatalog();
}
