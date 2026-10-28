// Thin WebSocket wrapper with auto-reconnect and an event emitter.

export class Net {
  constructor() {
    this.ws = null;
    this.handlers = new Map();
    this.connected = false;
    this.reconnectDelay = 1000;
    this.rtt = 0;
    this.serverOffset = 0; // serverTime - localTime (seconds)
    this._pingTimer = null;
  }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, []);
    this.handlers.get(type).push(fn);
    return this;
  }

  emit(type, payload) {
    const list = this.handlers.get(type);
    if (list) for (const fn of list) fn(payload);
  }

  connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${proto}://${location.host}/ws`;
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => {
      this.connected = true;
      this.reconnectDelay = 1000;
      this.emit('open');
      clearInterval(this._pingTimer);
      this._pingTimer = setInterval(() => this.send({ type: 'ping', t: performance.now() }), 2000);
    };
    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type === 'pong') {
        const now = performance.now();
        this.rtt = now - msg.t;
        this.serverOffset = msg.serverTime - (now - this.rtt / 2) / 1000;
      }
      this.emit(msg.type, msg);
      this.emit('*', msg);
    };
    ws.onclose = () => {
      this.connected = false;
      clearInterval(this._pingTimer);
      this.emit('close');
      setTimeout(() => this.connect(), this.reconnectDelay);
      this.reconnectDelay = Math.min(this.reconnectDelay * 1.6, 8000);
    };
    ws.onerror = () => { /* onclose follows */ };
  }

  send(msg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }
}
