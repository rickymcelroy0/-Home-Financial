function money(n) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(n || 0));
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    throw new Error(data.error || `Request failed: ${response.status}`);
  }
  return data;
}

function setOutput(value) {
  const el = document.getElementById('output');
  el.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

function setAuth(text) {
  document.getElementById('authStatus').textContent = text;
}

async function refreshOverview() {
  try {
    const data = await api('/api/overview');
    document.getElementById('sum-users').textContent = data.summary.userCount;
    document.getElementById('sum-active').textContent = data.summary.activeUsers;
    document.getElementById('sum-checking').textContent = money(data.summary.totalChecking);
    document.getElementById('sum-vault').textContent = money(data.summary.totalVault);
    setOutput(data);
  } catch (error) {
    setOutput({ error: error.message });
  }
}

async function checkSession() {
  try {
    const data = await api('/api/session', { method: 'GET' });
    if (data.authenticated) {
      setAuth('Authenticated');
      refreshOverview();
    } else {
      setAuth('Not authenticated');
    }
  } catch (error) {
    setAuth('Session check failed');
  }
}

document.getElementById('loginBtn').addEventListener('click', async () => {
  try {
    await api('/api/login', { method: 'POST', body: JSON.stringify({ pin: document.getElementById('pin').value }) });
    setAuth('Authenticated');
    await refreshOverview();
  } catch (error) {
    setOutput({ error: error.message });
  }
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
  try {
    await api('/api/logout', { method: 'POST' });
    setAuth('Not authenticated');
    setOutput('Logged out.');
  } catch (error) {
    setOutput({ error: error.message });
  }
});

document.getElementById('refreshBtn').addEventListener('click', refreshOverview);

document.getElementById('createUserBtn').addEventListener('click', async () => {
  try {
    const payload = {
      username: document.getElementById('newUsername').value,
      name: document.getElementById('newName').value,
      pin: document.getElementById('newPin').value,
      openingChecking: document.getElementById('newChecking').value,
      openingVault: document.getElementById('newVault').value
    };
    const data = await api('/api/users', { method: 'POST', body: JSON.stringify(payload) });
    setOutput(data);
    refreshOverview();
  } catch (error) {
    setOutput({ error: error.message });
  }
});

document.getElementById('treasuryBtn').addEventListener('click', async () => {
  try {
    const payload = {
      userId: document.getElementById('treasuryUser').value,
      target: document.getElementById('treasuryTarget').value,
      amount: document.getElementById('treasuryAmount').value,
      memo: document.getElementById('treasuryMemo').value
    };
    const data = await api('/api/treasury/transfer', { method: 'POST', body: JSON.stringify(payload) });
    setOutput(data);
    refreshOverview();
  } catch (error) {
    setOutput({ error: error.message });
  }
});

document.getElementById('statusBtn').addEventListener('click', async () => {
  try {
    const userId = document.getElementById('statusUser').value;
    const status = document.getElementById('statusValue').value;
    const data = await api(`/api/users/${encodeURIComponent(userId)}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
    setOutput(data);
    refreshOverview();
  } catch (error) {
    setOutput({ error: error.message });
  }
});

document.getElementById('deleteBtn').addEventListener('click', async () => {
  try {
    const userId = document.getElementById('deleteUser').value;
    const data = await api(`/api/users/${encodeURIComponent(userId)}`, { method: 'DELETE' });
    setOutput(data);
    refreshOverview();
  } catch (error) {
    setOutput({ error: error.message });
  }
});

document.getElementById('billBtn').addEventListener('click', async () => {
  try {
    const payload = {
      userId: document.getElementById('billUser').value,
      name: document.getElementById('billName').value,
      amount: document.getElementById('billAmount').value,
      dueDate: document.getElementById('billDate').value,
      visibility: document.getElementById('billVisibility').value
    };
    const data = await api('/api/bills', { method: 'POST', body: JSON.stringify(payload) });
    setOutput(data);
    refreshOverview();
  } catch (error) {
    setOutput({ error: error.message });
  }
});

document.getElementById('payBillBtn').addEventListener('click', async () => {
  try {
    const billId = document.getElementById('payBillId').value;
    const scope = document.getElementById('payBillScope').value;
    const data = await api(`/api/bills/${encodeURIComponent(billId)}/pay`, { method: 'POST', body: JSON.stringify({ scope }) });
    setOutput(data);
    refreshOverview();
  } catch (error) {
    setOutput({ error: error.message });
  }
});

document.getElementById('readDbBtn').addEventListener('click', async () => {
  try {
    const path = document.getElementById('dbReadPath').value;
    const data = await api(`/api/db?path=${encodeURIComponent(path)}`);
    setOutput(data);
  } catch (error) {
    setOutput({ error: error.message });
  }
});

document.getElementById('writeDbBtn').addEventListener('click', async () => {
  try {
    const path = document.getElementById('dbWritePath').value;
    const raw = document.getElementById('dbWriteValue').value.trim();
    const value = raw ? JSON.parse(raw) : null;
    const data = await api('/api/db', { method: 'PUT', body: JSON.stringify({ path, value }) });
    setOutput(data);
    refreshOverview();
  } catch (error) {
    setOutput({ error: error.message });
  }
});

document.getElementById('deleteDbBtn').addEventListener('click', async () => {
  try {
    const path = document.getElementById('dbWritePath').value;
    const data = await api(`/api/db?path=${encodeURIComponent(path)}`, { method: 'DELETE' });
    setOutput(data);
    refreshOverview();
  } catch (error) {
    setOutput({ error: error.message });
  }
});

checkSession();
