// The mini call window's page. All it does is paint the call summary main sends it and report button presses back —
// the call itself lives in the hosted web app. Text is only ever set with textContent.
const $ = (id) => document.getElementById(id);
let state = null;
let strings = {};
let timer = null;

function clock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, '0');
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${m}:${sec}` : `${m}:${sec}`;
}

function sub() {
  if (!state) return '';
  if (state.status === 'ringing') return state.direction === 'in' ? strings.incoming : strings.calling;
  if (state.status === 'dialing') return strings.calling;
  const elapsed = state.answeredAt ? clock(Date.now() - state.answeredAt) : '';
  return state.status === 'held' ? `${strings.onHold}${elapsed ? ` · ${elapsed}` : ''}` : elapsed;
}

function paint() {
  if (!state) return;
  const ringingIn = state.status === 'ringing' && state.direction === 'in';
  $('name').textContent = state.name || state.remote || '';
  $('sub').textContent = sub();
  $('answer').hidden = !ringingIn;
  $('answer').textContent = strings.answer;
  $('mute').hidden = ringingIn;
  $('mute').textContent = state.muted ? strings.unmute : strings.mute;
  $('mute').classList.toggle('on', state.muted);
  $('mute').setAttribute('aria-pressed', String(state.muted));
  $('hangup').textContent = ringingIn ? strings.decline : strings.hangUp;
}

window.pulsevoiceMini.onState((next, nextStrings) => {
  state = next;
  strings = nextStrings;
  paint();
  clearInterval(timer);
  timer = setInterval(paint, 1000);
});

$('answer').addEventListener('click', () => window.pulsevoiceMini.action('answer'));
$('mute').addEventListener('click', () => window.pulsevoiceMini.action('toggle-mute'));
$('hangup').addEventListener('click', () => window.pulsevoiceMini.action('hangup'));
$('name').addEventListener('dblclick', () => window.pulsevoiceMini.action('show'));
