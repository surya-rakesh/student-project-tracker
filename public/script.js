// ---- API client: the server is the only source of project records ----
async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(path, options);
  } catch {
    throw new Error('Could not reach the server. Check that it is running.');
  }
  let data = null;
  try { data = await response.json(); } catch { /* non-JSON body */ }
  if (!response.ok) throw new Error((data && data.error) || `Request failed (${response.status}).`);
  if (data === null) throw new Error('The server sent an unexpected response.');
  return data;
}

const json = { 'Content-Type': 'application/json' };
const store = {
  list: () => request('/api/projects'),
  create: project => request('/api/projects', { method: 'POST', headers: json, body: JSON.stringify(project) }),
  update: (id, project) => request(`/api/projects/${id}`, { method: 'PUT', headers: json, body: JSON.stringify(project) }),
  remove: id => request(`/api/projects/${id}`, { method: 'DELETE' })
};

// ---- DOM references ----
const form = document.querySelector('#project-form');
const nameInput = document.querySelector('#name');
const statusInput = document.querySelector('#status');
const list = document.querySelector('#project-list');
const empty = document.querySelector('#empty-state');
const message = document.querySelector('#message');
const saveButton = document.querySelector('#save-button');
const cancelButton = document.querySelector('#cancel-button');
const formTitle = document.querySelector('#form-title');

let editingId = null;
let busy = false;

function tell(text, error = false) {
  message.textContent = text;
  message.dataset.error = String(error);
}

function resetForm() {
  editingId = null;
  form.reset();
  saveButton.textContent = 'Add project';
  cancelButton.hidden = true;
  formTitle.textContent = 'Add a project';
}

function startEditing(project) {
  editingId = project.id;
  nameInput.value = project.name;
  statusInput.value = project.status;
  saveButton.textContent = 'Save changes';
  cancelButton.hidden = false;
  formTitle.textContent = 'Edit project';
  nameInput.focus();
}

function setBusy(value) {
  busy = value;
  form.querySelectorAll('input, select, button').forEach(el => { el.disabled = value; });
  list.querySelectorAll('button').forEach(el => { el.disabled = value; });
}

function renderProject(project) {
  const item = document.createElement('li');
  item.className = 'project';

  const info = document.createElement('div');
  const title = document.createElement('h3');
  title.className = 'project-name';
  title.textContent = project.name;
  const status = document.createElement('p');
  status.className = 'project-status';
  status.textContent = project.status;
  info.append(title, status);

  const actions = document.createElement('div');
  actions.className = 'actions';

  const edit = document.createElement('button');
  edit.type = 'button';
  edit.className = 'edit-button';
  edit.textContent = 'Edit';
  edit.setAttribute('aria-label', `Edit ${project.name}`);
  edit.addEventListener('click', () => { if (!busy) startEditing(project); });

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'delete-button';
  remove.textContent = 'Delete';
  remove.setAttribute('aria-label', `Delete ${project.name}`);
  remove.addEventListener('click', () => deleteProject(project));

  actions.append(edit, remove);
  item.append(info, actions);
  return item;
}

// Loads projects from the server and renders them. Throws on failure so an
// error is never shown as an empty list.
async function refresh() {
  const rows = await store.list();
  list.replaceChildren(...rows.map(renderProject));
  empty.hidden = rows.length > 0;
}

async function deleteProject(project) {
  if (busy) return;
  if (!confirm(`Delete "${project.name}"?`)) return;
  setBusy(true);
  tell('Deleting...');
  try {
    await store.remove(project.id);
    if (editingId === project.id) resetForm();
    try {
      await refresh();
      tell('Project deleted.');
    } catch (error) {
      tell(`Project deleted, but the list could not be reloaded. ${error.message}`, true);
    }
  } catch (error) {
    tell(error.message, true);
  } finally {
    setBusy(false);
  }
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (busy) return;
  const project = { name: nameInput.value.trim(), status: statusInput.value };
  if (!project.name) {
    tell('Enter a project name.', true);
    nameInput.focus();
    return;
  }
  setBusy(true);
  tell('Saving...');
  try {
    if (editingId === null) await store.create(project);
    else await store.update(editingId, project);
    resetForm();
    try {
      await refresh();
      tell('Project saved.');
    } catch (error) {
      tell(`Project saved, but the list could not be reloaded. ${error.message}`, true);
    }
  } catch (error) {
    tell(error.message, true); // keep the typed input and editing state
  } finally {
    setBusy(false);
    if (editingId === null) nameInput.focus();
  }
});

cancelButton.addEventListener('click', () => {
  if (busy) return;
  resetForm();
  tell('Edit cancelled.');
});

// ---- Initial load ----
setBusy(true);
tell('Loading projects...');
refresh()
  .then(() => tell('Ready.'))
  .catch(error => tell(error.message, true))
  .finally(() => setBusy(false));
