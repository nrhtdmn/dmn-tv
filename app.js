// --- UYGULAMA AYARLARI ---
const AppConfig = {
    startHour: 19,
    startMinute: 17,
    endHour: 23,
    endMinute: 30,
    dataUrl: 'data.json'
};

// --- UYGULAMA DURUMU (State) ---
const AppState = {
    scheduleData: [],
    currentVideoId: null,
    intervalId: null
};

// --- BAŞLATMA ---
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(initApp, 500); // Kütüphanelerin yüklenmesi için ufak bir tolerans
});

async function initApp() {
    await fetchSchedule();
    setupFullscreen();
    
    // Döngüyü başlat
    AppState.intervalId = setInterval(checkBroadcastLoop, 1000);
    checkBroadcastLoop(); // İlk tetikleme
}

// --- VERİ ÇEKME VE HESAPLAMA ---
async function fetchSchedule() {
    try {
        const response = await fetch(AppConfig.dataUrl);
        if (!response.ok) throw new Error('Ağ yanıtı başarısız.');
        const data = await response.json();
        
        calculateTimes(data);
        renderScheduleUI();
    } catch (error) {
        console.error("Yayın akışı yüklenemedi:", error);
        document.getElementById('currentTitle').innerText = "Bağlantı Hatası!";
        document.getElementById('currentDesc').innerText = "Yayın akışı alınamıyor.";
    }
}

function calculateTimes(data) {
    const now = new Date();
    // Yayının başlangıç saatini bugünün tarihine göre kur
    let pointerTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), AppConfig.startHour, AppConfig.startMinute, 0);

    AppState.scheduleData = data.map(video => {
        const startTime = new Date(pointerTime);
        pointerTime.setSeconds(pointerTime.getSeconds() + video.durationSeconds);
        const endTime = new Date(pointerTime);
        return { ...video, startTime, endTime };
    });
}

// --- ANA DÖNGÜ VE KONTROLLER ---
function checkBroadcastLoop() {
    const now = new Date();
    
    updateClock(now);
    
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), AppConfig.startHour, AppConfig.startMinute, 0);
    const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), AppConfig.endHour, AppConfig.endMinute, 0);

    // 1. YAYIN SAATİ DIŞI KONTROLÜ
    if (now < startOfDay || now >= endOfDay) {
        handleOfflineState(now, startOfDay, endOfDay);
        return;
    }

    // 2. AKTİF VİDEO KONTROLÜ
    const currentVideo = AppState.scheduleData.find(v => now >= v.startTime && now < v.endTime);

    if (currentVideo) {
        handleActiveVideo(currentVideo, now);
    } else {
        // 3. VİDEO BİTTİ AMA YAYIN SAATİ İÇİNDEYİZ (Boşluk/Fallback)
        handleFallbackState(now);
    }
}

// --- DURUM YÖNETİCİLERİ ---
function handleOfflineState(now, startOfDay, endOfDay) {
    let nextStart = new Date(startOfDay);
    if (now >= endOfDay) {
        nextStart.setDate(nextStart.getDate() + 1); // Ertesi gün
    }
    
    document.getElementById('offlineNextTime').innerText = formatTime(nextStart);
    toggleBanner(false);
    showScreen('offlineScreen');
}

function handleActiveVideo(currentVideo, now) {
    if (AppState.currentVideoId !== currentVideo.id) {
        AppState.currentVideoId = currentVideo.id;
        const offsetSeconds = Math.floor((now - currentVideo.startTime) / 1000);
        
        playVideo(currentVideo, offsetSeconds);
        updateInfoUI(currentVideo);
        highlightSchedule(currentVideo.id);
    }
    
    // Banner (Sıradaki Video) Mantığı
    const remainingSeconds = Math.floor((currentVideo.endTime - now) / 1000);
    const nextVideo = AppState.scheduleData.find(v => v.startTime >= currentVideo.endTime && v.id !== currentVideo.id);
    
    if (remainingSeconds <= 15 && remainingSeconds > 0 && nextVideo) {
        document.getElementById('upNextTitle').innerText = nextVideo.title;
        toggleBanner(true);
    } else {
        toggleBanner(false);
    }
}

function handleFallbackState(now) {
    const nextVideo = AppState.scheduleData.find(v => v.startTime > now);
    const nextShowTimeEl = document.getElementById('nextShowTime');
    
    if (nextVideo) {
        nextShowTimeEl.innerText = formatTime(nextVideo.startTime);
    } else {
        let tomorrowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, AppConfig.startHour, AppConfig.startMinute, 0);
        nextShowTimeEl.innerText = "Yarın " + formatTime(tomorrowStart);
    }
    
    toggleBanner(false);
    showScreen('fallbackScreen');
}

// --- VİDEO OYNATICI (PLAYER) ---
function playVideo(video, offsetSeconds) {
    showScreen('videoWrapper');
    const wrapper = document.getElementById('videoWrapper');
    wrapper.innerHTML = ''; // Önceki oynatıcıyı temizle

    let playerElement;

    switch (video.type) {
        case 'youtube':
            playerElement = document.createElement('iframe');
            playerElement.src = `https://www.youtube.com/embed/${video.url}?autoplay=1&start=${offsetSeconds}&controls=1&rel=0&enablejsapi=1&origin=${window.location.origin}`;
            playerElement.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen";
            break;

        case 'mp4':
            playerElement = document.createElement('video');
            playerElement.src = `${video.url}#t=${offsetSeconds}`;
            playerElement.autoplay = true;
            playerElement.controls = true;
            playerElement.onerror = () => handleFallbackState(new Date());
            break;

        case 'm3u8':
            playerElement = document.createElement('video');
            playerElement.autoplay = true;
            playerElement.controls = true;
            
            if (typeof Hls !== 'undefined' && Hls.isSupported()) {
                const hls = new Hls();
                hls.loadSource(video.url);
                hls.attachMedia(playerElement);
                hls.on(Hls.Events.MANIFEST_PARSED, () => {
                    playerElement.currentTime = offsetSeconds;
                    playerElement.play().catch(e => console.warn("Otomatik oynatma engellendi", e));
                });
            } else if (playerElement.canPlayType('application/vnd.apple.mpegurl')) {
                playerElement.src = video.url;
                playerElement.addEventListener('loadedmetadata', () => {
                    playerElement.currentTime = offsetSeconds;
                    playerElement.play();
                });
            }
            break;

        case 'iframe':
        default:
            playerElement = document.createElement('iframe');
            playerElement.src = video.url;
            playerElement.allow = "autoplay; fullscreen";
            break;
    }

    if (playerElement) {
        playerElement.style.width = "100%";
        playerElement.style.height = "100%";
        playerElement.frameBorder = "0";
        wrapper.appendChild(playerElement);
    }
}

// --- UI KONTROLLERİ ---
function showScreen(screenId) {
    const screens = ['videoWrapper', 'fallbackScreen', 'offlineScreen'];
    
    screens.forEach(id => {
        const el = document.getElementById(id);
        if (id === screenId) {
            el.classList.remove('hidden');
        } else {
            el.classList.add('hidden');
            // Ekranda video yoksa arkaplan belleğini temizle
            if (id === 'videoWrapper') {
                el.innerHTML = ''; 
                if (screenId !== 'videoWrapper') AppState.currentVideoId = null;
            }
        }
    });
}

function updateClock(dateObject) {
    const clockElement = document.getElementById('liveClock');
    if (clockElement) clockElement.innerText = dateObject.toLocaleTimeString('tr-TR');
}

function toggleBanner(show) {
    const banner = document.getElementById('upNextBanner');
    if (!banner) return;
    show ? banner.classList.add('show') : banner.classList.remove('show');
}

function updateInfoUI(video) {
    document.getElementById('currentTitle').innerText = video.title || "Bilinmiyor";
    document.getElementById('currentDesc').innerText = video.description || "";
}

function renderScheduleUI() {
    const list = document.getElementById('scheduleList');
    list.innerHTML = '';
    
    AppState.scheduleData.forEach(video => {
        const li = document.createElement('li');
        li.id = `schedule-${video.id}`;
        li.innerHTML = `<span>${video.title}</span><span>${formatTime(video.startTime)}</span>`;
        list.appendChild(li);
    });
}

function highlightSchedule(id) {
    document.querySelectorAll('#scheduleList li').forEach(li => li.classList.remove('active'));
    const activeLi = document.getElementById(`schedule-${id}`);
    if (activeLi) activeLi.classList.add('active');
}

// --- YARDIMCI FONKSİYONLAR ---
function formatTime(date) { 
    return date.toLocaleTimeString('tr-TR', { hour: '2-digit', minute:'2-digit' }); 
}

function setupFullscreen() {
    const btn = document.getElementById('fullscreenBtn');
    const playerSection = document.getElementById('playerContainer');
    
    btn.addEventListener('click', () => {
        if (!document.fullscreenElement) {
            playerSection.requestFullscreen().catch(err => console.error("Tam ekran hatası:", err));
        } else {
            document.exitFullscreen();
        }
    });
}