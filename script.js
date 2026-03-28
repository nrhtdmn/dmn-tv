const player = document.getElementById('tv-player');
const errorScreen = document.getElementById('error-screen');
const liveBadge = document.getElementById('live-badge');
const goLiveBtn = document.getElementById('go-live-btn');
const currentTitle = document.getElementById('current-title');
const currentDesc = document.getElementById('current-description');
const scheduleList = document.getElementById('schedule-list');

let scheduleData = [];
let dailyStartTimeStr = "06:30";
let dailyEndTimeStr = "23:30";
let currentActiveVideoIndex = -1;

// 1. JSON Verisini Çek
async function loadSchedule() {
    try {
        const response = await fetch('yayin-akisi.json?v=' + new Date().getTime());
        const data = await response.json();
        
        dailyStartTimeStr = data.gunlukBaslangic;
        dailyEndTimeStr = data.gunlukBitis;
        
        buildScheduleTimeline(data.videolar);
        renderScheduleUI();
        
        // Her 5 saniyede bir yayın akışını kontrol et
        setInterval(checkLiveStatus, 5000);
        checkLiveStatus(); // İlk kontrol

    } catch (error) {
        console.error("Yayın akışı yüklenemedi:", error);
        showError("Sistem Hatası: Yayın akışı bulunamadı.");
    }
}

// 2. Videoların başlangıç ve bitiş saatlerini hesapla (Uzunluğa göre)
function buildScheduleTimeline(videos) {
    const today = new Date();
    const [startHour, startMin] = dailyStartTimeStr.split(':');
    
    // Yayının başlangıç zamanını (Bugün 06:30) oluştur
    let currentTimelineTime = new Date(today.getFullYear(), today.getMonth(), today.getDate(), startHour, startMin, 0);

    scheduleData = videos.map(video => {
        const startTime = new Date(currentTimelineTime);
        // Süreyi (saniye) başlangıca ekle
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
    const [startHour, startMin] = dailyStartTimeStr.split(':');
    const [endHour, endMin] = dailyEndTimeStr.split(':');
    
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), startHour, startMin, 0);
    const dayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), endHour, endMin, 0);

    // Eğer saat 06:30 ile 23:30 arasında değilsek
    if (now < dayStart || now > dayEnd) {
        showError("Yayınımız henüz başlamadı veya sona erdi.");
        return;
    }

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

    checkSync(); // Kullanıcı geride kaldı mı kontrol et
}

// 4. Videoyu Oynat ve Senkronize Et
function playVideo(videoData) {
    hideError();
    player.src = videoData.url;
    syncToLiveTime(); // O anki gerçek saniyeye zıpla
    player.play().catch(e => console.log("Otomatik oynatma engellendi, kullanıcının tıklaması gerekiyor."));
}

// 5. Oynatma zamanını Canlı ile eşitle
function syncToLiveTime() {
    if (currentActiveVideoIndex === -1) return;
    
    const now = new Date();
    const activeVideo = scheduleData[currentActiveVideoIndex];
    
    // Videonun başlamasından bu yana kaç saniye geçti?
    const diffSeconds = (now - activeVideo.startTime) / 1000;
    
    player.currentTime = diffSeconds;
    player.play();
    goLiveBtn.style.display = 'none'; // Canlıdayız
    liveBadge.style.opacity = '1';
}

// 6. Kullanıcı duraklattıysa veya geri sardıysa kontrol et
function checkSync() {
    if (currentActiveVideoIndex === -1 || player.paused) {
        goLiveBtn.style.display = 'block';
        liveBadge.style.opacity = '0.5';
        return;
    }

    const now = new Date();
    const activeVideo = scheduleData[currentActiveVideoIndex];
    const expectedTime = (now - activeVideo.startTime) / 1000;

    // Eğer kullanıcı canlı yayından 5 saniyeden fazla saptıysa (geri sardıysa)
    if (Math.abs(player.currentTime - expectedTime) > 5) {
        goLiveBtn.style.display = 'block';
        liveBadge.style.opacity = '0.5';
    } else {
        goLiveBtn.style.display = 'none';
        liveBadge.style.opacity = '1';
    }
}

// Event Listeners (Dinleyiciler)
player.addEventListener('pause', () => {
    goLiveBtn.style.display = 'block';
    liveBadge.style.opacity = '0.5';
});

goLiveBtn.addEventListener('click', syncToLiveTime);

// Hata/Oyun Mesajı Gösterme
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

// Arayüzü Güncelleme (Yayın Akışı ve Başlık)
function updateUI(activeIndex) {
    const video = scheduleData[activeIndex];
    currentTitle.innerText = video.baslik;
    currentDesc.innerText = video.aciklama;

    // Menüdeki aktif sınıfını güncelle
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

// Yardımcı Fonksiyon: Saati HH:MM formatına çevir
function formatTime(date) {
    return date.getHours().toString().padStart(2, '0') + ':' + 
           date.getMinutes().toString().padStart(2, '0');
}

// Sistemi Başlat
loadSchedule();