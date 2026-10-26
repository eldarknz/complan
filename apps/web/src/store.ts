import { makeAutoObservable, observable } from 'mobx';
import type { Object3D } from 'three';
import { catalog, type CatalogItem } from './catalog.js';
import { defaultPipeColor } from './elements.js';
import { summarizeBillOfMaterials } from './project.js';

export class EditorStore {
  query = '';
  diameter = 'all';
  kind = 'all';
  catalogColor = defaultPipeColor;
  selectedColor = defaultPipeColor;
  bomOpen = false;
  downloading = false;
  downloadError = '';
  rows: ReturnType<typeof summarizeBillOfMaterials> = [];
  lengths = new Map<string, number>();
  onAdd: ((item: CatalogItem, length?: number) => void) | null = null;
  onRecolor: ((color: string) => void) | null = null;

  constructor() {
    makeAutoObservable(this, { rows: observable.ref, onAdd: observable.ref, onRecolor: observable.ref }, { autoBind: true });
  }

  get filteredCatalog() {
    const primary = ['pipe', 'elbow', 'tee', 'cross', 'coupling', 'reducer'];
    const query = this.query.trim().toLocaleLowerCase();
    return catalog.filter((item) => (this.diameter === 'all' || item.diameter === +this.diameter)
      && (this.kind === 'all' || this.kind === item.kind || this.kind === 'service' && !primary.includes(item.kind))
      && `${item.name} ${item.description}`.toLocaleLowerCase().includes(query));
  }
  get total() { return this.rows.reduce((sum, row) => sum + row.quantity, 0); }
  setQuery(value: string) { this.query = value; }
  setDiameter(value: string) { this.diameter = value; }
  setKind(value: string) { this.kind = value; }
  setCatalogColor(value: string) { this.catalogColor = value; }
  setSelectedColor(value: string) { this.selectedColor = value; }
  setBomOpen(value: boolean) { this.bomOpen = value; }
  setDownloading(value: boolean) { this.downloading = value; }
  setDownloadError(value: string) { this.downloadError = value; }
  setLength(id: string, value: number) { this.lengths.set(id, value); }
  setCommands(onAdd: EditorStore['onAdd'], onRecolor: EditorStore['onRecolor']) {
    this.onAdd = onAdd;
    this.onRecolor = onRecolor;
  }
  add(item: CatalogItem) { this.onAdd?.(item, this.lengths.get(item.id) ?? item.length); }
  recolor(color: string) { this.onRecolor?.(color); }
  updateElements(elements: Object3D[]) { this.rows = summarizeBillOfMaterials(elements); }
}

export const editorStore = new EditorStore();
