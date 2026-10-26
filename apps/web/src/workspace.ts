import { parseProject, parseConnections } from './entities/project/model/project.js';
import axios from 'axios';

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

const apiUrl = (import.meta.env.VITE_API_URL || 'http://localhost:8080').replace(/\/$/, '');
export async function createRemoteProject(name: string, document: unknown) {
  const response = await axios.post<{ id: string }>(`${apiUrl}/api/v1/projects`, { name, document });
  return response.data.id;
}
export async function readRemoteProjects() {
  const response = await axios.get<WorkspaceProject[]>(`${apiUrl}/api/v1/projects`);
  return response.data;
}
export async function readRemoteProject(id: string) {
  const response = await axios.get<{ id: string; name: string; document: unknown }>(`${apiUrl}/api/v1/projects/${encodeURIComponent(id)}`);
  return response.data;
}
export async function saveRemoteProject(id: string, name: string, document: unknown) {
  await axios.put(`${apiUrl}/api/v1/projects/${encodeURIComponent(id)}`, { name, document });
}
export async function clearRemoteProject(id: string) {
  await axios.post(`${apiUrl}/api/v1/projects/${encodeURIComponent(id)}/clear`);
}
export async function deleteRemoteProject(id: string) {
  await axios.delete(`${apiUrl}/api/v1/projects/${encodeURIComponent(id)}`);
}
