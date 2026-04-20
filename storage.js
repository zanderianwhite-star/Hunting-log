const STORAGE_KEY = 'hunting_log_v2';

function loadHunts() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
  catch { return []; }
}

function saveHunts(hunts) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(hunts));
}

function getHunt(id) {
  return loadHunts().find(h => h.id === id) || null;
}

function addHunt(hunt) {
  const hunts = loadHunts();
  hunts.unshift(hunt);
  saveHunts(hunts);
}

function updateHunt(updated) {
  const hunts = loadHunts().map(h => h.id === updated.id ? updated : h);
  saveHunts(hunts);
}

function deleteHunt(id) {
  saveHunts(loadHunts().filter(h => h.id !== id));
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-');
  return new Date(+y, +m - 1, +d).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric'
  });
}

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function animalEmoji(animal) {
  const a = (animal || '').toLowerCase();
  if (a.includes('deer') || a.includes('buck') || a.includes('doe') || a.includes('elk')) return '🦌';
  if (a.includes('bear'))   return '🐻';
  if (a.includes('turkey')) return '🦃';
  if (a.includes('duck') || a.includes('goose')) return '🦆';
  if (a.includes('boar') || a.includes('hog') || a.includes('pig')) return '🐗';
  if (a.includes('rabbit') || a.includes('hare')) return '🐇';
  if (a.includes('pheasant') || a.includes('quail') || a.includes('dove')) return '🐦';
  if (a.includes('fox')) return '🦊';
  if (a.includes('coyote') || a.includes('wolf')) return '🐺';
  if (a.includes('moose')) return '🫎';
  return '🎯';
}

async function geocode(locationStr) {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(locationStr)}&format=json&limit=1`;
  const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
  if (!res.ok) throw new Error('Geocoding request failed');
  const data = await res.json();
  if (!data.length) throw new Error(`Could not find: "${locationStr}"`);
  return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon), display: data[0].display_name };
}

async function compressImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const MAX = 900;
      let { width, height } = img;
      if (width > MAX || height > MAX) {
        if (width > height) { height = Math.round(height * MAX / width); width = MAX; }
        else { width = Math.round(width * MAX / height); height = MAX; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.72));
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = url;
  });
}
