/**
 * SECT Pay - App Logic
 * Splits UPI payments > Rs.2,000 into Rs.1,999 chunks to avoid 0.4% MDR
 */

// Constants
const MAX_CHUNK = 1999;
const MDR_RATE  = 0.004;

// State
let state = {
  upiId:     '',
  total:     0,
  chunks:    [],
  paidCount: 0,
};

// ── Format currency ──────────────────────────────────────
function fmt(amount) {
  return 'Rs.' + parseFloat(amount).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// ── Calculate split chunks ────────────────────────────────
function calcChunks(total) {
  const chunks = [];
  let remaining = Math.round(total * 100) / 100;
  while (remaining > MAX_CHUNK) {
    chunks.push({ amount: MAX_CHUNK, paid: false });
    remaining = Math.round((remaining - MAX_CHUNK) * 100) / 100;
  }
  if (remaining > 0) chunks.push({ amount: Math.round(remaining * 100) / 100, paid: false });
  return chunks;
}

// ── MDR that would have been charged ─────────────────────
function calcMDRSaved(total) {
  if (total <= 2000) return 0;
  return Math.min(total * MDR_RATE, 300);
}

// ── Live preview as user types amount ────────────────────
document.getElementById('total-amount').addEventListener('input', function () {
  const val      = parseFloat(this.value);
  const infoBox  = document.getElementById('split-info');
  const preview  = document.getElementById('split-preview');

  if (!val || val <= 0) {
    infoBox.style.display = 'none';
    preview.textContent = '';
    return;
  }

  if (val <= MAX_CHUNK) {
    infoBox.style.display = 'none';
    preview.textContent = 'Under Rs.2,000 — no MDR. No split needed!';
    preview.style.color = '#22c55e';
    return;
  }

  preview.textContent = '';
  preview.style.color = '';

  const chunks = calcChunks(val);
  document.getElementById('stat-total').textContent = fmt(val);
  document.getElementById('stat-count').textContent = chunks.length + (chunks.length === 1 ? ' payment' : ' payments');
  document.getElementById('stat-saved').textContent = fmt(calcMDRSaved(val));
  infoBox.style.display = 'block';
});

// ── Switch screen (slide) ─────────────────────────────────
function switchScreen(to) {
  const wrap = document.getElementById('screens-wrap');
  if (to === 'qr') {
    wrap.classList.add('show-qr');
  } else {
    wrap.classList.remove('show-qr');
  }
}

// ── Generate QRs ──────────────────────────────────────────
async function generateQRs() {
  const upiId = document.getElementById('upi-id').value.trim();
  const total  = parseFloat(document.getElementById('total-amount').value);

  if (!upiId) { shakeInput('upi-id'); return; }
  if (!upiId.includes('@')) {
    shakeInput('upi-id');
    showToast('Please enter a valid UPI ID (e.g. name@upi)', 'error');
    return;
  }
  if (!total || total <= 0) { shakeInput('total-amount'); return; }

  state.upiId     = upiId;
  state.total     = total;
  state.chunks    = calcChunks(total);
  state.paidCount = 0;

  // Populate summary bar
  document.getElementById('summary-total').textContent     = fmt(total);
  document.getElementById('summary-count').textContent     = state.chunks.length;
  document.getElementById('summary-paid').textContent      = fmt(0);
  document.getElementById('summary-remaining').textContent = fmt(total);
  document.getElementById('completion-overlay').style.display = 'none';

  // Build grid first, then slide (so QRs start rendering before user sees them)
  await buildQRGrid();
  switchScreen('qr');
}

// ── Build QR grid ─────────────────────────────────────────
async function buildQRGrid() {
  const grid = document.getElementById('qr-grid');
  grid.innerHTML = '';
  for (let i = 0; i < state.chunks.length; i++) {
    const card = await createQRCard(i, state.chunks[i]);
    grid.appendChild(card);
  }
}

// ── Create one QR card ────────────────────────────────────
async function createQRCard(index, chunk) {
  const card = document.createElement('div');
  card.className = 'qr-card' + (chunk.paid ? ' paid' : '');
  card.id = `qr-card-${index}`;
  card.style.animationDelay = `${index * 0.06}s`;

  const upiUrl = buildUPIUrl(state.upiId, chunk.amount, index + 1);

  card.innerHTML = `
    <div class="qr-card-header">
      <span class="qr-card-num">Payment ${index + 1} of ${state.chunks.length}</span>
      <span class="qr-card-amount">${fmt(chunk.amount)}</span>
    </div>
    <div class="qr-image-wrap" id="qr-wrap-${index}">
      <div class="qr-loading">Generating QR...</div>
    </div>
    <div class="qr-card-footer">
      <span class="qr-upi-id">${state.upiId}</span>
      <button class="qr-mark-btn" id="mark-btn-${index}" onclick="markPaid(${index})">Mark Paid</button>
    </div>
    ${chunk.paid ? paidOverlayHTML(index, chunk.amount) : ''}
  `;

  // Generate QR as base64 data URL using qrcode library
  const wrap = card.querySelector(`#qr-wrap-${index}`);
  try {
    const dataUrl = await QRCode.toDataURL(upiUrl, {
      width: 200,
      margin: 2,
      color: { dark: '#000000', light: '#ffffff' },
      errorCorrectionLevel: 'M',
    });
    const img = document.createElement('img');
    img.src   = dataUrl;
    img.alt   = `UPI QR code for payment ${index + 1}`;
    img.style.cssText = 'display:block;width:180px;height:180px;';
    wrap.innerHTML = '';
    wrap.appendChild(img);
  } catch (err) {
    console.error('QR error:', err);
    wrap.innerHTML = `<div style="padding:12px;font-size:0.7rem;color:#444;word-break:break-all;">${upiUrl}</div>`;
  }

  return card;
}

// ── Build UPI URL ─────────────────────────────────────────
function buildUPIUrl(vpa, amount, seq) {
  const params = new URLSearchParams({
    pa: vpa,
    pn: 'SECT Pay',
    am: amount.toFixed(2),
    cu: 'INR',
    tn: 'Payment ' + seq + ' via SECT Pay',
  });
  return 'upi://pay?' + params.toString();
}

// ── Paid overlay HTML ─────────────────────────────────────
function paidOverlayHTML(index, amount) {
  return `
    <div class="paid-overlay" id="paid-overlay-${index}">
      <div class="paid-check">
        <svg viewBox="0 0 28 28" fill="none">
          <path d="M7 14l5 5 9-10" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
      <span class="paid-label">Paid</span>
      <span class="paid-amount">${fmt(amount)} received</span>
      <button class="paid-undo" onclick="undoPaid(event, ${index})">Undo</button>
    </div>
  `;
}

// ── Mark payment as paid ──────────────────────────────────
function markPaid(index) {
  if (state.chunks[index].paid) return;
  state.chunks[index].paid = true;
  state.paidCount++;

  const card = document.getElementById(`qr-card-${index}`);
  card.classList.add('paid');
  const overlay = document.createElement('div');
  overlay.innerHTML = paidOverlayHTML(index, state.chunks[index].amount);
  card.appendChild(overlay.firstElementChild);

  updateSummary();
  if (state.paidCount === state.chunks.length) setTimeout(showCompletion, 600);
}

// ── Undo paid mark ────────────────────────────────────────
function undoPaid(event, index) {
  event.stopPropagation();
  if (!state.chunks[index].paid) return;

  state.chunks[index].paid = false;
  state.paidCount = Math.max(0, state.paidCount - 1);

  const card    = document.getElementById(`qr-card-${index}`);
  const overlay = document.getElementById(`paid-overlay-${index}`);
  card.classList.remove('paid');
  if (overlay) overlay.remove();
  document.getElementById('completion-overlay').style.display = 'none';
  updateSummary();
}

// ── Update summary bar ────────────────────────────────────
function updateSummary() {
  const paidAmount = state.chunks.filter(c => c.paid).reduce((s, c) => s + c.amount, 0);
  const remaining  = Math.max(0, state.total - paidAmount);
  document.getElementById('summary-paid').textContent      = fmt(paidAmount);
  document.getElementById('summary-remaining').textContent = fmt(remaining);
}

// ── Show completion popup ─────────────────────────────────
function showCompletion() {
  const n = state.chunks.length;
  document.getElementById('completion-summary').textContent =
    'All ' + n + ' payment' + (n > 1 ? 's' : '') + ' of ' + fmt(state.total) + ' received. MDR-free!';
  document.getElementById('completion-overlay').style.display = 'flex';
}

// ── Reset all paid marks ──────────────────────────────────
function resetAllPayments() {
  // Undo all paid marks
  state.chunks.forEach((chunk, i) => {
    if (chunk.paid) {
      chunk.paid = false;
      const card    = document.getElementById(`qr-card-${i}`);
      const overlay = document.getElementById(`paid-overlay-${i}`);
      if (card)    card.classList.remove('paid');
      if (overlay) overlay.remove();
    }
  });
  state.paidCount = 0;
  document.getElementById('completion-overlay').style.display = 'none';
  updateSummary();
  showToast('All payments reset', 'info');
}

// ── Go back to input ──────────────────────────────────────
function goBack() {
  switchScreen('input');
}

// ── Start fresh ───────────────────────────────────────────
function startNew() {
  document.getElementById('total-amount').value = '';
  document.getElementById('split-info').style.display = 'none';
  document.getElementById('split-preview').textContent = '';
  state = { upiId: state.upiId, total: 0, chunks: [], paidCount: 0 };
  switchScreen('input');
}

// ── Shake animation ───────────────────────────────────────
function shakeInput(id) {
  const el = document.getElementById(id);
  el.animate([
    { transform: 'translateX(0)' },
    { transform: 'translateX(-6px)' },
    { transform: 'translateX(6px)' },
    { transform: 'translateX(-4px)' },
    { transform: 'translateX(4px)' },
    { transform: 'translateX(0)' },
  ], { duration: 400, easing: 'ease' });
  el.style.borderColor = '#f43f5e';
  el.style.boxShadow   = '0 0 0 3px rgba(244,63,94,0.2)';
  setTimeout(() => { el.style.borderColor = ''; el.style.boxShadow = ''; }, 800);
}

// ── Toast ─────────────────────────────────────────────────
function showToast(message, type = 'info') {
  document.querySelector('.toast')?.remove();
  const colors = { info: '#6366f1', error: '#f43f5e', success: '#22c55e' };
  const toast = document.createElement('div');
  toast.className = 'toast';
  Object.assign(toast.style, {
    position: 'fixed', bottom: '24px', left: '50%',
    transform: 'translateX(-50%) translateY(16px)',
    background: colors[type] || colors.info,
    color: 'white', padding: '11px 24px', borderRadius: '100px',
    fontSize: '0.85rem', fontWeight: '600', fontFamily: 'Inter, sans-serif',
    boxShadow: '0 4px 20px rgba(0,0,0,0.4)', zIndex: '9999',
    opacity: '0', transition: 'all 0.3s ease', whiteSpace: 'nowrap',
    pointerEvents: 'none',
  });
  toast.textContent = message;
  document.body.appendChild(toast);
  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateX(-50%) translateY(0)';
  });
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(-50%) translateY(10px)';
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}

// ── Enter key to submit ───────────────────────────────────
document.addEventListener('keydown', e => {
  const wrap = document.getElementById('screens-wrap');
  if (e.key === 'Enter' && !wrap.classList.contains('show-qr')) {
    generateQRs();
  }
});
