const htmlPlayer = document.getElementById('tv-player');
const ytPlayerContainer = document.getElementById('yt-player');
const iframePlayer = document.getElementById('iframe-player'); // YENİ
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

// --- YOUTUBE API KURULUMU ---
let ytPlayer;
let isYtReady = false;

const tag = document.createElement('script');
tag.src = "https://www.youtube.com/iframe_api";
const firstScriptTag = document.getElementsByTagName('script')[0];
firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);

window.onYouTubeIframeAPIReady = function() {
    ytPlayer = new YT.Player('yt-player', {
        height: '100%',
        width: '100%',
        videoId: '',
        playerVars: { 'autoplay': 1, 'controls': 1, 'rel': 0 },
        events: {
            'onReady': () => { isYtReady = true; },
            'onStateChange': onYtStateChange
        }
    });
}

function onYtStateChange(event) {
    if (event.data === YT.PlayerState.PAUSED) {
        goLiveBtn.style.display = 'block';
        liveBadge.style.opacity = '0.5';
    }
}

// --- SİSTEMİ BAŞLAT VE JSON ÇEK ---
async function loadSchedule() {
    try {
        const response = await fetch('yayin-akisi.json?v=' + new Date().getTime());
        const data = await response.json();
        
        dailyStartTimeStr = data.gunlukBaslangic;
        dailyEndTimeStr = data.gunlukBitis;
        
        buildScheduleTimeline(data.videolar);
        renderScheduleUI();
        
        setInterval(checkLiveStatus, 5000);
        checkLiveStatus();
    } catch (error) {
        showError("Yayın akışı yüklenemedi. JSON dosyasını kontrol edin.");
    }
}

function buildScheduleTimeline(videos) {
    const today = new Date();
    const [startHour, startMin] = dailyStartTimeStr.split(':');
    let currentTimelineTime = new Date(today.getFullYear(), today.getMonth(), today.getDate(), startHour, startMin, 0);

    scheduleData = videos.map(video => {
        const startTime = new Date(currentTimelineTime);
        currentTimelineTime.setSeconds(currentTimelineTime.getSeconds() + video.sureSaniye);
        const endTime = new Date(currentTimelineTime);

        return { ...video, startTime, endTime, startFormatted: formatTime(startTime), endFormatted: formatTime(endTime) };
    });
}

function checkLiveStatus() {
    const now = new Date();
    const activeVideoIndex = scheduleData.findIndex(v => now >= v.startTime && now < v.endTime);

    if (activeVideoIndex === -1) {
        showError("Şu an için planlı bir yayın bulunamadı.");
        return;
    }

    if (activeVideoIndex !== currentActiveVideoIndex) {
        currentActiveVideoIndex = activeVideoIndex;
        playVideo(scheduleData[activeVideoIndex]);
        updateUI(activeVideoIndex);
    }
    checkSync();
}

function playVideo(videoData) {
    hideError();
    
    // YENİ: Hangi tür video oynuyorsa diğerlerini sustur ve gizle
    if (videoData.tur === 'youtube') {
        htmlPlayer.style.display = 'none';
        htmlPlayer.pause();
        iframePlayer.style.display = 'none';
        iframePlayer.src = ''; // Arka planda ses çalmasını engelle
        ytPlayerContainer.style.display = 'block';
        
        if (isYtReady) {
            ytPlayer.loadVideoById(videoData.url);
            syncToLiveTime();
        }
    } else if (videoData.tur === 'iframe') {
        htmlPlayer.style.display = 'none';
        htmlPlayer.pause();
        ytPlayerContainer.style.display = 'none';
        if (isYtReady) ytPlayer.pauseVideo();
        
        iframePlayer.style.display = 'block';
        iframePlayer.src = videoData.url;
        
        goLiveBtn.style.display = 'none';
        liveBadge.style.opacity = '1';
    } else { // mp4
        ytPlayerContainer.style.display = 'none';
        if (isYtReady) ytPlayer.pauseVideo();
        iframePlayer.style.display = 'none';
        iframePlayer.src = ''; 
        htmlPlayer.style.display = 'block';
        
        htmlPlayer.src = videoData.url;
        syncToLiveTime();
    }
}

function syncToLiveTime() {
    if (currentActiveVideoIndex === -1) return;
    
    const activeVideo = scheduleData[currentActiveVideoIndex];
    // İframe'e dışarıdan müdahale edemeyiz, o yüzden senkronize etmeye çalışmıyoruz
    if (activeVideo.tur === 'iframe') return; 

    const diffSeconds = (new Date() - activeVideo.startTime) / 1000;
    
    if (activeVideo.tur === 'youtube') {
        if (isYtReady) {
            ytPlayer.seekTo(diffSeconds, true);
            ytPlayer.playVideo();
        }
    } else {
        htmlPlayer.currentTime = diffSeconds;
        htmlPlayer.play();
    }
    
    goLiveBtn.style.display = 'none';
    liveBadge.style.opacity = '1';
}

function checkSync() {
    if (currentActiveVideoIndex === -1) return;
    const activeVideo = scheduleData[currentActiveVideoIndex];
    
    // İframe senkronizasyon dışı bırakıldı
    if (activeVideo.tur === 'iframe') {
        goLiveBtn.style.display = 'none';
        liveBadge.style.opacity = '1';
        return;
    }
    
    const expectedTime = (new Date() - activeVideo.startTime) / 1000;
    let currentTime = 0;
    let isPaused = false;

    if (activeVideo.tur === 'youtube') {
        if (!isYtReady) return;
        currentTime = ytPlayer.getCurrentTime();
        isPaused = (ytPlayer.getPlayerState() === YT.PlayerState.PAUSED);
    } else {
        currentTime = htmlPlayer.currentTime;
        isPaused = htmlPlayer.paused;
    }

    if (isPaused || Math.abs(currentTime - expectedTime) > 5) {
        goLiveBtn.style.display = 'block';
        liveBadge.style.opacity = '0.5';
    } else {
        goLiveBtn.style.display = 'none';
        liveBadge.style.opacity = '1';
    }
}

htmlPlayer.addEventListener('pause', () => {
    goLiveBtn.style.display = 'block';
    liveBadge.style.opacity = '0.5';
});

goLiveBtn.addEventListener('click', syncToLiveTime);

function showError(msg) {
    htmlPlayer.pause();
    if(isYtReady) ytPlayer.pauseVideo();
    iframePlayer.src = '';
    
    htmlPlayer.style.display = 'none';
    ytPlayerContainer.style.display = 'none';
    iframePlayer.style.display = 'none';
    
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
        if (index === activeIndex) li.classList.add('active');
        else li.classList.remove('active');
    });
}

function renderScheduleUI() {
    scheduleList.innerHTML = '';
    scheduleData.forEach(video => {
        const li = document.createElement('li');
        li.innerHTML = `<span class="time-slot">${video.startFormatted} - ${video.endFormatted}</span>
                        <span class="video-title">${video.baslik}</span>`;
        scheduleList.appendChild(li);
    });
}

function formatTime(date) {
    return date.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', hour12: false });
}

loadSchedule();
