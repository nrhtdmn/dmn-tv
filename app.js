// --- UYGULAMA AYARLARI ---
const AppConfig = {
    startHour: 19,
    startMinute: 24,
    endHour: 23,
    endMinute: 30,
    dataUrl: 'data.json'
};

// --- UYGULAMA DURUMU (State) ---
const AppState = {
    scheduleData: [],
    currentVideoId: null,
    intervalId: null,
    isStarted: false // Kullanıcının TV'yi açıp açmadığını takip eder
};

let hlsInstance = null; // M3U8 Player örneği için global değişken

// --- BAŞLATMA ---
document.addEventListener('DOMContentLoaded', () => {
    fetchSchedule(); // Arka planda veriyi çekmeye başla
    setupFullscreen();

    // Televizyonu Aç butonunu dinle
    const startBtn = document.getElementById('startTvBtn');
    if (startBtn) {
        startBtn.addEventListener('click', startTV);
    }
});

function startTV() {
    AppState.isStarted = true;
    
    // Opsiyonel: Tıklandığında direkt tam ekrana geçir (İstemezsen bu satırı silebilirsin)
    // document.getElementById('playerContainer').requestFullscreen().catch(e => console.log(e));
    
    // Döngüyü başlat
    AppState.intervalId = setInterval(checkBroadcastLoop, 1000);
    checkBroadcastLoop(); // Beklemeden ilk tetiklemeyi yap
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
    if (!AppState.isStarted) return; // TV açılmadıysa bekle

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

// --- VİDEO OYNATICI (SABİT ELEMENTLERLE YENİ MANTIK) ---
function playVideo(video, offsetSeconds) {
    showScreen('videoWrapper'); // Ekranı aktifleştir
    
    // Oynatıcıları yakala
    const ytContainer = document.getElementById('ytContainer');
    const nativePlayer = document.getElementById('nativePlayer');
    const iframePlayer = document.getElementById('iframePlayer');

    // 1. Önce hepsini gizle ve sustur
    ytContainer.style.display = 'none';
    ytContainer.innerHTML = ''; 
    
    nativePlayer.style.display = 'none';
    nativePlayer.pause();
    nativePlayer.removeAttribute('src'); 
    
    iframePlayer.style.display = 'none';
    iframePlayer.removeAttribute('src'); 
    
    if (hlsInstance) {
        hlsInstance.destroy(); 
        hlsInstance = null;
    }

    // 2. Sadece gerekeni göster ve kaynağı yükle
    switch (video.type) {
        case 'youtube':
            ytContainer.style.display = 'block';
            const ytIframe = document.createElement('iframe');
            ytIframe.src = `https://www.youtube.com/embed/${video.url}?autoplay=1&start=${offsetSeconds}&controls=1&rel=0&enablejsapi=1&origin=${window.location.origin}`;
            ytIframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen";
            ytIframe.style.width = "100%";
            ytIframe.style.height = "100%";
            ytIframe.frameBorder = "0";
            ytContainer.appendChild(ytIframe);
            break;

        case 'mp4':
            nativePlayer.style.display = 'block';
            nativePlayer.src = `${video.url}#t=${offsetSeconds}`;
            nativePlayer.currentTime = offsetSeconds;
            nativePlayer.play().catch(e => console.warn("MP4 Oynatılamadı:", e));
            nativePlayer.onerror = () => handleFallbackState(new Date());
            break;

        case 'm3u8':
            nativePlayer.style.display = 'block';
            
            if (typeof Hls !== 'undefined' && Hls.isSupported()) {
                hlsInstance = new Hls();
                hlsInstance.loadSource(video.url);
                hlsInstance.attachMedia(nativePlayer);
                hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
                    nativePlayer.currentTime = offsetSeconds;
                    nativePlayer.play().catch(e => console.warn("HLS Oynatılamadı:", e));
                });
            } else if (nativePlayer.canPlayType('application/vnd.apple.mpegurl')) {
                nativePlayer.src = video.url;
                nativePlayer.addEventListener('loadedmetadata', () => {
                    nativePlayer.currentTime = offsetSeconds;
                    nativePlayer.play().catch(e => console.warn("Native HLS Oynatılamadı:", e));
                });
            }
            break;

        case 'iframe':
        default:
            iframePlayer.style.display = 'block';
            iframePlayer.src = video.url;
            break;
    }
}

// --- UI KONTROLLERİ ---
function showScreen(screenId) {
    const screens = ['startScreen', 'videoWrapper', 'fallbackScreen', 'offlineScreen'];
    
    screens.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        
        if (id === screenId) {
            el.classList.remove('hidden');
        } else {
            el.classList.add('hidden');
            
            // Eğer video ekranından çıkıyorsak (Yayın bitişi, mola vb.) arka plandaki sesi kes
            if (id === 'videoWrapper' && screenId !== 'videoWrapper') {
                AppState.currentVideoId = null;
                document.getElementById('ytContainer').innerHTML = '';
                const np = document.getElementById('nativePlayer');
                np.pause();
                np.removeAttribute('src');
                document.getElementById('iframePlayer').removeAttribute('src');
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