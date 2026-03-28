// ============================================================
// DmnTV | app.js
// ============================================================

const AppConfig = {
    startHour:    20,
    startMinute:  37,
    endHour:      23,
    endMinute:    30,
    dataUrl:      'data.json',
    loopSchedule: true,
    upNextSec:    15
};

const AppState = {
    scheduleData:   [],
    currentVideoId: null,
    intervalId:     null
};

let hlsInstance = null;

// --- BAŞLATMA ---
document.addEventListener('DOMContentLoaded', () => {
    setupFullscreen();
    loadAndStart();
});

async function loadAndStart() {
    await fetchSchedule();
    startLoop();
}

// --- VERİ ---
async function fetchSchedule() {
    try {
        const res = await fetch(AppConfig.dataUrl + '?t=' + Date.now());
        if (!res.ok) throw new Error(res.status);
        const data = await res.json();
        buildSchedule(data);
        renderSchedule();
    } catch (e) {
        console.error('data.json yüklenemedi:', e);
        setTimeout(loadAndStart, 5000);
    }
}

function buildSchedule(data) {
    const now = new Date();
    let ptr = new Date(now.getFullYear(), now.getMonth(), now.getDate(),
                       AppConfig.startHour, AppConfig.startMinute, 0);
    AppState.scheduleData = data.map(v => {
        const startTime = new Date(ptr);
        ptr = new Date(ptr.getTime() + v.durationSeconds * 1000);
        return { ...v, startTime, endTime: new Date(ptr) };
    });
}

// --- ANA DÖNGÜ ---
function startLoop() {
    if (AppState.intervalId) clearInterval(AppState.intervalId);
    AppState.intervalId = setInterval(tick, 1000);
    tick();
}

function tick() {
    const now = new Date();
    updateClock(now);
    if (!AppState.scheduleData.length) return;

    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(),
                              AppConfig.startHour, AppConfig.startMinute, 0);
    const dayEnd   = new Date(now.getFullYear(), now.getMonth(), now.getDate(),
                              AppConfig.endHour, AppConfig.endMinute, 0);

    if (now < dayStart || now >= dayEnd) { showOffline(now, dayStart, dayEnd); return; }

    let current = AppState.scheduleData.find(v => now >= v.startTime && now < v.endTime);

    // if (!current && AppConfig.loopSchedule) {
    //     const last = AppState.scheduleData[AppState.scheduleData.length - 1];
    //     if (last && now >= last.endTime) {
    //         reloop(last.endTime);
    //         current = AppState.scheduleData.find(v => now >= v.startTime && now < v.endTime);
    //     }
    // }

    if (current) {
        playIfChanged(current, now);
        updateBanner(current, now);
        updateProgressBar(current, now); // YENİ EKLENEN SATIR
    } else {
        showFallback(now);
    }

    if (current) {
        playIfChanged(current, now);
        updateBanner(current, now);
    } else {
        showFallback(now);
    }
}

function reloop(fromTime) {
    let ptr = new Date(fromTime);
    AppState.scheduleData = AppState.scheduleData.map(v => {
        const startTime = new Date(ptr);
        ptr = new Date(ptr.getTime() + v.durationSeconds * 1000);
        return { ...v, startTime, endTime: new Date(ptr) };
    });
    AppState.currentVideoId = null;
}

// --- OYNATICI ---
function playIfChanged(video, now) {
    showScreen('videoWrapper');
    if (AppState.currentVideoId === video.id) return;
    AppState.currentVideoId = video.id;
    const offset = Math.max(0, Math.floor((now - video.startTime) / 1000));
    playVideo(video, offset);
    updateNowPlaying(video);
    highlightSchedule(video.id);
}

function playVideo(video, offset) {
    const ytBox    = document.getElementById('ytContainer');
    const native   = document.getElementById('nativePlayer');
    const iframeEl = document.getElementById('iframePlayer');

    ytBox.style.display = 'none'; ytBox.innerHTML = '';
    native.style.display = 'none'; native.pause(); native.removeAttribute('src'); native.load();
    iframeEl.style.display = 'none'; iframeEl.removeAttribute('src');
    if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null; }

    switch (video.type) {
        case 'youtube': {
            ytBox.style.display = 'block';
            const ifr = document.createElement('iframe');
            ifr.src = 'https://www.youtube.com/embed/' + video.url +
                      '?autoplay=1&start=' + offset + '&controls=1&rel=0&modestbranding=1&playsinline=1';
            ifr.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen';
            ifr.allowFullscreen = true;
            ifr.style.cssText = 'width:100%;height:100%;border:none;';
            ytBox.appendChild(ifr);
            break;
        }
        case 'mp4': {
            native.style.display = 'block';
            native.src = video.url;
            native.load();
            native.addEventListener('loadedmetadata', function h() {
                native.removeEventListener('loadedmetadata', h);
                native.currentTime = offset;
                native.play().catch(() => { native.muted = true; native.play(); });
            });
            native.onerror = () => showFallback(new Date());
            break;
        }
        case 'm3u8': {
            native.style.display = 'block';
            if (typeof Hls !== 'undefined' && Hls.isSupported()) {
                hlsInstance = new Hls({ startPosition: offset });
                hlsInstance.loadSource(video.url);
                hlsInstance.attachMedia(native);
                hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
                    native.play().catch(() => { native.muted = true; native.play(); });
                });
                hlsInstance.on(Hls.Events.ERROR, (_, d) => { if (d.fatal) showFallback(new Date()); });
            } else if (native.canPlayType('application/vnd.apple.mpegurl')) {
                native.src = video.url;
                native.addEventListener('loadedmetadata', function h() {
                    native.removeEventListener('loadedmetadata', h);
                    native.currentTime = offset;
                    native.play().catch(e => console.warn(e));
                });
            }
            break;
        }
        case 'iframe':
        default: {
            iframeEl.style.display = 'block';
            iframeEl.src = video.url;
            break;
        }
    }
}

// --- EKRANLAR ---
function showScreen(id) {
    ['videoWrapper','offlineScreen','fallbackScreen','loadingScreen'].forEach(s => {
        const el = document.getElementById(s);
        if (el) el.classList.toggle('hidden', s !== id);
    });
    toggleBanner(false);
}

function showOffline(now, dayStart, dayEnd) {
    let next = new Date(dayStart);
    if (now >= dayEnd) next.setDate(next.getDate() + 1);
    document.getElementById('offlineNextTime').textContent = fmt(next);
    AppState.currentVideoId = null;
    showScreen('offlineScreen');
}

function showFallback(now) {
    const next = AppState.scheduleData.find(v => v.startTime > now);
    document.getElementById('nextShowTime').textContent = next
        ? fmt(next.startTime)
        : fmt(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1,
                       AppConfig.startHour, AppConfig.startMinute, 0));
    AppState.currentVideoId = null;
    showScreen('fallbackScreen');
}

// --- BANNER ---
function updateBanner(current, now) {
    const rem = Math.floor((current.endTime - now) / 1000);
    const idx = AppState.scheduleData.findIndex(v => v.id === current.id);
    const next = AppState.scheduleData[idx + 1] ||
                 (AppConfig.loopSchedule ? AppState.scheduleData[0] : null);
    if (rem <= AppConfig.upNextSec && rem > 0 && next) {
        document.getElementById('upNextTitle').textContent = next.title;
        toggleBanner(true);
    } else {
        toggleBanner(false);
    }
}

function toggleBanner(show) {
    document.getElementById('upNextBanner').classList.toggle('show', show);
}

// --- UI ---
function updateClock(d) {
    document.getElementById('liveClock').textContent = d.toLocaleTimeString('tr-TR');
}

function updateNowPlaying(v) {
    document.getElementById('currentTitle').textContent = v.title || '—';
    document.getElementById('currentDesc').textContent  = v.description || '';
}

function renderSchedule() {
    const list = document.getElementById('scheduleList');
    list.innerHTML = '';
    AppState.scheduleData.forEach(v => {
        const li = document.createElement('li');
        li.id = 'sch-' + v.id;
        li.innerHTML = '<span class="sch-title">' + v.title + '</span>' +
                       '<span class="sch-time">' + fmt(v.startTime) + '</span>';
        list.appendChild(li);
    });
}

function highlightSchedule(id) {
    document.querySelectorAll('#scheduleList li').forEach(li => li.classList.remove('active'));
    const el = document.getElementById('sch-' + id);
    if (el) { el.classList.add('active'); el.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
}

// --- TAM EKRAN ---
function setupFullscreen() {
    document.getElementById('fullscreenBtn').addEventListener('click', () => {
        const el = document.getElementById('playerContainer');
        if (document.fullscreenElement || document.webkitFullscreenElement) {
            (document.exitFullscreen || document.webkitExitFullscreen).call(document);
        } else {
            (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
        }
    });
    ['fullscreenchange','webkitfullscreenchange'].forEach(e =>
        document.addEventListener(e, () => {
            const fs = !!(document.fullscreenElement || document.webkitFullscreenElement);
            document.getElementById('fullscreenBtn').textContent = fs ? '🗗 Küçült' : '📺 Tam Ekran';
        })
    );
}

function fmt(d) {
    return d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
}

// --- İLERLEME ÇUBUĞU (YENİ) ---
function updateProgressBar(current, now) {
    const totalDuration = current.endTime - current.startTime;
    const elapsed = now - current.startTime;
    const remaining = current.endTime - now;

    // Yüzdelik dilimi hesapla (0 ile 100 arasında sınırla)
    const percent = Math.min(100, Math.max(0, (elapsed / totalDuration) * 100));
    document.getElementById('progressBar').style.width = percent + '%';

    // Süreleri metin olarak yazdır
    document.getElementById('progressElapsed').textContent = formatDuration(Math.floor(elapsed / 1000));
    document.getElementById('progressRemaining').textContent = "-" + formatDuration(Math.floor(remaining / 1000));
}

// Saniyeyi mm:ss formatına çeviren yardımcı fonksiyon
function formatDuration(seconds) {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return m + ':' + s;
}
