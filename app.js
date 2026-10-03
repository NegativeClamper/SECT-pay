/**
 * SECT Pay — App Logic
 * Splits UPI payments > ₹2,000 into ₹1,999 chunks
 * to avoid the 0.4% MDR charge (effective Oct 15, 2026)
 */

// ─── Constants ───────────────────────────────────────────
const MAX_CHUNK  = 1999;   // Max per payment to stay MDR-free
const MDR_RATE   = 0.004;  // 0.4% MDR rate above ₹2,000

// ─── App State ───────────────────────────────────────────
let state = {
  upiId:      '',
  total:      0,
  chunks:     [],   // Array of { amount, paid }
  paidCount:  0,
};

// ─── Utility: Format currency ─────────────────────────────
function fmt(amount) {
  return '₹' + parseFloat(amount).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// ─── Utility: Calculate chunks ────────────────────────────
function calcChunks(total) {
  const chunks = [];
  let remaining = Math.round(total * 100) / 100; // round to paise

  while (remaining > MAX_CHUNK) {
    chunks.push({ amount: MAX_CHUNK, paid: false });
    remaining = Math.round((remaining - MAX_CHUNK) * 100) / 100;
  }
  if (remaining > 0) {
    chunks.push({ amount: Math.round(remaining * 100) / 100, paid: false });
  }
  return chunks;
}

// ─── Utility: Calculate MDR that would have been charged ──
function calcMDRSaved(total) {
  if (total <= 2000) return 0;
  // MDR applies to the whole amount if paid as single txn
  return Math.min(total * MDR_RATE, 300); // cap at ₹300 for ₹75k+
}

// ─── Live preview on amount input ─────────────────────────
document.getElementById('total-amount').addEventListener('input', function () {
  const val = parseFloat(this.value);
  const infoBox   = document.getElementById('split-info');
  const previewEl = document.getElementById('split-preview');

  if (!val || val <= 0) {
    infoBox.style.display = 'none';
    previewEl.textContent = '';
    return;
  }

  if (val <= MAX_CHUNK) {
    infoBox.style.display = 'none';
    previewEl.textContent = '✓ Under ₹2,000 — no MDR applies. No split needed.';
    previewEl.style.color = '#22c55e';
    return;
  }

  previewEl.textContent = '';
  previewEl.style.color = '';

  const chunks  = calcChunks(val);
  const saved   = calcMDRSaved(val);

  document.getElementById('stat-total').textContent = fmt(val);
  document.getElementById('stat-count').textContent = chunks.length + (chunks.length === 1 ? ' payment' : ' payments');
  document.getElementById('stat-saved').textContent = fmt(saved);

  infoBox.style.display = 'block';
});

// ─── Generate QRs ─────────────────────────────────────────
async function generateQRs() {
  const upiId = document.getElementById('upi-id').value.trim();
  const total  = parseFloat(document.getElementById('total-amount').value);

  // Validate
  if (!upiId) {
    shakeInput('upi-id');
    return;
  }
  if (!upiId.includes('@')) {
    shakeInput('upi-id');
    showToast('Please enter a valid UPI ID (e.g. name@upi)', 'error');
    return;
  }
  if (!total || total <= 0) {
    shakeInput('total-amount');
    return;
  }

  // Update state
  state.upiId     = upiId;
  state.total     = total;
  state.chunks    = calcChunks(total);
  state.paidCount = 0;

  // Switch screen
  switchScreen('screen-qr');

  // Populate summary
  document.getElementById('summary-total').textContent     = fmt(total);
  document.getElementById('summary-count').textContent     = state.chunks.length;
  document.getElementById('summary-paid').textContent      = fmt(0);
  document.getElementById('summary-remaining').textContent = fmt(total);
  document.getElementById('completion-overlay').style.display = 'none';

  // Build QR grid
  await buildQRGrid();
}

// ─── Build QR Grid ────────────────────────────────────────
async function buildQRGrid() {
  const grid = document.getElementById('qr-grid');
  grid.innerHTML = '';

  for (let i = 0; i < state.chunks.length; i++) {
    const chunk = state.chunks[i];
    const card  = await createQRCard(i, chunk);
    grid.appendChild(card);
  }
}

// ─── Create a single QR Card ──────────────────────────────
async function createQRCard(index, chunk) {
  const card = document.createElement('div');
  card.className = 'qr-card' + (chunk.paid ? ' paid' : '');
  card.id = `qr-card-${index}`;
  card.style.animationDelay = `${index * 0.06}s`;

  // UPI deep link (BharatPay / NPCI standard)
  const upiUrl = buildUPIUrl(state.upiId, chunk.amount, index + 1);

  card.innerHTML = `
    <div class="qr-card-header">
      <span class="qr-card-num">Payment ${index + 1} of ${state.chunks.length}</span>
      <span class="qr-card-amount">${fmt(chunk.amount)}</span>
    </div>
    <div class="qr-image-wrap" id="qr-wrap-${index}">
      <!-- QR rendered here -->
    </div>
    <div class="qr-card-footer">
      <span class="qr-upi-id">${state.upiId}</span>
      <button class="qr-mark-btn" id="mark-btn-${index}" onclick="markPaid(${index})">
        Mark Paid ✓
      </button>
    </div>
    ${chunk.paid ? paidOverlayHTML(index, chunk.amount) : ''}
  `;

  // Render QR code into the wrap
  const wrap = card.querySelector(`#qr-wrap-${index}`);
  try {
    const canvas = document.createElement('canvas');
    await QRCode.toCanvas(canvas, upiUrl, {
      width: 180,
      margin: 1,
      color: { dark: '#000000', light: '#ffffff' },
      errorCorrectionLevel: 'M',
    });
    wrap.appendChild(canvas);
  } catch (err) {
    // Fallback: show UPI URL as text
    wrap.innerHTML = `<div style="padding:16px;font-size:0.7rem;word-break:break-all;color:#333;background:white;width:180px;height:180px;display:flex;align-items:center;">${upiUrl}</div>`;
    console.warn('QR generation error:', err);
  }

  return card;
}

// ─── Build UPI URL (NPCI standard) ────────────────────────
function buildUPIUrl(vpa, amount, seq) {
  const params = new URLSearchParams({
    pa: vpa,
    pn: 'SECT Pay',
    am: amount.toFixed(2),
    cu: 'INR',
    tn: `Payment ${seq} via SECT Pay`,
  });
  return `upi://pay?${params.toString()}`;
}

// ─── Paid Overlay HTML ────────────────────────────────────
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

// ─── Mark a payment as paid ───────────────────────────────
function markPaid(index) {
  if (state.chunks[index].paid) return;

  state.chunks[index].paid = true;
  state.paidCount++;

  const card = document.getElementById(`qr-card-${index}`);
  card.classList.add('paid');

  // Inject overlay
  const overlay = document.createElement('div');
  overlay.innerHTML = paidOverlayHTML(index, state.chunks[index].amount);
  card.appendChild(overlay.firstElementChild);

  updateSummary();

  // Check if all paid
  if (state.paidCount === state.chunks.length) {
    setTimeout(showCompletion, 600);
  }
}

// ─── Undo a paid mark ────────────────────────────────────
function undoPaid(event, index) {
  event.stopPropagation();

  state.chunks[index].paid = false;
  state.paidCount = Math.max(0, state.paidCount - 1);

  const card    = document.getElementById(`qr-card-${index}`);
  const overlay = document.getElementById(`paid-overlay-${index}`);

  card.classList.remove('paid');
  if (overlay) overlay.remove();

  // Hide completion overlay if it was showing
  document.getElementById('completion-overlay').style.display = 'none';

  updateSummary();
}

// ─── Update summary bar ───────────────────────────────────
function updateSummary() {
  const paidAmount = state.chunks
    .filter(c => c.paid)
    .reduce((sum, c) => sum + c.amount, 0);
  const remaining = Math.max(0, state.total - paidAmount);

  document.getElementById('summary-paid').textContent      = fmt(paidAmount);
  document.getElementById('summary-remaining').textContent = fmt(remaining);
}

// ─── Show completion overlay ──────────────────────────────
function showCompletion() {
  const total = fmt(state.total);
  const count = state.chunks.length;
  document.getElementById('completion-summary').textContent =
    `All ${count} payment${count > 1 ? 's' : ''} of ${total} received. MDR-free! 🎉`;
  document.getElementById('completion-overlay').style.display = 'flex';
}

// ─── Reset all payments ───────────────────────────────────
function resetAllPayments() {
  state.chunks.forEach((c, i) => {
    if (c.paid) undoPaid({ stopPropagation: () => {} }, i);
  });
  state.paidCount = 0;
  updateSummary();
}

// ─── Go back to input screen ──────────────────────────────
function goBack() {
  switchScreen('screen-input');
}

// ─── Start new payment ────────────────────────────────────
function startNew() {
  document.getElementById('total-amount').value = '';
  document.getElementById('split-info').style.display = 'none';
  document.getElementById('split-preview').textContent = '';
  state = { upiId: state.upiId, total: 0, chunks: [], paidCount: 0 };
  switchScreen('screen-input');
}

// ─── Screen transition ────────────────────────────────────
function switchScreen(targetId) {
  document.querySelectorAll('.screen').forEach(s => {
    s.classList.remove('active');
  });
  document.getElementById(targetId).classList.add('active');
}

// ─── Input shake animation ────────────────────────────────
function shakeInput(id) {
  const el = document.getElementById(id);
  el.style.animation = 'none';
  el.offsetHeight; // reflow
  el.style.animation = 'shake 0.4s ease';
  el.style.borderColor = 'var(--red)';
  el.style.boxShadow = '0 0 0 3px rgba(244,63,94,0.2)';
  setTimeout(() => {
    el.style.borderColor = '';
    el.style.boxShadow = '';
    el.style.animation = '';
  }, 800);
}

// Shake keyframes (injected via JS to avoid CSS duplication)
const shakeStyle = document.createElement('style');
shakeStyle.textContent = `
  @keyframes shake {
    0%,100% { transform: translateX(0); }
    20%     { transform: translateX(-6px); }
    40%     { transform: translateX(6px); }
    60%     { transform: translateX(-4px); }
    80%     { transform: translateX(4px); }
  }
`;
document.head.appendChild(shakeStyle);

// ─── Toast notification ───────────────────────────────────
function showToast(message, type = 'info') {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;

  const colors = { info: '#6366f1', error: '#f43f5e', success: '#22c55e' };
  toast.style.cssText = `
    position: fixed;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%) translateY(20px);
    background: ${colors[type] || colors.info};
    color: white;
    padding: 12px 24px;
    border-radius: 100px;
    font-size: 0.85rem;
    font-weight: 600;
    font-family: 'Inter', sans-serif;
    box-shadow: 0 4px 20px rgba(0,0,0,0.4);
    z-index: 9999;
    opacity: 0;
    transition: all 0.3s ease;
    white-space: nowrap;
    pointer-events: none;
  `;
  document.body.appendChild(toast);

  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateX(-50%) translateY(0)';
  });

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(-50%) translateY(10px)';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ─── Allow Enter key to submit ────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && document.getElementById('screen-input').classList.contains('active')) {
    generateQRs();
  }
});
