/* ── Hunting Log App ── */

const STORAGE_KEY = 'hunting_log_v1';

// ── State ──
let hunts = loadHunts();
let map, markersLayer;
let activeHuntId = null;

// ── DOM refs ──
const huntForm     = document.getElementById('hunt-form');
const submitBtn    = document.getElementById('submit-btn');
const btnText      = submitBtn.querySelector('.btn-text');
const btnSpinner   = submitBtn.querySelector('.btn-spinner');
const formError    = document.getElementById('form-error');
const huntList     = document.getElementById('hunt-list');
const logCount     = document.getElementById('log-count');
const searchInput  = document.getElementById('search');
const mapOverlay   = document.getElementById('map-overlay');
const modalBackdrop= document.getElementById('modal-backdrop');
const modalClose   = document.getElementById('modal-close');
const modalDelete  = document.getElementById('modal-delete');

// ── Init ──
initMap();
renderList();
renderMarkers();

// ── Map setup ──
function initMap() {
  map = L.map('map', {
    center: [39.5, -98.35],
    zoom: 4,
    zoomControl: true,
  });

  // Dark map tiles (CartoDB dark matter)
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://carto.com/">CARTO</a> &copy; OpenStreetMap contributors',
    subdomains: 'abcd',
    maxZoom: 19,
  }).addTo(map);

  markersLayer = L.layerGroup().addTo(map);
}

// ── Geocoding (Nominatim) ──
async function geocode(locationStr) {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(locationStr)}&format=json&limit=1`;
  const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
  if (!res.ok) throw new Error('Geocoding request failed');
  const data = await res.json();
  if (!data.length) throw new Error(`Could not find location: "${locationStr}"`);
  return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon), display: data[0].display_name };
}

// ── Form submit ──
huntForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideError();

  const animal   = document.getElementById('f-animal').value.trim();
  const gun      = document.getElementById('f-gun').value.trim();
  const date     = document.getElementById('f-date').value;
  const result   = document.getElementById('f-result').value;
  const location = document.getElementById('f-location').value.trim();
  const notes    = document.getElementById('f-notes').value.trim();

  if (!animal || !gun || !date || !location) {
    showError('Please fill in Animal, Firearm, Date, and Location.');
    return;
  }

  setLoading(true);

  try {
    const geo = await geocode(location);

    const hunt = {
      id:          crypto.randomUUID(),
      animal,
      gun,
      date,
      result,
      location,
      notes,
      lat:         geo.lat,
      lng:         geo.lng,
      displayName: geo.display,
      createdAt:   Date.now(),
    };

    hunts.unshift(hunt);
    saveHunts();
    renderList();
    renderMarkers();
    flyToHunt(hunt);
    huntForm.reset();
  } catch (err) {
    showError(err.message || 'Something went wrong. Try again.');
  } finally {
    setLoading(false);
  }
});

// ── Render hunt list ──
function renderList(filter = '') {
  const q = filter.toLowerCase();
  const filtered = hunts.filter(h =>
    !q ||
    h.animal.toLowerCase().includes(q) ||
    h.location.toLowerCase().includes(q) ||
    h.gun.toLowerCase().includes(q) ||
    h.result.toLowerCase().includes(q)
  );

  logCount.textContent = hunts.length;

  if (!filtered.length) {
    huntList.innerHTML = `<li class="empty-state">${
      q ? `No results for "${filter}".` : 'No hunts logged yet. Add your first entry above.'
    }</li>`;
    return;
  }

  huntList.innerHTML = filtered.map(h => `
    <li class="hunt-card result-${h.result}" tabindex="0"
        data-id="${h.id}"
        role="button"
        aria-label="View hunt: ${h.animal} on ${formatDate(h.date)}">
      <div class="card-top">
        <span class="card-animal">${escHtml(h.animal)}</span>
        <span class="result-pill ${h.result}">${h.result}</span>
      </div>
      <div class="card-meta">
        <span>📅 ${formatDate(h.date)}</span>
        <span>📍 ${escHtml(h.location)}</span>
        <span>🔫 ${escHtml(h.gun)}</span>
      </div>
      <button class="card-locate-btn" title="Fly to on map" data-locate="${h.id}">
        🗺 Locate
      </button>
    </li>
  `).join('');

  // Card click → open modal
  huntList.querySelectorAll('.hunt-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.card-locate-btn')) return;
      openModal(card.dataset.id);
    });
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') openModal(card.dataset.id);
    });
  });

  // Locate button → fly to
  huntList.querySelectorAll('.card-locate-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const h = hunts.find(x => x.id === btn.dataset.locate);
      if (h) flyToHunt(h);
    });
  });
}

// ── Render map markers ──
function renderMarkers() {
  markersLayer.clearLayers();

  if (!hunts.length) return;

  hunts.forEach(h => {
    const icon = L.divIcon({
      className: '',
      html: `<div class="custom-marker ${h.result}"><span class="inner">${animalEmoji(h.animal)}</span></div>`,
      iconSize: [36, 36],
      iconAnchor: [18, 36],
      popupAnchor: [0, -38],
    });

    const marker = L.marker([h.lat, h.lng], { icon })
      .addTo(markersLayer)
      .bindPopup(buildPopupHTML(h), { maxWidth: 260, closeButton: true });

    marker.on('popupopen', () => {
      hideOverlay();
      // Wire up the "View Details" button inside popup
      setTimeout(() => {
        const btn = document.querySelector(`.popup-open-btn[data-id="${h.id}"]`);
        if (btn) btn.addEventListener('click', () => openModal(h.id));
      }, 50);
    });
  });

  // Hide the hint overlay once markers exist
  if (hunts.length) hideOverlay();
}

function buildPopupHTML(h) {
  return `
    <div class="popup-animal">${escHtml(h.animal)}</div>
    <div class="popup-meta">
      📅 ${formatDate(h.date)}<br>
      🔫 ${escHtml(h.gun)}<br>
      📍 ${escHtml(h.location)}
    </div>
    <span class="result-pill ${h.result}" style="margin-bottom:8px;display:inline-block">${h.result}</span><br>
    <button class="popup-open-btn" data-id="${h.id}">View Details</button>
  `;
}

// ── Fly to hunt location ──
function flyToHunt(h) {
  map.flyTo([h.lat, h.lng], 10, { duration: 1.2 });

  // Open the marker's popup
  markersLayer.eachLayer(layer => {
    const ll = layer.getLatLng();
    if (Math.abs(ll.lat - h.lat) < 0.0001 && Math.abs(ll.lng - h.lng) < 0.0001) {
      layer.openPopup();
    }
  });
}

// ── Modal ──
function openModal(id) {
  const h = hunts.find(x => x.id === id);
  if (!h) return;
  activeHuntId = id;

  document.getElementById('modal-result-badge').innerHTML =
    `<span class="result-pill ${h.result}">${h.result}</span>`;
  document.getElementById('modal-animal').textContent = h.animal.toUpperCase();
  document.getElementById('modal-meta').textContent = `${formatDate(h.date)} · ${h.location}`;

  document.getElementById('modal-grid').innerHTML = `
    <div class="modal-field">
      <div class="modal-field-label">Firearm</div>
      <div class="modal-field-value">${escHtml(h.gun)}</div>
    </div>
    <div class="modal-field">
      <div class="modal-field-label">Result</div>
      <div class="modal-field-value">${h.result}</div>
    </div>
    <div class="modal-field" style="grid-column:1/-1">
      <div class="modal-field-label">GPS / Location</div>
      <div class="modal-field-value">${escHtml(h.displayName || h.location)}</div>
    </div>
  `;

  document.getElementById('modal-notes').textContent =
    h.notes || 'No notes recorded for this hunt.';

  modalBackdrop.classList.remove('hidden');
  modalClose.focus();
}

function closeModal() {
  modalBackdrop.classList.add('hidden');
  activeHuntId = null;
}

modalClose.addEventListener('click', closeModal);
modalBackdrop.addEventListener('click', (e) => {
  if (e.target === modalBackdrop) closeModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
});

modalDelete.addEventListener('click', () => {
  if (!activeHuntId) return;
  if (!confirm('Delete this hunt entry? This cannot be undone.')) return;
  hunts = hunts.filter(h => h.id !== activeHuntId);
  saveHunts();
  renderList(searchInput.value);
  renderMarkers();
  closeModal();
});

// ── Search ──
searchInput.addEventListener('input', () => {
  renderList(searchInput.value);
});

// ── Sidebar toggle (mobile) ──
const sidebar = document.getElementById('sidebar');
document.getElementById('sidebar-toggle').addEventListener('click', () => {
  sidebar.classList.toggle('open');
});

// ── Helpers ──
function saveHunts() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(hunts));
}

function loadHunts() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-');
  return new Date(+y, +m - 1, +d).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric'
  });
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function animalEmoji(animal) {
  const a = animal.toLowerCase();
  if (a.includes('deer') || a.includes('buck') || a.includes('doe')) return '🦌';
  if (a.includes('elk'))    return '🦌';
  if (a.includes('bear'))   return '🐻';
  if (a.includes('turkey')) return '🦃';
  if (a.includes('duck') || a.includes('goose') || a.includes('bird')) return '🦆';
  if (a.includes('boar') || a.includes('hog') || a.includes('pig'))    return '🐗';
  if (a.includes('rabbit') || a.includes('hare')) return '🐇';
  if (a.includes('pheasant') || a.includes('quail')) return '🐦';
  if (a.includes('fox'))    return '🦊';
  if (a.includes('coyote')) return '🐺';
  return '🎯';
}

function setLoading(on) {
  submitBtn.disabled = on;
  btnText.classList.toggle('hidden', on);
  btnSpinner.classList.toggle('visible', on);
  btnSpinner.style.display = on ? 'inline' : 'none';
}

function showError(msg) {
  formError.textContent = msg;
  formError.classList.remove('hidden');
}

function hideError() {
  formError.classList.add('hidden');
}

function hideOverlay() {
  mapOverlay.classList.add('hidden');
}
