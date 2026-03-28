// ============================================================
// DmnTV - Çocuk Kanalı | app.js (v2.0)
// ============================================================

// --- UYGULAMA AYARLARI ---
const AppConfig = {
    startHour: 19,
    startMinute: 24,
    endHour: 23,
    endMinute: 30,
    dataUrl: 'data.json',
    parentPin: '1234',          // Ebeveyn kilidi PIN'i - değiştirebilirsin
    upNextThresholdSec: 15,     // Kaç saniye kala "Sıradaki" banneri çıksın
    loopSchedule: true,         // Program bitince başa dönsün mü?
    autoUnmuteAfterStart: true  // TV açıldıktan 1 sn sonra otomatik unmute
};

// --- UYGULAMA DURUMU ---
const AppState = {
    scheduleData: [],
    currentVideoId: null,
    intervalId: null,
    isStarted: false,
    isMuted: true,              // Başlangıçta muted (autoplay policy)
    sleepTimerId: null,
    sleepRemainingMs: 0,
    pinBuffer: '',
    pinAction: null             // 'stop' vs ileride farklı aksiyonlar için
};

let hlsInstance = null;

// ============================================================
// BAŞLATMA
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
    fetchSchedule();
    setupFullscreen();
    setupMuteButton();
    setupSleepTimer();
    setupParentalControls();

    document.getElementById('startTvBtn').addEventListener('click', startTV);
    document.getElementById('reopenTvBtn')?.addEventListener('click', startTV);
    document.getElementById('stopTvBtn').addEventListener('click', () => showParentModal('stop'));
});

function startTV() {
    AppState.isStarted = true;
    AppState.currentVideoId = null;

    document.getElementById('startScreen').classList.add('hidden');
    document.getElementById('stoppedScreen').classList.add('hidden');
    document.getElementById('stopTvBtn').classList.remove('hidden');

    // Autoplay policy: sessiz başla, 1 sn sonra unmute et
    setMuted(true);
    if (AppConfig.autoUnmuteAfterStart) {
        setTimeout(() => setMuted(false), 1000);
    }

    if (AppState.intervalId) clearInterval(AppState.intervalId);
    AppState.intervalId = setInterval(checkBroadcastLoop, 1000);
    checkBroadcastLoop();
}

function stopTV() {
    AppState.isStarted = false;
    AppState.currentVideoId = null;

    clearInterval(AppState.intervalId);
    AppState.intervalId = null;

    // Tüm oynatıcıları durdur
    cleanupPlayers();

    // Uyku zamanlayıcı varsa iptal et
    if (AppState.sleepTimerId) {
        clearTimeout(AppState.sleepTimerId);
        AppState.sleepTimerId = null;
    }

    document.getElementById('stopTvBtn').classList.add('hidden');
    document.getElementById('progressBar').classList.add('hidden');
    toggleBanner(false);
    showScreen('stoppedScreen');
}

// ============================================================
// VERİ ÇEKME VE HESAPLAMA
// ============================================================
async function fetchSchedule() {
    try {
        // Cache bypass için timestamp ekle
        const url = `${AppConfig.dataUrl}?t=${Date.now()}`;
        const response = await fetch(url);
        if (!response.ok) throw new Error('Veri çekme başarısız: ' + response.status);
        const data = await response.json();

        calculateTimes(data);
        renderScheduleUI();
    } catch (error) {
        console.error('Yayın akışı yüklenemedi:', error);
        // Yeniden dene
        setTimeout(fetchSchedule, 5000);
    }
}

function calculateTimes(data) {
    const now = new Date();
    let pointerTime = new Date(
        now.getFullYear(), now.getMonth(), now.getDate(),
        AppConfig.startHour, AppConfig.startMinute, 0
    );

    AppState.scheduleData = data.map(video => {
        const startTime = new Date(pointerTime);
        pointerTime = new Date(pointerTime.getTime() + video.durationSeconds * 1000);
        const endTime = new Date(pointerTime);
        return { ...video, startTime, endTime };
    });
}

// ============================================================
// ANA DÖNGÜ
// ============================================================
function checkBroadcastLoop() {
    if (!AppState.isStarted) return;

    const now = new Date();
    updateClock(now);

    if (AppState.scheduleData.length === 0) return; // Veri henüz gelmedi

    const startOfDay = new Date(
        now.getFullYear(), now.getMonth(), now.getDate(),
        AppConfig.startHour, AppConfig.startMinute, 0
    );
    const endOfDay = new Date(
        now.getFullYear(), now.getMonth(), now.getDate(),
        AppConfig.endHour, AppConfig.endMinute, 0
    );

    // 1. YAYIN SAATİ DIŞI
    if (now < startOfDay || now >= endOfDay) {
        handleOfflineState(now, startOfDay, endOfDay);
        return;
    }

    // 2. AKTİF VİDEO
    let currentVideo = AppState.scheduleData.find(v => now >= v.startTime && now < v.endTime);

    // 3. DÖNGÜ: Tüm videolar bittiyse ve loopSchedule açıksa yeniden hesapla
    if (!currentVideo && AppConfig.loopSchedule && now >= startOfDay && now < endOfDay) {
        const lastEnd = AppState.scheduleData[AppState.scheduleData.length - 1]?.endTime;
        if (lastEnd && now >= lastEnd) {
            // Tüm programı son video bitişinden itibaren yeniden zamanla
            reloopSchedule(lastEnd);
            currentVideo = AppState.scheduleData.find(v => now >= v.startTime && now < v.endTime);
        }
    }

    if (currentVideo) {
        handleActiveVideo(currentVideo, now);
    } else {
        handleFallbackState(now);
    }
}

function reloopSchedule(fromTime) {
    let pointer = new Date(fromTime);
    AppState.scheduleData = AppState.scheduleData.map(video => {
        const startTime = new Date(pointer);
        pointer = new Date(pointer.getTime() + video.durationSeconds * 1000);
        const endTime = new Date(pointer);
        return { ...video, startTime, endTime };
    });
    AppState.currentVideoId = null; // Yeni döngüde yeniden oynat
}

// ============================================================
// DURUM YÖNETİCİLERİ
// ============================================================
function handleOfflineState(now, startOfDay, endOfDay) {
    let nextStart = new Date(startOfDay);
    if (now >= endOfDay) {
        nextStart.setDate(nextStart.getDate() + 1);
    }

    document.getElementById('offlineNextTime').innerText = formatTime(nextStart);
    toggleBanner(false);
    document.getElementById('progressBar').classList.add('hidden');
    showScreen('offlineScreen');
    cleanupPlayers();
    AppState.currentVideoId = null;
}

function handleActiveVideo(currentVideo, now) {
    if (AppState.currentVideoId !== currentVideo.id) {
        AppState.currentVideoId = currentVideo.id;
        const offsetSeconds = Math.max(0, Math.floor((now - currentVideo.startTime) / 1000));

        playVideo(currentVideo, offsetSeconds);
        updateInfoUI(currentVideo);
        highlightSchedule(currentVideo.id);
    }

    // İlerleme çubuğu güncelle
    updateProgressBar(currentVideo, now);

    // Up Next Banner
    const remainingSeconds = Math.floor((currentVideo.endTime - now) / 1000);
    const nextVideo = getNextVideo(currentVideo);

    if (remainingSeconds <= AppConfig.upNextThresholdSec && remainingSeconds > 0 && nextVideo) {
        document.getElementById('upNextTitle').innerText = nextVideo.title;
        toggleBanner(true);
    } else {
        toggleBanner(false);
    }
}

function handleFallbackState(now) {
    const nextVideo = AppState.scheduleData.find(v => v.startTime > now);

    if (nextVideo) {
        document.getElementById('nextShowTime').innerText = formatTime(nextVideo.startTime);
    } else {
        const tomorrowStart = new Date(
            now.getFullYear(), now.getMonth(), now.getDate() + 1,
            AppConfig.startHour, AppConfig.startMinute, 0
        );
        document.getElementById('nextShowTime').innerText = 'Yarın ' + formatTime(tomorrowStart);
    }

    toggleBanner(false);
    document.getElementById('progressBar').classList.add('hidden');
    showScreen('fallbackScreen');
    cleanupPlayers();
    AppState.currentVideoId = null;
}

function getNextVideo(currentVideo) {
    const idx = AppState.scheduleData.findIndex(v => v.id === currentVideo.id);
    if (idx !== -1 && idx < AppState.scheduleData.length - 1) {
        return AppState.scheduleData[idx + 1];
    }
    // Döngü varsa başa dön
    if (AppConfig.loopSchedule && AppState.scheduleData.length > 0) {
        return AppState.scheduleData[0];
    }
    return null;
}

// ============================================================
// VİDEO OYNATICI
// ============================================================
function playVideo(video, offsetSeconds) {
    showScreen('videoWrapper');

    const ytContainer  = document.getElementById('ytContainer');
    const nativePlayer = document.getElementById('nativePlayer');
    const iframePlayer = document.getElementById('iframePlayer');
    const iframeOverlay = document.getElementById('iframeOverlay');

    // Hepsini temizle
    cleanupPlayers();

    switch (video.type) {

        case 'youtube': {
            ytContainer.style.display = 'block';
            const iframe = document.createElement('iframe');
            // autoplay=1 muted başlangıçta sorun çıkarmaz, mute parametresi ekle
            const muted = AppState.isMuted ? '&mute=1' : '';
            iframe.src = [
                `https://www.youtube.com/embed/${video.url}`,
                `?autoplay=1`,
                `&start=${offsetSeconds}`,
                `&controls=1`,
                `&rel=0`,
                `&modestbranding=1`,
                `&playsinline=1`,
                muted
            ].join('');
            iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen';
            iframe.allowFullscreen = true;
            iframe.style.cssText = 'width:100%;height:100%;border:none;';
            ytContainer.appendChild(iframe);
            break;
        }

        case 'mp4': {
            nativePlayer.style.display = 'block';
            nativePlayer.muted = AppState.isMuted;
            nativePlayer.src = video.url;
            nativePlayer.load();
            nativePlayer.addEventListener('loadedmetadata', function onMeta() {
                nativePlayer.removeEventListener('loadedmetadata', onMeta);
                nativePlayer.currentTime = offsetSeconds;
                nativePlayer.play().catch(e => {
                    console.warn('MP4 autoplay engellendi, muted deneniyor:', e);
                    nativePlayer.muted = true;
                    nativePlayer.play().catch(e2 => console.error('MP4 oynatılamadı:', e2));
                });
            });
            nativePlayer.onerror = () => {
                console.error('MP4 yükleme hatası:', video.url);
                handleFallbackState(new Date());
            };
            break;
        }

        case 'm3u8': {
            nativePlayer.style.display = 'block';
            nativePlayer.muted = AppState.isMuted;

            if (typeof Hls !== 'undefined' && Hls.isSupported()) {
                hlsInstance = new Hls({ startPosition: offsetSeconds });
                hlsInstance.loadSource(video.url);
                hlsInstance.attachMedia(nativePlayer);
                hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
                    nativePlayer.play().catch(e => {
                        console.warn('HLS autoplay engellendi:', e);
                        nativePlayer.muted = true;
                        nativePlayer.play().catch(e2 => console.error('HLS oynatılamadı:', e2));
                    });
                });
                hlsInstance.on(Hls.Events.ERROR, (event, data) => {
                    if (data.fatal) {
                        console.error('HLS fatal hata:', data);
                        handleFallbackState(new Date());
                    }
                });
            } else if (nativePlayer.canPlayType('application/vnd.apple.mpegurl')) {
                // Safari native HLS
                nativePlayer.src = video.url;
                nativePlayer.addEventListener('loadedmetadata', function onMeta() {
                    nativePlayer.removeEventListener('loadedmetadata', onMeta);
                    nativePlayer.currentTime = offsetSeconds;
                    nativePlayer.play().catch(e => console.warn('Native HLS oynatılamadı:', e));
                });
            } else {
                console.error('HLS desteklenmiyor:', video.url);
                handleFallbackState(new Date());
            }
            break;
        }

        case 'iframe':
        default: {
            // iframe'lerde autoplay policy sorunu var.
            // Çözüm: overlay göster, kullanıcı tıklayınca iframe'i yükle.
            iframeOverlay.classList.remove('hidden');

            const playBtn = document.getElementById('iframePlayBtn');
            // Eski listener'ı temizle
            const newPlayBtn = playBtn.cloneNode(true);
            playBtn.parentNode.replaceChild(newPlayBtn, playBtn);

            newPlayBtn.addEventListener('click', () => {
                iframeOverlay.classList.add('hidden');
                iframePlayer.style.display = 'block';
                // iframe src'yi şimdi set et (tıklama user gesture sayılır)
                iframePlayer.src = video.url;
            }, { once: true });
            break;
        }
    }
}

function cleanupPlayers() {
    const ytContainer  = document.getElementById('ytContainer');
    const nativePlayer = document.getElementById('nativePlayer');
    const iframePlayer = document.getElementById('iframePlayer');
    const iframeOverlay = document.getElementById('iframeOverlay');

    // YouTube
    ytContainer.style.display = 'none';
    ytContainer.innerHTML = '';

    // Native
    nativePlayer.style.display = 'none';
    nativePlayer.pause();
    nativePlayer.removeAttribute('src');
    nativePlayer.load();

    // HLS
    if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null; }

    // iframe
    iframePlayer.style.display = 'none';
    iframePlayer.removeAttribute('src');
    iframeOverlay.classList.add('hidden');
}

// ============================================================
// SES KONTROLÜ
// ============================================================
function setupMuteButton() {
    document.getElementById('muteBtn').addEventListener('click', () => {
        setMuted(!AppState.isMuted);
    });
}

function setMuted(muted) {
    AppState.isMuted = muted;
    const btn = document.getElementById('muteBtn');
    btn.textContent = muted ? '🔇' : '🔊';

    // Native player'ı güncelle
    const np = document.getElementById('nativePlayer');
    np.muted = muted;

    // YouTube için postMessage (iframe embed api)
    const ytIframe = document.querySelector('#ytContainer iframe');
    if (ytIframe) {
        try {
            const cmd = muted
                ? '{"event":"command","func":"mute","args":""}'
                : '{"event":"command","func":"unMute","args":""}';
            ytIframe.contentWindow.postMessage(cmd, '*');
        } catch (e) { /* cross-origin, yok sayılabilir */ }
    }
}

// ============================================================
// UYKU ZAMANLAYICI
// ============================================================
function setupSleepTimer() {
    document.getElementById('sleepBtn').addEventListener('click', () => {
        document.getElementById('sleepModal').classList.remove('hidden');
    });

    document.getElementById('closeSleepModal').addEventListener('click', () => {
        document.getElementById('sleepModal').classList.add('hidden');
    });

    document.querySelectorAll('.btn--sleep').forEach(btn => {
        btn.addEventListener('click', () => {
            const minutes = parseInt(btn.dataset.minutes);
            setSleepTimer(minutes);
        });
    });
}

function setSleepTimer(minutes) {
    if (AppState.sleepTimerId) clearTimeout(AppState.sleepTimerId);

    const ms = minutes * 60 * 1000;
    AppState.sleepRemainingMs = ms;

    AppState.sleepTimerId = setTimeout(() => {
        stopTV();
        AppState.sleepTimerId = null;
    }, ms);

    const statusEl = document.getElementById('sleepStatus');
    statusEl.textContent = `⏰ ${minutes} dakika sonra kapanacak`;
    statusEl.classList.remove('hidden');

    // 3 saniye sonra modalı kapat
    setTimeout(() => {
        document.getElementById('sleepModal').classList.add('hidden');
    }, 2000);
}

// ============================================================
// EBEVEYN KİLİDİ
// ============================================================
function setupParentalControls() {
    document.getElementById('closeSleepModal').addEventListener('click', () => {
        document.getElementById('sleepModal').classList.add('hidden');
    });

    document.getElementById('closeParentModal').addEventListener('click', () => {
        closeParentModal();
    });

    document.querySelectorAll('.pin-btn[data-digit]').forEach(btn => {
        btn.addEventListener('click', () => {
            if (AppState.pinBuffer.length < 4) {
                AppState.pinBuffer += btn.dataset.digit;
                updatePinDisplay();
            }
        });
    });

    document.getElementById('pinClear').addEventListener('click', () => {
        AppState.pinBuffer = AppState.pinBuffer.slice(0, -1);
        updatePinDisplay();
    });

    document.getElementById('pinOk').addEventListener('click', checkPin);
}

function showParentModal(action) {
    AppState.pinAction = action;
    AppState.pinBuffer = '';
    updatePinDisplay();
    document.getElementById('pinError').classList.add('hidden');
    document.getElementById('parentModal').classList.remove('hidden');
}

function closeParentModal() {
    document.getElementById('parentModal').classList.add('hidden');
    AppState.pinBuffer = '';
    AppState.pinAction = null;
}

function updatePinDisplay() {
    const filled = '●'.repeat(AppState.pinBuffer.length);
    const empty = '○'.repeat(4 - AppState.pinBuffer.length);
    document.getElementById('pinDisplay').textContent = (filled + empty).split('').join(' ');
}

function checkPin() {
    if (AppState.pinBuffer === AppConfig.parentPin) {
        closeParentModal();
        if (AppState.pinAction === 'stop') stopTV();
    } else {
        document.getElementById('pinError').classList.remove('hidden');
        AppState.pinBuffer = '';
        updatePinDisplay();
        // Hata animasyonu tekrar tetikle
        const err = document.getElementById('pinError');
        err.style.animation = 'none';
        void err.offsetWidth;
        err.style.animation = '';
    }
}

// ============================================================
// İLERLEME ÇUBUĞU
// ============================================================
function updateProgressBar(video, now) {
    const bar = document.getElementById('progressBar');
    const fill = document.getElementById('progressFill');
    const label = document.getElementById('progressLabel');

    const total = video.durationSeconds;
    const elapsed = Math.floor((now - video.startTime) / 1000);
    const pct = Math.min(100, (elapsed / total) * 100);

    bar.classList.remove('hidden');
    fill.style.width = pct + '%';
    label.textContent = `${formatSeconds(elapsed)} / ${formatSeconds(total)}`;
}

function formatSeconds(secs) {
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
}

// ============================================================
// UI KONTROLLERİ
// ============================================================
function showScreen(screenId) {
    const screens = ['startScreen', 'videoWrapper', 'fallbackScreen', 'offlineScreen', 'stoppedScreen'];

    screens.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;

        if (id === screenId) {
            el.classList.remove('hidden');
        } else {
            el.classList.add('hidden');

            // Video wrapper'dan çıkınca temizle
            if (id === 'videoWrapper' && screenId !== 'videoWrapper') {
                cleanupPlayers();
            }
        }
    });
}

function updateClock(dateObject) {
    const el = document.getElementById('liveClock');
    if (el) el.innerText = dateObject.toLocaleTimeString('tr-TR');
}

function toggleBanner(show) {
    const banner = document.getElementById('upNextBanner');
    if (!banner) return;
    show ? banner.classList.add('show') : banner.classList.remove('show');
}

function updateInfoUI(video) {
    document.getElementById('currentTitle').innerText = video.title || 'Bilinmiyor';
    document.getElementById('currentDesc').innerText = video.description || '';

    const typeBadge = document.getElementById('currentType');
    const typeLabels = { youtube: '▶ YouTube', mp4: '🎬 Video', m3u8: '📡 Canlı', iframe: '🌐 Web' };
    typeBadge.textContent = typeLabels[video.type] || video.type;
}

function renderScheduleUI() {
    const list = document.getElementById('scheduleList');
    list.innerHTML = '';

    AppState.scheduleData.forEach(video => {
        const li = document.createElement('li');
        li.id = `schedule-${video.id}`;

        const titleSpan = document.createElement('span');
        titleSpan.className = 'item-title';
        titleSpan.textContent = video.title;

        const timeSpan = document.createElement('span');
        timeSpan.className = 'item-time';
        timeSpan.textContent = formatTime(video.startTime);

        li.appendChild(titleSpan);
        li.appendChild(timeSpan);
        list.appendChild(li);
    });
}

function highlightSchedule(id) {
    const now = new Date();
    document.querySelectorAll('#scheduleList li').forEach(li => {
        li.classList.remove('active', 'done');
    });

    // Geçmiş videoları "done" yap
    AppState.scheduleData.forEach(video => {
        if (video.endTime <= now) {
            const li = document.getElementById(`schedule-${video.id}`);
            if (li) li.classList.add('done');
        }
    });

    const activeLi = document.getElementById(`schedule-${id}`);
    if (activeLi) {
        activeLi.classList.add('active');
        activeLi.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

// ============================================================
// TAM EKRAN
// ============================================================
function setupFullscreen() {
    const btn = document.getElementById('fullscreenBtn');
    const container = document.getElementById('playerContainer');

    btn.addEventListener('click', () => {
        // iOS Safari için webkit prefix denemesi
        if (document.fullscreenElement || document.webkitFullscreenElement) {
            (document.exitFullscreen || document.webkitExitFullscreen).call(document);
        } else {
            const req = container.requestFullscreen || container.webkitRequestFullscreen;
            if (req) {
                req.call(container).catch(e => console.warn('Tam ekran hatası:', e));
            }
        }
    });

    document.addEventListener('fullscreenchange', updateFullscreenBtn);
    document.addEventListener('webkitfullscreenchange', updateFullscreenBtn);
}

function updateFullscreenBtn() {
    const isFs = !!(document.fullscreenElement || document.webkitFullscreenElement);
    document.getElementById('fullscreenBtn').textContent = isFs ? '🗗 Küçült' : '📺 Tam Ekran';
}

// ============================================================
// YARDIMCI FONKSİYONLAR
// ============================================================
function formatTime(date) {
    return date.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
}
