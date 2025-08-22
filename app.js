// ======= Peer-to-Peer Real-time Chat using SimplePeer ========

// --- Minimal in-memory signaling server via public websocket playground
const SIGNAL_URL = "wss://ws.postman-echo.com/raw"; // reliable for hacky demo

// --- Utility: Generate 5-char alphanumeric code (uses CDN nanoid)
function genCode() {
  return window.nanoid(5).toUpperCase(); // Yeh line hi sahi hai
}

// --- DOM helpers
function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

// --- UI: Show loader
function showLoader() {
  const d = el('div', 'loader');
  return d;
}

// --- UI: Initial code/share/connect screen
function renderStartUI(code, onConnect) {
  const card = el('div', 'card');
  card.append(
    el('div', 'small', 'Share this code:'),
    el('div', 'codebox', code),
    el('div', 'small', 'Or connect to a friend'),
    (() => {
      const row = el('div');
      const inp = el('input');
      inp.placeholder = 'Enter code to connect...';
      row.appendChild(inp);
      card.appendChild(row);
      const btn = el('button');
      btn.textContent = 'Connect';
      btn.onclick = () => {
        const val = inp.value.trim().toUpperCase();
        if (/^[A-Z0-9]{5}$/.test(val)) onConnect(val);
        else showErr('Please enter valid 5-letter code', card);
      };
      row.appendChild(btn);
      return row;
    })(),
    el('div', 'small', 'Open on another device and enter code for instant chat.')
  );
  return card;
}

// --- UI: Chat screen
function renderChatUI(mycode, peername, onSend, messages, onLeave) {
  const card = el('div', 'card');
  card.append(
    el('div', 'small', 'Connected! Your code:'),
    el('div', 'codebox', mycode),
    el('div', 'small', `Chat with <b>${peername}</b>`),
    (() => {
      const area = el('div', 'chatarea');
      area.id = 'chatarea';
      messages.forEach(msg => {
        const div = el('div', 'chatmsg' + (msg.self ? ' self' : ''), msg.text);
        area.appendChild(div);
      });
      return area;
    })(),
    (() => {
      const inrow = el('div', 'chatinrow');
      const inp = el('input', 'chatinbox');
      inp.placeholder = 'Type a message...';
      inp.maxLength = 300;
      inp.onkeydown = (e) => {
        if (e.key === "Enter") btn.click();
      };
      const btn = el('button', 'chatbtn');
      btn.textContent = 'Send';
      btn.onclick = () => {
        const v = inp.value.trim();
        if (v) {
          onSend(v);
          inp.value = '';
        }
      };
      inrow.append(inp, btn);
      return inrow;
    })(),
    (() => {
      const btn = el('button');
      btn.textContent = 'Disconnect';
      btn.style.background = '#ff6978';
      btn.style.color = '#fff';
      btn.onclick = onLeave;
      btn.style.marginTop = '8px';
      return btn;
    })()
  );
  return card;
}

// --- UI: Show error
function showErr(msg, parent) {
  let err = parent.querySelector('.err');
  if (!err) {
    err = el('div', 'err');
    parent.append(err);
  }
  err.textContent = msg;
  setTimeout(() => { if (err) err.textContent = ''; }, 3000);
}

// --- State
let myCode = genCode();
let peerCode = null;
let isInitiator = false;
let ws = null;
let peer = null;
let messages = [];
let peerDisplayName = '';
let main = document.getElementById('main-card');

// --- Main: Render initial UI
function renderStart() {
  main.innerHTML = '';
  main.appendChild(renderStartUI(myCode, (othercode) => {
    peerCode = othercode;
    isInitiator = true;
    connectPeer();
  }));
}

// --- Main: Render chat UI
function renderChat() {
  main.innerHTML = '';
  main.appendChild(renderChatUI(myCode, peerDisplayName, sendMsg, messages, disconnect));
  // Scroll to bottom
  setTimeout(() => {
    let area = document.getElementById('chatarea');
    if (area) area.scrollTop = 99999;
  }, 100);
}

// --- Main: Show loader
function showConnectLoader() {
  main.innerHTML = '';
  const card = el('div', 'card');
  card.append(showLoader(), el('div', 'small', 'Connecting...'));
  main.appendChild(card);
}

// --- Messaging
function sendMsg(text) {
  if (peer && peer.connected) {
    peer.send(JSON.stringify({ type: 'msg', text }));
    messages.push({ text, self: true });
    renderChat();
  }
}

// --- Disconnect
function disconnect() {
  try { peer && peer.destroy(); } catch {}
  try { ws && ws.close(); } catch {}
  myCode = genCode();
  peerCode = null;
  messages = [];
  peer = null;
  ws = null;
  peerDisplayName = '';
  renderStart();
}

// --- Peer connect logic
function connectPeer() {
  showConnectLoader();

  // 1. Open websocket for signaling
  ws = new WebSocket(SIGNAL_URL);

  ws.onopen = () => {
    // 2. Send join signal
    ws.send(JSON.stringify({ op: 'join', code: isInitiator ? peerCode : myCode }));
    // 3. Create peer
    peer = new window.SimplePeer({ initiator: isInitiator, trickle: false });

    // 4. On signal (offer/answer), send to peer via ws
    peer.on('signal', data => {
      ws.send(JSON.stringify({
        op: 'signal',
        from: myCode,
        to: isInitiator ? peerCode : myCode,
        signal: data
      }));
    });

    // 5. On connect, show chat UI
    peer.on('connect', () => {
      peerDisplayName = peerCode || 'Friend';
      messages = [];
      renderChat();
      // Send self name (code)
      peer.send(JSON.stringify({ type: 'hello', name: myCode }));
    });

    // 6. On data (message)
    peer.on('data', data => {
      let msg;
      try { msg = JSON.parse(data); } catch {}
      if (!msg) return;
      if (msg.type === 'hello') {
        peerDisplayName = msg.name || 'Friend';
        renderChat();
      }
      if (msg.type === 'msg') {
        messages.push({ text: msg.text, self: false });
        renderChat();
      }
    });

    peer.on('close', disconnect);
    peer.on('error', disconnect);
  };

  ws.onmessage = (ev) => {
    let payload;
    try { payload = JSON.parse(ev.data); } catch {}
    if (!payload) return;
    // If incoming signal is for me, signal to peer
    if (payload.op === 'signal' && payload.to === myCode) {
      peer.signal(payload.signal);
    }
  };

  ws.onerror = () => showErr('Signaling error. Try again.', main);
  ws.onclose = () => {};
}

// --- If user opens app with code in hash: ?code=XXXXX
(function quickConnectFromURL() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  if (code && /^[A-Z0-9]{5}$/i.test(code)) {
    myCode = genCode();
    peerCode = code.toUpperCase();
    isInitiator = true;
    connectPeer();
    return;
  }
  renderStart();
})();
