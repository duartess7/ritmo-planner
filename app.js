const STORAGE_KEY = 'ritmo.tasks.v1';
const THEME_KEY = 'ritmo.theme';
const state = { view: 'day', status: 'pending', query: '', selectedDate: '', tasks: loadTasks(), reminderTimers: new Map(), focusSeconds: 1500, focusTimer: null };

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
  $('.quick-capture').hidden = settings;
  $('#settingsView').hidden = !settings;
  $('.task-section').hidden = settings;
  $('.toolbar').hidden = settings;
  $('.progress-panel').hidden = settings;
  $('.add-button').hidden = settings;
  $('#viewTitle').textContent = settings ? 'Ajustes' : labels[state.view];
  $$('.bottom-nav button').forEach(button => button.classList.toggle('active', button.dataset.view === state.view));
  if (settings) return;

  renderCalendar();
  const categoryTasks = state.tasks.filter(task => task.category === state.view && taskBelongsToView(task));
  const visible = categoryTasks.filter(task => {
    const statusMatch = state.status === 'all' || (state.status === 'done' ? task.done : !task.done);
    const haystack = `${task.title} ${task.notes || ''} ${(task.tags || []).join(' ')}`.toLowerCase();
    return statusMatch && haystack.includes(state.query.toLowerCase());
  });
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
  const tags = (task.tags || []).map(tag => `#${escapeHtml(tag)}`).join(' ');
  return `<article class="task-card${task.done ? ' done' : ''} priority-${task.priority || 'none'}" data-id="${task.id}">
    <div class="task-delete-bg">Excluir</div>
    <div class="task-content">
      <button class="check-button" type="button" aria-label="${task.done ? 'Marcar como pendente' : 'Concluir tarefa'}" data-check><span>✓</span></button>
      <div class="task-info"><strong class="task-title">${escapeHtml(task.title)}</strong>${task.notes ? `<span class="task-note">${escapeHtml(task.notes)}</span>` : ''}<div class="task-meta"><i class="priority-mark"></i><span>${task.date ? formatShortDate(task.date) : labels[task.category]}</span>${task.time ? `<span class="task-time">${task.time}</span>` : ''}${task.repeat && task.repeat !== 'none' ? '<span>↻</span>' : ''}${tags ? `<span class="task-tags">${tags}</span>` : ''}</div></div>
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
  if (task.done && task.repeat && task.repeat !== 'none') createNextOccurrence(task);
  saveTasks();
  const card = document.querySelector(`[data-id="${id}"]`);
  const leavesCurrentFilter = (state.status === 'pending' && task.done) || (state.status === 'done' && !task.done);
  if (card) card.classList.toggle('done', task.done);
  if (card && leavesCurrentFilter) {
    card.classList.add('completing');
    setTimeout(render, 360);
  } else render();
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
  $('#taskDate').value = task?.date || localDate();
  $('#taskPriority').value = task?.priority || 'none';
  $('#taskNotes').value = task?.notes || '';
  $('#taskTags').value = (task?.tags || []).join(', ');
  $('#taskRepeat').value = task?.repeat || 'none';
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
  const values = { title, category: $('#taskCategory').value, time: $('#taskTime').value, date: $('#taskDate').value, priority: $('#taskPriority').value, notes: $('#taskNotes').value.trim(), tags: $('#taskTags').value.split(',').map(tag => tag.trim()).filter(Boolean).slice(0, 6), repeat: $('#taskRepeat').value, reminder };
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
    const when = task.date ? new Date(`${task.date}T${task.time}:00`) : new Date();
    if (!task.date) when.setHours(hours, minutes, 0, 0);
    if (when <= now && task.repeat === 'daily') when.setDate(when.getDate() + 1);
    const delay = when - now;
    if (delay > 2147483647) return;
    state.reminderTimers.set(task.id, setTimeout(() => {
      if (Notification.permission === 'granted') notify('Ritmo', task.title, task.id);
    }, delay));
  });
}

function localDate(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function taskBelongsToView(task) {
  if (!task.date) return true;
  if (state.selectedDate) return task.date === state.selectedDate;
  const today = new Date();
  const date = new Date(`${task.date}T12:00:00`);
  if (state.view === 'day') return task.date === localDate(today);
  if (state.view === 'week') {
    const start = new Date(today);
    start.setHours(12, 0, 0, 0);
    start.setDate(today.getDate() - ((today.getDay() + 6) % 7));
    const end = new Date(start);
    end.setDate(start.getDate() + 7);
    return date >= start && date < end;
  }
  if (state.view === 'month') return date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth();
  return true;
}

function formatShortDate(value) {
  return new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short' }).format(new Date(`${value}T12:00:00`));
}

function renderCalendar() {
  const days = [];
  const today = new Date();
  const start = new Date(today);
  if (state.view === 'week') start.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  else if (state.view === 'month') start.setDate(1);
  else start.setDate(today.getDate() - 3);
  const dayCount = state.view === 'month' ? 35 : 7;
  for (let index = 0; index < dayCount; index += 1) {
    const date = new Date(start); date.setDate(start.getDate() + index);
    const value = localDate(date);
    const active = state.selectedDate ? state.selectedDate === value : value === localDate(today);
    days.push(`<button class="calendar-day${active ? ' active' : ''}" type="button" data-date="${value}"><span>${new Intl.DateTimeFormat('pt-BR', { weekday: 'short' }).format(date).replace('.', '')}</span><strong>${date.getDate()}</strong></button>`);
  }
  $('#calendarStrip').innerHTML = days.join('');
  $$('#calendarStrip button').forEach(button => button.addEventListener('click', () => { state.selectedDate = state.selectedDate === button.dataset.date ? '' : button.dataset.date; render(); }));
}

function createNextOccurrence(task) {
  const base = task.date ? new Date(`${task.date}T12:00:00`) : new Date();
  if (task.repeat === 'daily') base.setDate(base.getDate() + 1);
  if (task.repeat === 'weekly') base.setDate(base.getDate() + 7);
  if (task.repeat === 'monthly') base.setMonth(base.getMonth() + 1);
  const nextDate = localDate(base);
  if (state.tasks.some(item => item.repeatParent === task.id && item.date === nextDate)) return;
  state.tasks.unshift({ ...task, id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`, date: nextDate, done: false, completedAt: null, createdAt: Date.now(), repeatParent: task.id });
}

async function notify(title, body, tag) {
  if ('serviceWorker' in navigator) {
    const registration = await navigator.serviceWorker.ready;
    return registration.showNotification(title, { body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag });
  }
  return new Notification(title, { body, icon: 'icons/icon-192.png', tag });
}

function renderFocus() {
  const minutes = String(Math.floor(state.focusSeconds / 60)).padStart(2, '0');
  const seconds = String(state.focusSeconds % 60).padStart(2, '0');
  $('#focusClock').textContent = `${minutes}:${seconds}`;
  $('#focusStart').textContent = state.focusTimer ? 'Pausar' : state.focusSeconds === 1500 ? 'Iniciar' : 'Continuar';
}

function toggleFocus() {
  if (state.focusTimer) { clearInterval(state.focusTimer); state.focusTimer = null; renderFocus(); return; }
  state.focusTimer = setInterval(() => {
    state.focusSeconds -= 1; renderFocus();
    if (state.focusSeconds > 0) return;
    clearInterval(state.focusTimer); state.focusTimer = null; state.focusSeconds = 1500; renderFocus();
    if (Notification.permission === 'granted') notify('Sessão concluída', 'Respire um pouco antes da próxima tarefa.', 'focus-finished');
    showToast('Sessão de foco concluída');
  }, 1000);
  renderFocus();
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
  renderFocus();
  $$('[data-open-editor]').forEach(button => button.addEventListener('click', () => openEditor()));
  $('.bottom-nav').addEventListener('click', event => { const button = event.target.closest('[data-view]'); if (!button) return; state.view = button.dataset.view; state.selectedDate = ''; render(); });
  $('#statusFilters').addEventListener('click', event => { const button = event.target.closest('[data-status]'); if (!button) return; state.status = button.dataset.status; $$('#statusFilters button').forEach(item => item.classList.toggle('active', item === button)); render(); });
  $('#quickForm').addEventListener('submit', event => { event.preventDefault(); const title = $('#quickInput').value.trim(); if (!title) return; state.tasks.unshift({ id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`, title, category: state.view === 'settings' ? 'day' : state.view, date: localDate(), time: '', priority: 'none', notes: '', tags: [], repeat: 'none', reminder: false, done: false, createdAt: Date.now(), completedAt: null }); $('#quickInput').value = ''; saveTasks(); render(); showToast('Tarefa adicionada'); });
  $('#searchToggle').addEventListener('click', () => { $('#searchPanel').hidden = !$('#searchPanel').hidden; if (!$('#searchPanel').hidden) $('#searchInput').focus(); });
  $('#searchInput').addEventListener('input', event => { state.query = event.target.value; render(); });
  $('#saveTask').addEventListener('click', submitTask);
  $('#taskForm').addEventListener('submit', event => { event.preventDefault(); submitTask(); });
  $('#cancelEditor').addEventListener('click', closeEditor); $('#sheetBackdrop').addEventListener('click', closeEditor);
  $('#deleteEditor').addEventListener('click', () => { const card = document.querySelector(`[data-id="${$('#taskId').value}"]`); if (card) removeTask($('#taskId').value, card); else { state.tasks = state.tasks.filter(task => task.id !== $('#taskId').value); saveTasks(); render(); } closeEditor(); });
  $('#themeButton').addEventListener('click', () => setTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light'));
  $('#themeToggle').addEventListener('change', event => setTheme(event.target.checked ? 'light' : 'dark'));
  $('#notificationButton').addEventListener('click', requestNotifications);
  $('#clearButton').addEventListener('click', () => { if (!confirm('Apagar todas as tarefas deste aparelho?')) return; state.tasks = []; saveTasks(); render(); showToast('Todas as tarefas foram apagadas'); });
  $('#focusStart').addEventListener('click', toggleFocus);
  $('#focusReset').addEventListener('click', () => { if (state.focusTimer) clearInterval(state.focusTimer); state.focusTimer = null; state.focusSeconds = 1500; renderFocus(); });
  if ('serviceWorker' in navigator) {
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return;
      refreshing = true;
      location.reload();
    });
    navigator.serviceWorker.register('./sw.js?v=5').then(registration => registration.update()).catch(() => showToast('Modo offline não pôde ser ativado'));
  }
  if (new URLSearchParams(location.search).get('action') === 'new') openEditor();
}

document.addEventListener('DOMContentLoaded', init);
