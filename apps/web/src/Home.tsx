import { useEffect, useRef, useState } from 'react';
import { createRemoteProject, deleteRemoteProject, readProjects, readRemoteProjects, writeProjects, type WorkspaceProject } from './entities/project/model/workspace.js';
import './home.css';

export function Home() {
  const [projects, setProjects] = useState<WorkspaceProject[]>([]);
  const [error, setError] = useState('');
  const [name, setName] = useState('Пользователь');
  const [menu, setMenu] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState<WorkspaceProject | null>(null);
  const profile = useRef<HTMLDivElement>(null);
  const settings = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    try {
      setProjects(readProjects());
      void readRemoteProjects().then((remoteProjects) => { setProjects(remoteProjects); writeProjects(remoteProjects); }).catch(() => { /* Локальный список остаётся резервным. */ });
      setName(localStorage.getItem('complan.username') || 'Пользователь');
    }
    catch { setError('Не удалось прочитать локальные данные. Проверьте доступ к хранилищу браузера.'); }
    const close = (event: PointerEvent) => { if (!profile.current?.contains(event.target as Node)) setMenu(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);
  async function createProject() {
    try {
      const name = `Проект ${projects.length + 1}`;
      const document = { version: 3, units: 'mm', elements: [] as unknown[], connections: [] as unknown[] };
      const id = await createRemoteProject(name, document);
      const project = { id, name, updated: new Date().toISOString(), data: document };
      writeProjects([...projects, project]);
      window.location.assign(`?project=${project.id}`);
    } catch { setError('Не удалось сохранить проект. Проверьте доступ и свободное место в хранилище браузера.'); }
  }
  async function deleteProject(project: WorkspaceProject) {
    try {
      const next = projects.filter((item) => item.id !== project.id);
      await deleteRemoteProject(project.id);
      writeProjects(next);
      setProjects(next);
      setProjectToDelete(null);
    } catch { setError('Не удалось удалить проект. Проверьте доступ к хранилищу браузера.'); }
  }
  return <div className="home">
    <aside className="home-sidebar">
      <a className="brand" href="./"><span className="brand-icon">C</span>COMPLAN<span className="beta">LAB</span></a>
      <div className="home-nav"><span>РАБОЧЕЕ ПРОСТРАНСТВО</span><a href="./" aria-current="page">▦ <span>Мои проекты</span><b>{projects.length}</b></a></div>
      <div className="home-profile" ref={profile} onKeyDown={(event) => { if (event.key === 'Escape') { setMenu(false); profile.current?.querySelector('button')?.focus(); } }}>
        <button className="profile-button" aria-expanded={menu} aria-controls="profile-menu" onClick={() => setMenu(!menu)}><span className="home-avatar">{name.slice(0, 1).toUpperCase()}</span><span><strong>{name}</strong><small>Локальный профиль</small></span><span className="profile-chevron">⌃</span></button>
        {menu && <div id="profile-menu" className="profile-menu"><button onClick={() => { setMenu(false); settings.current?.showModal(); }}>Настройки</button><button onClick={() => { setMenu(false); setSignedOut(true); }}>Выход</button></div>}
      </div>
    </aside>
    <main className="home-main">
      <div className="home-topline">Ваше пространство для инженерных идей <span>COMPLAN / ПРОЕКТЫ</span></div>
      {signedOut ? <section className="home-projects"><p className="eyebrow">ЛОКАЛЬНЫЙ ПРОФИЛЬ</p><h1>Работа завершена</h1><p>Проекты сохранены в этом браузере. Вы можете вернуться к ним в любой момент.</p><button className="home-primary" onClick={() => setSignedOut(false)}>Вернуться к проектам</button></section> : <section className="home-projects">
        <div className="home-heading"><div><p className="eyebrow">ПРОЕКТИРУЙТЕ В ПРОСТРАНСТВЕ</p><h1>Мои проекты<span>.</span></h1><p>От первого соединения до готовой системы.</p></div><button className="home-primary" onClick={createProject}>＋ Новый проект</button></div>
        {error && <p role="alert">{error}</p>}
        <div className="home-section-label"><span>Все проекты <b>{projects.length}</b></span><span>Хранятся в этом браузере</span></div>
        <div className="project-grid">
          {projects.map((project) => <div className="project-card" key={project.id}><a href={`?project=${encodeURIComponent(project.id)}`}><div className="project-preview" aria-hidden="true"><span className="pipe-art" /><span className="preview-label">3D / HT</span></div><div className="project-card-info"><h2>{project.name}</h2><p>Канализационная система <span>↗</span></p><small>Изменён {new Date(project.updated).toLocaleDateString('ru-RU')}</small></div></a><button className="project-delete" type="button" aria-label={`Удалить проект ${project.name}`} onClick={() => setProjectToDelete(project)}>Удалить</button></div>)}
          <button className="project-create" onClick={createProject}><span>＋</span><strong>Создать проект</strong><small>Начните с чистого пространства</small></button>
        </div>
        {!projects.length && <p className="home-empty">Здесь будут ваши проекты. Создайте первый, чтобы начать собирать систему в 3D.</p>}
      </section>}
      <footer className="home-footer"><span><i /> Всё начинается с правильного соединения</span><span>3D-планировщик коммуникаций</span></footer>
    </main>
    <dialog ref={settings} className="home-settings"><form onSubmit={(event) => { event.preventDefault(); const value = String(new FormData(event.currentTarget).get('name')).trim(); if (!value) return; try { localStorage.setItem('complan.username', value); setName(value); settings.current?.close(); } catch { setError('Не удалось сохранить настройки.'); settings.current?.close(); } }}><h2>Настройки профиля</h2><label>Имя пользователя<input name="name" defaultValue={name} key={name} required maxLength={60} /></label><p>Профиль и проекты доступны только в этом браузере.</p><div><button type="button" onClick={() => settings.current?.close()}>Отмена</button><button className="home-primary" type="submit">Сохранить</button></div></form></dialog>
    {projectToDelete && <div className="delete-modal" role="dialog" aria-modal="true" aria-labelledby="delete-title"><button className="delete-modal-backdrop" aria-label="Закрыть" onClick={() => setProjectToDelete(null)} /><div className="delete-modal-card"><p className="eyebrow">УДАЛЕНИЕ ПРОЕКТА</p><h2 id="delete-title">Удалить «{projectToDelete.name}»?</h2><p>Проект и все сохранённые компоненты будут удалены без возможности восстановления.</p><div><button type="button" onClick={() => setProjectToDelete(null)}>Отмена</button><button className="delete-confirm" type="button" onClick={() => void deleteProject(projectToDelete)}>Удалить проект</button></div></div></div>}
  </div>;
}
