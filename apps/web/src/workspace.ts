import { parseProject, parseConnections } from './entities/project/model/project.js';

export interface WorkspaceProject { id: string; name: string; updated: string; data?: unknown }
export function readProjects(): WorkspaceProject[] {
  const value = JSON.parse(localStorage.getItem('complan.projects') || '[]');
  if (!Array.isArray(value)) throw new Error('Некорректный список проектов');
  return value.filter((item) => typeof item?.id === 'string' && typeof item.name === 'string' && typeof item.updated === 'string');
}
export function writeProjects(projects: WorkspaceProject[]) {
  localStorage.setItem('complan.projects', JSON.stringify(projects));
}
export function readProject(id: string) {
  const project = readProjects().find((item) => item.id === id);
  if (!project) throw new Error('Проект не найден');
  if (project.data) parseConnections(project.data, parseProject(project.data));
  return project;
}
