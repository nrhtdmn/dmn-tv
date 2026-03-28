const player = document.getElementById('tv-player');
const errorScreen = document.getElementById('error-screen');
const liveBadge = document.getElementById('live-badge');
const goLiveBtn = document.getElementById('go-live-btn');
const currentTitle = document.getElementById('current-title');
const currentDesc = document.getElementById('current-description');
const scheduleList = document.getElementById('schedule-list');

// --- JSON DOSYASINI İPTAL ETTİK, VERİYİ DİREKT BURAYA GÖMDÜK ---
const data = {
  "gunlukBaslangic": "00:01", // Gece yarısı başlar
  "gunlukBitis": "23:59",     // Gece yarısına kadar devam
  "videolar": [
    {
      "id": 1,
      "baslik": "Kesintisiz Test Yayını",
      "aciklama": "Bu video tam 24 saat sürecek, sistemin çalıştığını kanıtlıyoruz!",
      "tur": "mp4",
      "url": "https://www.w3schools.com/html/mov_bbb.mp4",
      "sureSaniye": 86400 // Tam 24 saatlik süre (hiç bitmeyecek)
    }
  ]
};

let scheduleData = [];
let dailyStartTimeStr = data.gunlukBaslangic;
let dailyEndTimeStr = data.gunlukBitis;
let currentActiveVideoIndex = -1;

// 1. Sistemi Başlat
function loadSchedule() {
    buildScheduleTimeline(data.videolar);
    renderScheduleUI();
    
    setInterval(checkLiveStatus, 5000);
    checkLiveStatus();
}

// 2. Videoların başlangıç ve bitiş saatlerini hesapla
function buildScheduleTimeline(videos) {
    const today = new Date();
    const [startHour, startMin] = dailyStartTimeStr.split(':');
    
    let currentTimelineTime = new Date(today.getFullYear(), today.getMonth(), today.getDate(), startHour, startMin, 0);

    scheduleData = videos.map(video => {
        const startTime = new Date(currentTimelineTime);
        currentTimelineTime.setSeconds(currentTimelineTime.getSeconds() + video.sureSaniye);
        const endTime = new Date(currentTimelineTime);

        return {
            ...video,
            startTime,
            endTime,
            startFormatted: formatTime(startTime),
            endFormatted: formatTime(endTime)
        };
    });
}

// 3. Canlı Yayını Kontrol Et
function checkLiveStatus() {
    const now = new Date();
    
    // Şu an hangi video oynamalı?
    const activeVideoIndex = scheduleData.findIndex(v => now >= v.startTime && now < v.endTime);

    if (activeVideoIndex === -1) {
        showError("Şu an için planlı bir yayın bulunamadı.");
        return;
    }

    // Eğer video değiştiyse, yeni videoyu yükle
    if (activeVideoIndex !== currentActiveVideoIndex) {
        currentActiveVideoIndex = activeVideoIndex;
        playVideo(scheduleData[activeVideoIndex]);
        updateUI(activeVideoIndex);
    }

    checkSync();
}

// 4. Videoyu Oynat
function playVideo(videoData) {
    hideError();
    player.src = videoData.url;
    syncToLiveTime();
    
    // Otomatik oynatma politikası (Kullanıcı etkileşimi gerekebilir)
    let playPromise = player.play();
    if (playPromise !== undefined) {
        playPromise.catch(error => {
            console.log("Tarayıcı otomatik sesi engelledi. Videoya tıklamak gerekebilir.");
        });
    }
}

// 5. Oynatma zamanını Canlı ile eşitle
function syncToLiveTime() {
    if (currentActiveVideoIndex === -1) return;
    
    const now = new Date();
    const activeVideo = scheduleData[currentActiveVideoIndex];
    const diffSeconds = (now - activeVideo.startTime) / 1000;
    
    player.currentTime = diffSeconds;
    player.play();
    goLiveBtn.style.display = 'none';
    liveBadge.style.opacity = '1';
}

// 6. Senkronizasyon Kontrolü
function checkSync() {
    if (currentActiveVideoIndex === -1 || player.paused) {
        goLiveBtn.style.display = 'block';
        liveBadge.style.opacity = '0.5';
        return;
    }

    const now = new Date();
    const activeVideo = scheduleData[currentActiveVideoIndex];
    const expectedTime = (now - activeVideo.startTime) / 1000;

    if (Math.abs(player.currentTime - expectedTime) > 5) {
        goLiveBtn.style.display = 'block';
        liveBadge.style.opacity = '0.5';
    } else {
        goLiveBtn.style.display = 'none';
        liveBadge.style.opacity = '1';
    }
}

// Event Listeners
player.addEventListener('pause', () => {
    goLiveBtn.style.display = 'block';
    liveBadge.style.opacity = '0.5';
});

goLiveBtn.addEventListener('click', syncToLiveTime);

// Arayüz Fonksiyonları
function showError(msg) {
    player.pause();
    player.removeAttribute('src');
    errorScreen.style.display = 'flex';
    liveBadge.style.display = 'none';
    currentTitle.innerText = "Yayın Arası";
    currentDesc.innerText = msg;
}

function hideError() {
    errorScreen.style.display = 'none';
    liveBadge.style.display = 'block';
}

function updateUI(activeIndex) {
    const video = scheduleData[activeIndex];
    currentTitle.innerText = video.baslik;
    currentDesc.innerText = video.aciklama;

    document.querySelectorAll('.schedule-list li').forEach((li, index) => {
        if (index === activeIndex) {
            li.classList.add('active');
        } else {
            li.classList.remove('active');
        }
    });
}

function renderScheduleUI() {
    scheduleList.innerHTML = '';
    scheduleData.forEach((video, index) => {
        const li = document.createElement('li');
        li.innerHTML = `
            <span class="time-slot">${video.startFormatted} - ${video.endFormatted}</span>
            <span class="video-title">${video.baslik}</span>
        `;
        scheduleList.appendChild(li);
    });
}

function formatTime(date) {
    return date.getHours().toString().padStart(2, '0') + ':' + 
           date.getMinutes().toString().padStart(2, '0');
}

// Ateşle!
loadSchedule();
