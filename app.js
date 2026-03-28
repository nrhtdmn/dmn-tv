const START_HOUR = 18;
const START_MINUTE = 45;
const END_HOUR = 23;
const END_MINUTE = 30;

let scheduleData = [];
let currentVideoId = null;

document.addEventListener('DOMContentLoaded', async () => {
    // Kütüphanenin yüklendiğinden emin olmak için kısa bir bekleme
    setTimeout(async () => {
        await fetchSchedule();
        setupFullscreen();
        setInterval(checkBroadcastLoop, 1000);
        checkBroadcastLoop();
    }, 500);
});

async function fetchSchedule() {
    try {
        const response = await fetch('data.json');
        const data = await response.json();
        calculateTimes(data);
        renderScheduleUI();
    } catch (error) {
        console.error("Yayın akışı yüklenemedi:", error);
    }
}

function calculateTimes(data) {
    const now = new Date();
    let pointerTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), START_HOUR, START_MINUTE, 0);

    scheduleData = data.map(video => {
        const startTime = new Date(pointerTime);
        pointerTime.setSeconds(pointerTime.getSeconds() + video.durationSeconds);
        const endTime = new Date(pointerTime);
        return { ...video, startTime, endTime };
    });
}

function checkBroadcastLoop() {
    const now = new Date();
    
    // 1. Canlı Saati Güncelle
    const clockElement = document.getElementById('liveClock');
    if (clockElement) {
        clockElement.innerText = now.toLocaleTimeString('tr-TR');
    }
    
    // Yayın saatleri sınırlarını belirle
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), START_HOUR, START_MINUTE, 0);
    const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), END_HOUR, END_MINUTE, 0);

    // 2. YAYIN SAATİ DIŞINDAYSAK (Gece veya Sabah erken)
    if (now < startOfDay || now >= endOfDay) {
        showScreen('offlineScreen');
        // Sıradaki yayını göster (Bugün henüz başlamadıysa bugün, bittiyse yarın)
        let nextStart = new Date(startOfDay);
        if (now >= endOfDay) {
            nextStart.setDate(nextStart.getDate() + 1); // Yarın
        }
        document.getElementById('nextShowTime').innerText = formatTime(nextStart);
        
        // Yayın dışındayken animasyon afişini gizle
        const upNextBanner = document.getElementById('upNextBanner');
        if (upNextBanner) upNextBanner.classList.remove('show');
        return;
    }

    // 3. ŞU AN BİR VİDEO VAR MI?
    const currentVideo = scheduleData.find(v => now >= v.startTime && now < v.endTime);

    if (currentVideo) {
        // Video değiştiyse oynatıcıyı tetikle
        if (currentVideoId !== currentVideo.id) {
            currentVideoId = currentVideo.id;
            const offsetSeconds = Math.floor((now - currentVideo.startTime) / 1000);
            playVideo(currentVideo, offsetSeconds);
            updateInfoUI(currentVideo);
            highlightSchedule(currentVideo.id);
        }
        
        // --- Sonraki Program Animasyonu Kontrolü ---
        const remainingSeconds = Math.floor((currentVideo.endTime - now) / 1000);
        const nextVideo = scheduleData.find(v => v.startTime >= currentVideo.endTime && v.id !== currentVideo.id);
        const upNextBanner = document.getElementById('upNextBanner');
        
        // Eğer videonun bitmesine 15 saniye veya daha az kaldıysa afişi göster
        if (remainingSeconds <= 15 && remainingSeconds > 0 && nextVideo) {
            document.getElementById('upNextTitle').innerText = nextVideo.title;
            if (upNextBanner) upNextBanner.classList.add('show');
        } else {
            // Süre 15 saniyeden fazlaysa veya sıradaki video yoksa afişi gizle
            if (upNextBanner) upNextBanner.classList.remove('show');
        }

    } 
    else {
        // 4. VİDEO BİTTİ AMA YAYIN SAATİ İÇİNDEYİZ (Boşluk var veya liste bitti)
        const nextVideo = scheduleData.find(v => v.startTime > now);
        
        if (nextVideo) {
            // Liste içinde sıradaki videonun saatini yaz
            document.getElementById('nextShowTime').innerText = formatTime(nextVideo.startTime);
        } else {
            // Liste tamamen bittiyse bir sonraki günün açılış saatini yaz
            let tomorrowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, START_HOUR, START_MINUTE, 0);
            document.getElementById('nextShowTime').innerText = "Yarın " + formatTime(tomorrowStart);
        }
        
        // Boşluk ekranındayken animasyon afişini gizle
        const upNextBanner = document.getElementById('upNextBanner');
        if (upNextBanner) upNextBanner.classList.remove('show');
        
        showScreen('fallbackScreen');
    }
}

function playVideo(video, offsetSeconds) {
    showScreen('videoWrapper');
    const wrapper = document.getElementById('videoWrapper');
    wrapper.innerHTML = ''; 

    // 1. YOUTUBE FORMATI
    if (video.type === 'youtube') {
        const iframe = document.createElement('iframe');
        const currentOrigin = window.location.origin;
        
        iframe.src = `https://www.youtube.com/embed/${video.url}?autoplay=1&start=${offsetSeconds}&controls=1&rel=0&enablejsapi=1&origin=${currentOrigin}`;
        iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen";
        iframe.style.width = "100%"; 
        iframe.style.height = "100%";
        iframe.frameBorder = "0";
        wrapper.appendChild(iframe);
    } 

    // 2. DOĞRUDAN VİDEO (MP4 / MOV)
    else if (video.type === 'mp4') {
        const vidElem = document.createElement('video');
        vidElem.src = `${video.url}#t=${offsetSeconds}`;
        vidElem.autoplay = true;
        vidElem.controls = true;
        vidElem.style.width = "100%"; 
        vidElem.style.height = "100%";
        vidElem.onerror = () => triggerFallback();
        wrapper.appendChild(vidElem);
    }

    // 3. M3U8 (HLS) FORMATI
    else if (video.type === 'm3u8') {
        const vidElem = document.createElement('video');
        vidElem.style.width = "100%"; 
        vidElem.style.height = "100%";
        vidElem.autoplay = true;
        vidElem.controls = true;
        wrapper.appendChild(vidElem);

        if (typeof Hls !== 'undefined' && Hls.isSupported()) {
            const hls = new Hls();
            hls.loadSource(video.url);
            hls.attachMedia(vidElem);
            hls.on(Hls.Events.MANIFEST_PARSED, function() {
                vidElem.currentTime = offsetSeconds;
                vidElem.play().catch(() => console.log("Etkileşim bekleniyor..."));
            });
        } 
        else if (vidElem.canPlayType('application/vnd.apple.mpegurl')) {
            vidElem.src = video.url;
            vidElem.addEventListener('loadedmetadata', () => {
                vidElem.currentTime = offsetSeconds;
                vidElem.play();
            });
        }
    }

    // 4. GENEL IFRAME (Google Drive, vb.)
    else if (video.type === 'iframe') {
        const iframe = document.createElement('iframe');
        iframe.src = video.url;
        iframe.allow = "autoplay; fullscreen";
        iframe.style.width = "100%"; 
        iframe.style.height = "100%";
        iframe.frameBorder = "0";
        wrapper.appendChild(iframe);
    }
}

function triggerFallback() {
    const now = new Date();
    const nextVideo = scheduleData.find(v => v.startTime > now);
    if (nextVideo) {
        document.getElementById('nextShowTime').innerText = formatTime(nextVideo.startTime);
    } else {
        let tomorrowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, START_HOUR, START_MINUTE, 0);
        document.getElementById('nextShowTime').innerText = "Yarın " + formatTime(tomorrowStart);
    }
    showScreen('fallbackScreen');
}

function showScreen(screenId) {
    // Önce tüm ekranları gizle
    document.getElementById('videoWrapper').classList.add('hidden');
    document.getElementById('fallbackScreen').classList.add('hidden');
    document.getElementById('offlineScreen').classList.add('hidden');
    
    // Sadece istenen ekranı göster
    document.getElementById(screenId).classList.remove('hidden');

    // KRİTİK NOKTA: Eğer video ekranında değilsek (yani yayın bittiyse veya boşluktaysa)
    // arka planda gizlice çalışmaya devam eden videoyu tamamen temizle.
    if (screenId !== 'videoWrapper') {
        document.getElementById('videoWrapper').innerHTML = '';
        currentVideoId = null; // Hafızayı sıfırla ki bir sonraki video sorunsuz başlasın
    }
}

function updateInfoUI(video) {
    document.getElementById('currentTitle').innerText = video.title;
    document.getElementById('currentDesc').innerText = video.description;
}

function renderScheduleUI() {
    const list = document.getElementById('scheduleList');
    list.innerHTML = '';
    scheduleData.forEach(video => {
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

function formatTime(date) { 
    return date.toLocaleTimeString('tr-TR', { hour: '2-digit', minute:'2-digit' }); 
}

function setupFullscreen() {
    const btn = document.getElementById('fullscreenBtn');
    const playerSection = document.getElementById('playerContainer');
    btn.addEventListener('click', () => {
        if (!document.fullscreenElement) {
            playerSection.requestFullscreen().catch(err => console.log(err));
        } else {
            document.exitFullscreen();
        }
    });
}
