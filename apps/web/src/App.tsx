import { useEffect, useRef, useState, type PropsWithChildren } from 'react';
import { observer } from 'mobx-react-lite';
import { catalog } from './entities/catalog/model/catalog.js';
import { pipeColors, pipeColorById } from './entities/element/model/elements.js';
import { billOfMaterialsToAoa } from './entities/project/model/project.js';
import { initializeEditor } from './widgets/editor/model/editor.js';
import { editorStore as store } from './widgets/editor/model/store.js';
import { Home } from './pages/home/ui/Home.js';

function Icon({ path }: { path: string }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d={path} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function Fold({ id, title, children }: PropsWithChildren<{ id: string; title: React.ReactNode }>) {
  const [open, setOpen] = useState(true);
  return <section className={`menu-fold ${id === 'route-panel-body' ? 'route-panel' : ''} ${open ? '' : 'collapsed'}`}>
    <button className="category menu-fold-toggle" type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>{title}<Icon path="M6 9l6 6 6-6" /></button>
    <div id={id} className="menu-fold-body">{children}</div>
  </section>;
}

const Swatches = observer(({ selected = false }: { selected?: boolean }) => {
  const value = selected ? store.selectedColor : store.catalogColor;
  return <div id={selected ? 'element-colors' : 'catalog-colors'} className="color-swatches" role="radiogroup" aria-label={selected ? 'Цвет выбранной детали' : 'Цвет новых деталей'}>
    {pipeColors.map((color) => <button key={color.id} type="button" data-color={color.id} role="radio" aria-label={color.name} title={color.name} aria-checked={value === color.id} className={value === color.id ? 'active' : ''} onClick={() => selected ? store.recolor(color.id) : store.setCatalogColor(color.id)}><i style={{ background: color.hex }} /></button>)}
  </div>;
});

const Catalog = observer(() => {
  const symbols: Record<string, string> = { pipe: '━', tee: '┳', cross: '╋', elbow: '╰', inspection: '⊕', coupling: '═', cap: '⊣', toilet: '◎', clamp: 'Ω', fire: '▣', sleeve: '▤', roof: '△', reducer: '⋙', drain: '▦', funnel: '▽', vacuum: '⊤', check: '▸' };
  return <>
    <div className="catalog-filters">
      <input id="catalog-search" type="search" placeholder="Найти элемент…" aria-label="Поиск по библиотеке" value={store.query} onChange={(e) => store.setQuery(e.target.value)} />
      <div className="presets">{['all', '110', '50'].map((value) => <button key={value} data-filter={value} className={store.diameter === value ? 'active' : ''} onClick={() => store.setDiameter(value)}>{value === 'all' ? `Все · ${catalog.length}` : `Ø${value} · ${catalog.filter((item) => item.diameter === +value).length}`}</button>)}</div>
      <select id="catalog-kind" aria-label="Тип компонента" value={store.kind} onChange={(e) => store.setKind(e.target.value)}>
        {Object.entries({ all: 'Все типы компонентов', pipe: 'Трубы и патрубки', elbow: 'Отводы', tee: 'Тройники', cross: 'Крестовины', coupling: 'Муфты', reducer: 'Переходы и редукции', service: 'Сервисные элементы' }).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
    </div>
    <div className="catalog-color"><div className="catalog-color-label"><span>Цвет новых деталей</span><strong id="catalog-color-name">{pipeColorById.get(store.catalogColor)?.name}</strong></div><Swatches /></div>
    <div id="catalog-list">{store.filteredCatalog.map((item) => <div key={item.id} className="catalog-entry">
      <button className="catalog-item" data-type-id={item.id} onClick={() => store.add(item)}><span className="catalog-symbol">{symbols[item.kind]}</span><span><strong>{item.name}</strong><small>{item.description || (item.accessory ? 'Монтажный элемент' : 'Внутренняя канализация · HT')}</small></span><span className="catalog-plus">+</span></button>
      {item.lengths && <select aria-label={`Длина ${item.name}`} value={store.lengths.get(item.id) ?? item.length} onChange={(e) => store.setLength(item.id, +e.target.value)}>{item.lengths.map((length) => <option key={length} value={length}>{length} мм</option>)}</select>}
    </div>)}{!store.filteredCatalog.length && 'Элементы не найдены'}</div>
  </>;
});

function RoutePanel() {
  return <Fold id="route-panel-body" title={<span className="section-title">Автоподбор <span id="route-mode">линия</span></span>}>
    <p className="muted small">Клик - прямой отрезок. Канализация соберется из труб и отводов каталога. Линия под углом врезает тройник, к гладкому концу того же диаметра труба садится своим раструбом.</p>
    <div className="presets route-diameters"><button type="button" data-route-diameter="110" className="active">Ø110</button><button type="button" data-route-diameter="50">Ø50</button></div>
    <button id="route-draw" type="button" aria-pressed="false">Рисовать линию</button>
    <label className="field-label" htmlFor="route-height">Высота по горизонтали</label><div className="input-unit"><input id="route-height" type="number" step="10" defaultValue="100" aria-label="Высота горизонтального рисования, мм" /><span>мм</span></div>
    <p className="muted small">На последней точке три оси: X красная, Y зеленая вверх, Z синяя. Ведите курсор вдоль оси, Shift фиксирует ее. Правая кнопка - обзор.</p>
    <button id="route-build" className="primary" type="button" disabled>Построить канализацию</button>
    <div className="route-actions"><button id="route-undo" className="text-button" type="button" disabled>Шаг назад</button><button id="route-clear" className="text-button" type="button" disabled>Сбросить линию</button></div><p id="route-meta" className="muted small">Кликните первую точку линии</p>
  </Fold>;
}

const BomButton = observer(() => <button id="bom-open" className="quiet" type="button" title="Спецификация" aria-label="Спецификация" onClick={() => store.setBomOpen(true)}><Icon path="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" /><span id="bom-total">{store.total}</span></button>);

const BomModal = observer(() => {
  const close = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!store.bomOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    close.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); store.setBomOpen(false); }
      if (event.key === 'Tab') {
        const buttons = dialog.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
        if (!buttons?.length) return;
        const first = buttons[0], last = buttons[buttons.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); previous?.focus(); };
  }, [store.bomOpen]);
  async function download() {
    store.setDownloading(true);
    store.setDownloadError('');
    try {
      const XLSX = await import('xlsx');
      const sheet = XLSX.utils.aoa_to_sheet(billOfMaterialsToAoa(store.rows));
      sheet['!cols'] = [{ wch: 5 }, { wch: 36 }, { wch: 12 }, { wch: 12 }, { wch: 22 }];
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book, sheet, 'Спецификация');
      XLSX.writeFile(book, 'complan-specifikaciya.xlsx');
    } catch { store.setDownloadError('Не удалось скачать спецификацию. Попробуйте ещё раз.'); }
    finally { store.setDownloading(false); }
  }
  return <div id="bom-modal" className={`bom-modal ${store.bomOpen ? 'open' : ''}`} aria-hidden={!store.bomOpen} role="dialog" aria-modal="true" aria-labelledby="bom-title">
    <div className="bom-backdrop" data-bom-close onClick={() => store.setBomOpen(false)} />
    <div className="bom-dialog" ref={dialog}>
      <div className="bom-dialog-header"><div><p className="eyebrow">ПРОЕКТ</p><h2 id="bom-title">Спецификация</h2></div><button ref={close} id="bom-close" className="quiet" type="button" aria-label="Закрыть" onClick={() => store.setBomOpen(false)}>✕</button></div>
      <div id="bom-list" className="bom-list">{store.rows.length ? <table className="bom-table"><thead><tr><th>№</th><th>Наименование</th><th>Длина</th><th>Кол-во</th></tr></thead><tbody>{store.rows.map((row, index) => <tr key={index}><td>{index + 1}</td><td>{row.name}</td><td>{row.showLength ? `${row.length} мм` : '-'}</td><td>× {row.quantity}</td></tr>)}</tbody></table> : <p className="bom-empty">Пока нет добавленных элементов</p>}</div>
      {store.downloadError && <p role="alert">{store.downloadError}</p>}
      <div className="bom-dialog-footer"><button id="bom-download" className="primary" type="button" disabled={!store.rows.length || store.downloading} onClick={download}>Скачать в Excel</button></div>
    </div>
  </div>;
});

function Header() {
  return <header><a className="brand" href="./"><span className="brand-icon">C</span>COMPLAN<span className="beta">LAB</span></a><div className="project-name">Канализационная система <span>/</span> Новый проект</div>
    <button id="undo" className="quiet" type="button" title="Отменить, Cmd/Ctrl+Z" aria-label="Отменить действие" disabled><Icon path="M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H12" /></button>
    <button id="redo" className="quiet" type="button" title="Повторить, Cmd/Ctrl+Shift+Z" aria-label="Повторить действие" disabled><Icon path="M15 14l5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H12" /></button><BomButton />
    <button id="save" className="quiet" type="button" title="Сохранить проект" aria-label="Сохранить проект"><Icon path="M12 4v10M8 10l4 4 4-4M5 19h14" /></button>
    <button id="load" className="quiet" type="button" title="Открыть" aria-label="Открыть"><Icon path="M4 8h5l2 2h9v9H4z" /></button>
    <button id="delete-all" className="quiet" type="button" title="Удалить все" aria-label="Удалить все"><Icon path="M4 7h16M9 7V5h6v2M7 7l1 13h8l1-13" /></button><input id="file" type="file" accept="application/json,.json" hidden />
  </header>;
}

function Viewport() {
  return <main id="viewport">
    <div className="scene-top"><div><span className="status-dot" /> 3D-редактор <span className="divider">/</span><span id="object-count">1 элемент</span></div><div className="view-buttons"><button data-view="perspective" className="active">Перспектива</button><button data-view="top">Сверху</button><button data-view="front">Спереди</button></div></div>
    <div className="scene-caption"><span>ПРОСТРАНСТВО ПРОЕКТА</span><strong>Всё начинается<br />с правильного соединения.</strong></div>
    <div className="toolbar"><button id="move" className="active" title="Перемещение (W)">✥ <span>Переместить</span><kbd>W</kbd></button><button id="rotate" title="Поворот (E)">↻ <span>Повернуть</span><kbd>E</kbd></button><div className="tool-divider" /><button id="focus" title="Показать весь проект (F)">⊙ <span>Вписать</span><kbd>F</kbd></button></div>
    <div className="scene-bottom"><span>ЛКМ — выбор / орбита · ПКМ — панорама · Колесо — масштаб</span><span>Сетка 100 мм <b>·</b> XYZ</span></div><div id="toast" role="status" />
    <label className="snap-toggle"><input id="snap-enabled" type="checkbox" defaultChecked /> Магнитная стыковка <span id="snap-status">до 90 мм</span></label>
  </main>;
}

function Inspector() {
  return <aside className="inspector"><div className="eyebrow">СВОЙСТВА ЭЛЕМЕНТА</div><div className="selected-heading"><div className="element-icon">◉</div><div><h2 id="selection-name">Труба 01</h2><span className="muted">Канализация · HT</span></div><span className="selected-dot" /></div>
    <div id="properties">
      <div className="assembly-status"><p id="assembly-status" className="muted small" /><button id="detach-element" type="button" hidden>Отсоединить деталь</button>
        <div id="joint-rotation" hidden><label className="field-label" htmlFor="rotation-scope">Что вращать</label><select id="rotation-scope"><option value="joint">Деталь вокруг стыка</option><option value="assembly">Всю сборку</option></select>
          <div id="joint-settings"><label className="field-label" htmlFor="rotation-port">Ось соединения</label><select id="rotation-port" /><p className="muted small">Нажмите E и тяните кольцо. Вращается выбранная сторона стыка, другая остаётся на месте.</p><label className="field-label" htmlFor="joint-angle">Повернуть на, °</label><div className="joint-angle-row"><input id="joint-angle" type="number" min="-360" max="360" step="15" defaultValue="90" /><button id="apply-joint-angle" type="button">Повернуть</button></div></div>
        </div>
      </div>
      <section><div className="section-title">Геометрия <span>мм</span></div><div className="diameter"><span>Наружный диаметр</span><strong id="element-diameter">110 <small>мм</small></strong></div><label className="field-label" htmlFor="length">Длина трубы</label><div className="input-unit"><input id="length" type="number" min="150" max="6000" step="50" defaultValue="1000" /><span>мм</span></div><div className="presets"><button data-length="500">500</button><button data-length="1000" className="active">1000</button><button data-length="2000">2000</button></div></section>
      <section id="color-section"><div className="section-title">Цвет <span id="element-color-name">Серый</span></div><Swatches selected /></section>
      <section><div className="section-title">Положение <span>мм</span></div><div className="axis-fields" id="position-fields" /></section>
      <section><div className="section-title">Поворот <span>градусы</span></div><div className="axis-fields" id="rotation-fields" /><button id="reset-rotation" className="text-button">↺ Сбросить поворот</button></section>
      <section><div className="section-title">Соединение <span className="badge">ТОЧКИ</span></div><p className="muted small">Нажмите точку на детали или выберите конец ниже. Соединённые детали перемещаются вместе.</p>
        <label className="field-label" htmlFor="port-select">Точка выбранной детали</label><select id="port-select" />
        <div id="join-controls"><label className="field-label" htmlFor="join-mode">Что присоединить</label><select id="join-mode"><option value="new">Новый элемент из библиотеки</option><option value="existing">Элемент из сцены</option></select><label className="field-label" htmlFor="target-select">Присоединяемый элемент</label><select id="target-select" /><label className="field-label" htmlFor="target-port">Конец присоединяемой детали</label><select id="target-port" /><label className="field-label" htmlFor="join-roll">Поворот вокруг стыка, °</label><input id="join-roll" type="number" min="-360" max="360" step="15" defaultValue="0" /></div>
        <div id="occupied-controls" hidden><p className="muted small">Повернуть выбранную сторону сборки вокруг этого стыка:</p><div className="presets"><button id="twist-minus">−15°</button><button id="twist-plus">+15°</button><button id="twist-quarter">+90°</button></div><button id="disconnect" className="text-button">Разъединить стык</button></div>
        <button id="connect" className="primary">＋ Присоединить элемент</button><p className="connection-note">Глубина вставки — 60 мм</p>
      </section><div className="actions"><button id="duplicate">⧉ Копировать</button><button id="delete" className="danger">Удалить</button></div>
    </div><div id="empty-selection" hidden>Выберите трубу в сцене или добавьте новую из библиотеки.</div><div className="inspector-footer">Эскизные модели HT Ø110 / Ø50<br /><span>Монтажные размеры уточняйте по каталогу производителя.</span></div>
  </aside>;
}

function Editor() {
  useEffect(() => initializeEditor(), []);
  return <><Header /><aside className="catalog"><div className="eyebrow">БИБЛИОТЕКА ЭЛЕМЕНТОВ</div><h1>Соберите свою систему.</h1><p className="muted">Добавляйте элементы и собирайте коммуникации в пространстве.</p><RoutePanel /><Fold id="library-body" title={<>◉ <span>Канализация</span><span className="count">{catalog.length}</span></>}><Catalog /><div className="catalog-note"><span>↗</span><p>При включённом магните новая деталь пристыкуется к выбранному свободному концу. При перетаскивании подведите совместимые концы ближе 90 мм и отпустите мышь.</p></div></Fold><div className="library-footer"><span className="status-dot" /> Локальный проект · без регистрации</div></aside><Viewport /><Inspector /><BomModal /></>;
}

export function App() {
  const params = new URLSearchParams(window.location.search);
  return params.has('project') || params.has('editor') ? <Editor /> : <Home />;
}
