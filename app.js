const STORAGE_KEY = 'ritmo.tasks.v1';
const THEME_KEY = 'ritmo.theme';
const state = { view: 'day', status: 'all', tasks: loadTasks(), reminderTimers: new Map() };

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const labels = { day: 'Hoje', week: 'Semana', month: 'Mês' };

function loadTasks() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
  catch { return []; }
}

function saveTasks() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.tasks));
  scheduleReminders();
}

function escapeHtml(value) {
  const node = document.createElement('div');
  node.textContent = value;
  return node.innerHTML;
}

function render() {
  const settings = state.view === 'settings';
  $('#settingsView').hidden = !settings;
  $('.task-section').hidden = settings;
  $('.toolbar').hidden = settings;
  $('.progress-panel').hidden = settings;
  $('.add-button').hidden = settings;
  $('#viewTitle').textContent = settings ? 'Ajustes' : labels[state.view];
  $$('.bottom-nav button').forEach(button => button.classList.toggle('active', button.dataset.view === state.view));
  if (settings) return;

  const categoryTasks = state.tasks.filter(task => task.category === state.view);
  const visible = categoryTasks.filter(task => state.status === 'all' || (state.status === 'done' ? task.done : !task.done));
  const completed = categoryTasks.filter(task => task.done).length;
  const percent = categoryTasks.length ? Math.round(completed / categoryTasks.length * 100) : 0;
  $('#progressRing').style.setProperty('--progress', percent);
  $('#progressRing').setAttribute('aria-valuenow', percent);
  $('#progressPercent').textContent = `${percent}%`;
  $('#progressText').textContent = `${completed} de ${categoryTasks.length} tarefas`;
  $('#progressHint').textContent = percent === 100 && categoryTasks.length ? 'Feito. Seu tempo voltou para você.' : 'Escolha o que merece sua atenção agora.';
  $('#taskCount').textContent = String(visible.length);
  $('#emptyState').hidden = visible.length > 0;
  $('#taskList').innerHTML = visible.map(taskTemplate).join('');
  bindTaskGestures();
}

function taskTemplate(task) {
  return `<article class="task-card${task.done ? ' done' : ''}" data-id="${task.id}">
    <div class="task-delete-bg">Excluir</div>
    <div class="task-content">
      <button class="check-button" type="button" aria-label="${task.done ? 'Marcar como pendente' : 'Concluir tarefa'}" data-check><span>✓</span></button>
      <div class="task-info"><strong class="task-title">${escapeHtml(task.title)}</strong><div class="task-meta"><span>${labels[task.category]}</span>${task.time ? `<span class="task-time">${task.time}</span>` : ''}${task.reminder ? '<span>Lembrete ativo</span>' : ''}</div></div>
      <button class="edit-button" type="button" data-edit aria-label="Editar tarefa">•••</button>
    </div>
  </article>`;
}

function bindTaskGestures() {
  $$('.task-card').forEach(card => {
    const id = card.dataset.id;
    card.querySelector('[data-check]').addEventListener('click', () => toggleTask(id));
    card.querySelector('[data-edit]').addEventListener('click', () => openEditor(id));
    const content = card.querySelector('.task-content');
    let startX = 0, currentX = 0, dragging = false;
    content.addEventListener('pointerdown', event => { if (event.target.closest('button')) return; startX = event.clientX; dragging = true; content.setPointerCapture(event.pointerId); });
    content.addEventListener('pointermove', event => { if (!dragging) return; currentX = Math.min(0, Math.max(-110, event.clientX - startX)); content.style.transform = `translateX(${currentX}px)`; });
    content.addEventListener('pointerup', () => { if (!dragging) return; dragging = false; if (currentX < -78) removeTask(id, card); else content.style.transform = ''; currentX = 0; });
    content.addEventListener('pointercancel', () => { dragging = false; currentX = 0; content.style.transform = ''; });
  });
}

function toggleTask(id) {
  const task = state.tasks.find(item => item.id === id);
  if (!task) return;
  task.done = !task.done;
  task.completedAt = task.done ? Date.now() : null;
  saveTasks(); render();
  if (navigator.vibrate) navigator.vibrate(18);
}

function removeTask(id, card) {
  card.classList.add('removing');
  setTimeout(() => { state.tasks = state.tasks.filter(task => task.id !== id); saveTasks(); render(); showToast('Tarefa excluída'); }, 230);
}

function openEditor(id = '') {
  const task = state.tasks.find(item => item.id === id);
  $('#taskId').value = task?.id || '';
  $('#taskTitle').value = task?.title || '';
  $('#taskCategory').value = task?.category || (state.view === 'settings' ? 'day' : state.view);
  $('#taskTime').value = task?.time || '';
  $('#taskReminder').checked = Boolean(task?.reminder);
  $('#sheetTitle').textContent = task ? 'Editar tarefa' : 'Nova tarefa';
  $('#deleteEditor').hidden = !task;
  $('#sheetBackdrop').hidden = false;
  $('#taskSheet').hidden = false;
  setTimeout(() => $('#taskTitle').focus(), 80);
}

function closeEditor() { $('#taskSheet').hidden = true; $('#sheetBackdrop').hidden = true; $('#taskForm').reset(); }

async function submitTask() {
  const title = $('#taskTitle').value.trim();
  if (!title) { $('#taskTitle').focus(); return; }
  const reminder = $('#taskReminder').checked;
  if (reminder && !$('#taskTime').value) { showToast('Escolha um horário para o lembrete'); return; }
  if (reminder && !(await requestNotifications())) return;
  const id = $('#taskId').value;
  const values = { title, category: $('#taskCategory').value, time: $('#taskTime').value, reminder };
  if (id) Object.assign(state.tasks.find(task => task.id === id), values, { updatedAt: Date.now() });
  else state.tasks.unshift({ id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`, ...values, done: false, createdAt: Date.now(), completedAt: null });
  saveTasks(); closeEditor(); state.view = values.category; render(); showToast(id ? 'Tarefa atualizada' : 'Tarefa criada');
}

async function requestNotifications() {
  if (!('Notification' in window)) { showToast('Notificações não são suportadas neste navegador'); return false; }
  const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
  updateNotificationStatus();
  if (permission !== 'granted') { showToast('Permita notificações para ativar lembretes'); return false; }
  showToast('Notificações ativadas'); return true;
}

function scheduleReminders() {
  state.reminderTimers.forEach(clearTimeout); state.reminderTimers.clear();
  const now = new Date();
  state.tasks.filter(task => task.reminder && task.time && !task.done).forEach(task => {
    const [hours, minutes] = task.time.split(':').map(Number);
    const when = new Date(); when.setHours(hours, minutes, 0, 0);
    if (when <= now) when.setDate(when.getDate() + 1);
    const delay = when - now;
    if (delay > 2147483647) return;
    state.reminderTimers.set(task.id, setTimeout(() => {
      if (Notification.permission === 'granted') new Notification('Ritmo', { body: task.title, icon: 'icons/icon-192.png', tag: task.id });
    }, delay));
  });
}

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(THEME_KEY, theme);
  $('#themeToggle').checked = theme === 'light';
  document.querySelector('meta[name="theme-color"]').content = theme === 'light' ? '#f5f4f8' : '#0f0f0f';
}

function updateNotificationStatus() { $('#notificationStatus').textContent = !('Notification' in window) ? 'Indisponível' : Notification.permission === 'granted' ? 'Ativas' : Notification.permission === 'denied' ? 'Bloqueadas' : 'Configurar'; }
let toastTimer;
function showToast(message) { const toast = $('#toast'); toast.textContent = message; toast.classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('visible'), 2400); }

function init() {
  $('#dateLabel').textContent = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
  setTheme(localStorage.getItem(THEME_KEY) || 'dark');
  updateNotificationStatus(); scheduleReminders(); render();
  $$('[data-open-editor]').forEach(button => button.addEventListener('click', () => openEditor()));
  $('.bottom-nav').addEventListener('click', event => { const button = event.target.closest('[data-view]'); if (!button) return; state.view = button.dataset.view; render(); });
  $('#statusFilters').addEventListener('click', event => { const button = event.target.closest('[data-status]'); if (!button) return; state.status = button.dataset.status; $$('#statusFilters button').forEach(item => item.classList.toggle('active', item === button)); render(); });
  $('#saveTask').addEventListener('click', submitTask);
  $('#taskForm').addEventListener('submit', event => { event.preventDefault(); submitTask(); });
  $('#cancelEditor').addEventListener('click', closeEditor); $('#sheetBackdrop').addEventListener('click', closeEditor);
  $('#deleteEditor').addEventListener('click', () => { const card = document.querySelector(`[data-id="${$('#taskId').value}"]`); if (card) removeTask($('#taskId').value, card); else { state.tasks = state.tasks.filter(task => task.id !== $('#taskId').value); saveTasks(); render(); } closeEditor(); });
  $('#themeButton').addEventListener('click', () => setTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light'));
  $('#themeToggle').addEventListener('change', event => setTheme(event.target.checked ? 'light' : 'dark'));
  $('#notificationButton').addEventListener('click', requestNotifications);
  $('#clearButton').addEventListener('click', () => { if (!confirm('Apagar todas as tarefas deste aparelho?')) return; state.tasks = []; saveTasks(); render(); showToast('Todas as tarefas foram apagadas'); });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => showToast('Modo offline não pôde ser ativado'));
}

document.addEventListener('DOMContentLoaded', init);
