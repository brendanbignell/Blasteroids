// Keyboard input -> input record. Sends to the server on change plus a heartbeat.

const KEYMAP = {
  KeyW: 'thrust', ArrowUp: 'thrust',
  KeyS: 'reverse', ArrowDown: 'reverse',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  Space: 'fire',
  KeyX: 'torpedo', Enter: 'torpedo', ShiftLeft: 'torpedo', ShiftRight: 'torpedo',
  KeyC: 'cloak',
};

export class Input {
  constructor(net) {
    this.net = net;
    this.enabled = false;
    this.state = { thrust: false, reverse: false, left: false, right: false, fire: false, torpedo: false, cloak: false };
    this.showScores = false;
    this.onEscape = null;
    this._lastSent = '';
    this.seq = 0; // bumped on every input change; the server echoes it back for prediction
    this._heartbeat = null;

    window.addEventListener('keydown', (e) => this.handle(e, true));
    window.addEventListener('keyup', (e) => this.handle(e, false));
    window.addEventListener('blur', () => this.releaseAll());
  }

  handle(e, down) {
    if (e.code === 'Tab' && this.enabled) { this.showScores = down; e.preventDefault(); return; }
    if (e.code === 'Escape' && down && this.enabled) { this.onEscape?.(); return; }
    const action = KEYMAP[e.code];
    if (!action) return;
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    if (this.enabled) e.preventDefault();
    if (this.state[action] === down) return;
    this.state[action] = down;
    this.flush();
  }

  releaseAll() {
    for (const k of Object.keys(this.state)) this.state[k] = false;
    this.showScores = false;
    this.flush();
  }

  setEnabled(on) {
    this.enabled = on;
    clearInterval(this._heartbeat);
    if (on) {
      this._heartbeat = setInterval(() => this.flush(true), 150);
    } else {
      this.releaseAll();
    }
  }

  flush(force = false) {
    if (!this.enabled) return;
    const encoded = JSON.stringify(this.state);
    if (!force && encoded === this._lastSent) return;
    if (encoded !== this._lastSent) this.seq++;
    this._lastSent = encoded;
    this.net.send({ type: 'input', input: this.state, seq: this.seq });
  }
}
