const pinInput = document.getElementById('pin');
const loginBtn = document.getElementById('loginBtn');
const pathInput = document.getElementById('path');
const methodSelect = document.getElementById('method');
const payloadInput = document.getElementById('payload');
const runBtn = document.getElementById('runBtn');
const resultEl = document.getElementById('result');

function show(data) {
  resultEl.textContent = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
}

loginBtn.addEventListener('click', async () => {
  const res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: pinInput.value })
  });
  const data = await res.json();
  show(data);
});

runBtn.addEventListener('click', async () => {
  const method = methodSelect.value;
  const path = encodeURIComponent(pathInput.value.trim());
  const opts = { method, headers: {} };

  if (method === 'PUT' || method === 'PATCH') {
    opts.headers['Content-Type'] = 'application/json';
    try {
      JSON.parse(payloadInput.value);
    } catch (e) {
      show({ error: 'Payload is not valid JSON', details: e.message });
      return;
    }
    opts.body = payloadInput.value;
  }

  const res = await fetch(`/api/db?path=${path}`, opts);
  const data = await res.json();
  show(data);
});
