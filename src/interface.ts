import type { CatalogItem } from './catalog.js';
import { editorStore } from './store.js';
import type { Object3D } from 'three';

export function initializeInterface(onAdd: (item: CatalogItem, length?: number) => void, onRecolor: (color: string) => void) {
  editorStore.setCommands(onAdd, onRecolor);
}

export const getCatalogColor = () => editorStore.catalogColor;
export const updateBillOfMaterials = (elements: Object3D[]) => editorStore.updateElements(elements);
export function syncColorSwatches(_container: HTMLElement, color: string) {
  editorStore.setSelectedColor(color);
}
