const messages = document.getElementById('messages');
const input = document.getElementById('userInput');
const statusPill = document.getElementById('statusPill');
const statusText = document.getElementById('statusText');
const micCard = document.getElementById('micCard');
const cameraCard = document.getElementById('cameraCard');
const micStatus = document.getElementById('micStatus');
const cameraStatus = document.getElementById('cameraStatus');
const gestureToggle = document.getElementById('gestureToggle');
let microphoneEnabled = true;

eel.expose(addUserMsg);
eel.expose(addAppMsg);
eel.expose(updateStatus);
eel.expose(updateDevices);

function appendMessage(message, fromUser) {
  const article = document.createElement('article');
  article.className = `message ${fromUser ? 'user-message' : 'assistant-message'}`;
  const avatar = document.createElement('span');
  avatar.className = 'message-avatar';
  avatar.textContent = fromUser ? 'Y' : 'N';
  const body = document.createElement('div');
  body.className = 'message-body';
  const label = document.createElement('span');
  label.className = 'message-label';
  label.append(document.createTextNode(fromUser ? 'YOU ' : 'NEO '));
  const time = document.createElement('time');
  time.textContent = new Date().toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
  label.appendChild(time);
  body.appendChild(label);

  // Keep messages as text. Existing file listings use <br> separators.
  String(message).split(/<br\s*\/?\s*>/i).forEach((line, index) => {
    if (index) body.appendChild(document.createElement('br'));
    const paragraph = document.createElement('p');
    paragraph.textContent = line;
    body.appendChild(paragraph);
  });
  article.append(avatar, body);
  messages.appendChild(article);
  messages.scrollTop = messages.scrollHeight;
}

function addUserMsg(message) { appendMessage(message, true); }
function addAppMsg(message) { appendMessage(message, false); }

function updateStatus(message, state) {
  statusText.textContent = message;
  statusPill.dataset.state = state || 'listening';
  if (state === 'speaking') document.getElementById('heroOrb').dataset.state = 'speaking';
  else document.getElementById('heroOrb').dataset.state = state || 'listening';
  if (!microphoneEnabled) micStatus.textContent = 'Unavailable · check Windows privacy permissions';
  else if (state === 'dictating') micStatus.textContent = 'Active · dictation listening';
  else if (state === 'processing') micStatus.textContent = 'Active · processing command';
  else if (state === 'speaking') micStatus.textContent = 'Active · Neo is speaking';
  else micStatus.textContent = 'Active · waiting for “Neo”';
}

function updateDevices(microphone, camera, handControl) {
  microphoneEnabled = Boolean(microphone);
  micCard.dataset.active = microphone ? 'true' : 'false';
  cameraCard.dataset.active = camera ? 'true' : 'false';
  micStatus.textContent = microphone ? 'Active · waiting for “Neo”' : 'Microphone is off';
  cameraStatus.textContent = camera ? 'Camera active · preview open' : 'Camera is off';
  gestureToggle.dataset.command = handControl ? 'stop gesture recognition' : 'launch gesture recognition';
  gestureToggle.querySelector('span:last-child').textContent = handControl ? 'Stop hand control' : 'Start hand control';
  gestureToggle.classList.toggle('button-danger', Boolean(handControl));
}

function sendCommand(command) {
  const value = String(command || '').trim();
  if (!value || typeof eel === 'undefined' || !eel.getUserInput) return;
  eel.getUserInput(value);
}

function submitInput(event) {
  if (event) event.preventDefault();
  const command = input.value;
  input.value = '';
  sendCommand(command);
}

document.getElementById('composer').addEventListener('submit', submitInput);
document.querySelectorAll('[data-command]').forEach((button) => {
  button.addEventListener('click', () => sendCommand(button.dataset.command));
});
document.getElementById('clearConversation').addEventListener('click', () => {
  messages.replaceChildren();
});

function tickClock() {
  document.getElementById('clock').textContent = new Date().toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
}
tickClock();
window.setInterval(tickClock, 15000);
