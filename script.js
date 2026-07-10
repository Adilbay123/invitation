(function() {
    // ---- КОНФИГУРАЦИЯ TELEGRAM ----
    const BOT_TOKEN = '8754614530:AAFSY5KGYURjj4ysR0GKXhKTIGT5CMpebT8';
    const CHAT_ID = '1224531849';

    // ---- ПЕРЕМЕННАЯ ДЛЯ ФОТО ----
    let selectedPhotoDataURL = null;

    // ---- ЗВЁЗДЫ ----
    const starsContainer = document.getElementById('stars');
    for (let i = 0; i < 45; i++) {
        const star = document.createElement('div');
        star.className = 'star';
        const size = 2 + Math.random() * 5;
        star.style.width = size + 'px';
        star.style.height = size + 'px';
        star.style.left = Math.random() * 100 + '%';
        star.style.top = Math.random() * 100 + '%';
        star.style.animationDelay = Math.random() * 6 + 's';
        star.style.animationDuration = 6 + Math.random() * 8 + 's';
        starsContainer.appendChild(star);
    }

    // ---- СОСТОЯНИЯ ----
    let selectedDate = '2026-07-10';
    let selectedTime = '18:30';
    let selectedPlace = 'Кафе ☕';
    let selectedPlaceId = 0;
    
    let placeList = JSON.parse(localStorage.getItem('placesList')) || [
        { name: 'Кафе ☕', desc: 'Уютное место', photo: '☕', photoData: null, id: 0 },
        { name: 'Парк 🌳', desc: 'Свежий воздух', photo: '🌳', photoData: null, id: 1 },
        { name: 'Кино 🎬', desc: 'Новый фильм', photo: '🎬', photoData: null, id: 2 },
    ];
    let nextPlaceId = placeList.length > 0 ? Math.max(...placeList.map(p => p.id)) + 1 : 0;

    // ---- ЭЛЕМЕНТЫ ЭКРАНОВ ----
    const screens = {
        splash: document.getElementById('screen-splash'),
        envelope: document.getElementById('screen-envelope'),
        letter: document.getElementById('screen-letter'),
        datetime: document.getElementById('screen-datetime'),
        places: document.getElementById('screen-places'),
        final: document.getElementById('screen-final'),
    };
    
    function showScreen(id) {
        Object.keys(screens).forEach(k => {
            screens[k].classList.toggle('active', k === id);
        });
    }

    // ---- МУЗЫКА ----
    let audioCtx = null;
    let isMusicPlaying = false;
    
    function initAudio() {
        if (audioCtx) return;
        try {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            playMelody();
        } catch(e) {}
    }
    
    function playMelody() {
        if (!audioCtx) return;
        const notes = [523, 587, 659, 784, 880, 988, 1174];
        let index = 0;
        
        function playNote() {
            if (!audioCtx || audioCtx.state !== 'running') return;
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = 'sine';
            osc.frequency.value = notes[index % notes.length] * 0.7;
            gain.gain.setValueAtTime(0.06, audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.4);
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.start();
            osc.stop(audioCtx.currentTime + 0.4);
            index++;
            if (index < 20) setTimeout(playNote, 280 + Math.random() * 120);
            else setTimeout(() => { if (isMusicPlaying) playMelody(); }, 800);
        }
        playNote();
    }

    // ---- ПЕРЕХОДЫ ----
    document.getElementById('splashEnvelope').addEventListener('click', function(e) {
        if (!audioCtx) { initAudio(); }
        if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
        isMusicPlaying = true;
        showScreen('envelope');
    });

    document.getElementById('envelope3d').addEventListener('click', function() {
        this.style.transform = 'scale(0.95) rotateY(10deg)';
        setTimeout(() => {
            this.style.transform = '';
            showScreen('letter');
        }, 300);
    });

    // ---- КНОПКИ ДА / НЕТ ----
    const btnYes = document.getElementById('btnYes');
    const btnNo = document.getElementById('btnNo');
    const noMsg = document.getElementById('noMessage');
    let noClicks = 0;

    function moveNoButton() {
        const dx = (Math.random() - 0.5) * 120;
        const dy = (Math.random() - 0.5) * 80;
        let left = btnNo.offsetLeft + dx;
        let top = btnNo.offsetTop + dy;
        left = Math.max(0, Math.min(left, 180));
        top = Math.max(0, Math.min(top, 80));
        btnNo.style.position = 'relative';
        btnNo.style.left = left + 'px';
        btnNo.style.top = top + 'px';
        const msgs = ['Ты уверен? 😅', 'Подумай ещё 🤭', 'А может да? ☺️', 'Не убегай! 😄', 'Я настаиваю ✨'];
        noMsg.textContent = msgs[noClicks % msgs.length];
        noClicks++;
    }

    btnNo.addEventListener('click', function(e) {
        e.preventDefault();
        moveNoButton();
        if (noClicks > 6) {
            noMsg.textContent = 'Ладно, уговорил 😉 давай!';
            setTimeout(() => { btnYes.click(); }, 400);
        }
    });

    btnYes.addEventListener('click', function() {
        showScreen('datetime');
        btnNo.style.position = 'static';
        btnNo.style.left = '0';
        btnNo.style.top = '0';
        noMsg.textContent = '';
        noClicks = 0;
        updateDateTimeDisplay();
    });

    // ---- КАЛЕНДАРЬ И ЧАСЫ ----
    const datePicker = document.getElementById('datePicker');
    const timePicker = document.getElementById('timePicker');
    const selectedDateDisplay = document.getElementById('selectedDateDisplay');

    function updateDateTimeDisplay() {
        const dateObj = new Date(datePicker.value + 'T' + timePicker.value);
        const options = { day: 'numeric', month: 'long', year: 'numeric' };
        selectedDateDisplay.textContent = dateObj.toLocaleDateString('ru-RU', options);
        selectedDate = datePicker.value;
        selectedTime = timePicker.value;
    }

    datePicker.addEventListener('change', updateDateTimeDisplay);
    timePicker.addEventListener('change', updateDateTimeDisplay);
    
    const today = new Date().toISOString().split('T')[0];
    datePicker.setAttribute('min', today);
    if (datePicker.value < today) datePicker.value = today;

    // ---- ПЕРЕХОД К МЕСТАМ ----
    document.getElementById('nextToPlaces').addEventListener('click', function() {
        updateDateTimeDisplay();
        showScreen('places');
        renderPlaces();
    });

    // ---- РЕНДЕР МЕСТ ----
    function renderPlaces() {
        const container = document.getElementById('placesContainer');
        container.innerHTML = '';
        placeList.forEach((p) => {
            const card = document.createElement('div');
            card.className = 'place-card' + (p.id === selectedPlaceId ? ' selected' : '');
            card.dataset.placeId = p.id;
            
            let photoHtml = '';
            if (p.photoData) {
                photoHtml = `<img src="${p.photoData}" class="place-photo-img" alt="Фото места">`;
            } else if (p.photo) {
                photoHtml = `<div class="photo-place">${p.photo}</div>`;
            } else {
                photoHtml = `<div class="photo-place">📍</div>`;
            }
            
            card.innerHTML = `
                ${photoHtml}
                <div style="font-weight:600; color:white;">${p.name}</div>
                <div style="color:#b0caff; font-size:14px;">${p.desc || ''}</div>
                ${p.id === selectedPlaceId ? '<div style="color:#4dff91; font-size:14px;">✓ Выбрано</div>' : ''}
            `;
            card.addEventListener('click', function() {
                const id = parseInt(this.dataset.placeId);
                selectPlace(id);
            });
            container.appendChild(card);
        });
    }

    function selectPlace(id) {
        selectedPlaceId = id;
        const found = placeList.find(p => p.id === id);
        if (found) selectedPlace = found.name;
        renderPlaces();
        localStorage.setItem('selectedPlaceId', id);
    }

    const savedPlaceId = localStorage.getItem('selectedPlaceId');
    if (savedPlaceId !== null) {
        const id = parseInt(savedPlaceId);
        if (placeList.some(p => p.id === id)) {
            selectedPlaceId = id;
            const found = placeList.find(p => p.id === id);
            if (found) selectedPlace = found.name;
        }
    }

    // ---- РАБОТА С ФОТО ИЗ ГАЛЕРЕИ ----
    const photoInput = document.getElementById('placePhotoInput');
    const photoPreview = document.getElementById('photoPreview');
    const photoPreviewImg = document.getElementById('photoPreviewImg');
    const removePhotoBtn = document.getElementById('removePhotoBtn');

    photoInput.addEventListener('change', function(e) {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = function(event) {
                selectedPhotoDataURL = event.target.result;
                photoPreviewImg.src = selectedPhotoDataURL;
                photoPreview.style.display = 'block';
            };
            reader.readAsDataURL(file);
        }
    });

    removePhotoBtn.addEventListener('click', function() {
        selectedPhotoDataURL = null;
        photoPreview.style.display = 'none';
        photoPreviewImg.src = '';
        photoInput.value = '';
    });

    // ---- ДОБАВИТЬ МЕСТО ----
    document.getElementById('addPlaceBtn').addEventListener('click', function() {
        document.getElementById('modalPlace').classList.add('open');
        selectedPhotoDataURL = null;
        photoPreview.style.display = 'none';
        photoPreviewImg.src = '';
        photoInput.value = '';
    });
    
    document.getElementById('closeModalBtn').addEventListener('click', function() {
        document.getElementById('modalPlace').classList.remove('open');
    });
    
    document.getElementById('savePlaceBtn').addEventListener('click', function() {
        const name = document.getElementById('placeName').value.trim() || 'Моё место';
        const desc = document.getElementById('placeDesc').value.trim() || 'Там красивый вид вечером';
        
        let photo = '📍';
        let photoData = null;
        
        if (selectedPhotoDataURL) {
            photoData = selectedPhotoDataURL;
            photo = '📷';
        }
        
        const newPlace = { 
            name, 
            desc, 
            photo, 
            photoData, 
            id: nextPlaceId++ 
        };
        
        placeList.push(newPlace);
        localStorage.setItem('placesList', JSON.stringify(placeList));
        document.getElementById('modalPlace').classList.remove('open');
        document.getElementById('placeName').value = '';
        document.getElementById('placeDesc').value = '';
        selectedPhotoDataURL = null;
        photoPreview.style.display = 'none';
        photoPreviewImg.src = '';
        photoInput.value = '';
        renderPlaces();
        selectPlace(newPlace.id);
    });

    // ---- ОТПРАВКА В TELEGRAM ----
    function sendTelegramNotification(message) {
        if (!BOT_TOKEN || BOT_TOKEN === 'YOUR_BOT_TOKEN' || !CHAT_ID || CHAT_ID === 'YOUR_CHAT_ID') {
            console.warn('⚠️ Telegram не настроен. Показываем демо-режим.');
            alert('📩 Telegram уведомление (демо-режим):\n\n' + message + 
                  '\n\nℹ️ Для отправки реального уведомления:\n' +
                  '1. Создайте бота в @BotFather\n' +
                  '2. Получите chat_id через @userinfobot\n' +
                  '3. Замените значения BOT_TOKEN и CHAT_ID в коде');
            return false;
        }

        const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
        
        fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                chat_id: CHAT_ID,
                text: message,
                parse_mode: 'HTML',
                disable_web_page_preview: true
            })
        })
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            if (data.ok) {
                console.log('✅ Уведомление успешно отправлено в Telegram!');
                alert('✅ Уведомление отправлено в Telegram! Проверь сообщения.');
            } else {
                console.error('❌ Ошибка Telegram API:', data);
                alert('❌ Ошибка отправки: ' + (data.description || 'Неизвестная ошибка.'));
            }
        })
        .catch(error => {
            console.error('❌ Ошибка соединения:', error);
            alert('❌ Ошибка соединения с Telegram API. Проверь интернет.\n\n' + error.message);
        });
        
        return true;
    }

    // ---- ФИНАЛ С ОТПРАВКОЙ В TELEGRAM ----
    document.getElementById('finalizeBtn').addEventListener('click', function() {
        const dateObj = new Date(selectedDate + 'T' + selectedTime);
        const dateStr = dateObj.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
        const timeStr = dateObj.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
        const placeObj = placeList.find(p => p.id === selectedPlaceId);
        const placeName = placeObj ? placeObj.name : selectedPlace;
        
        // Показываем фото в финале
        const finalPhotoContainer = document.getElementById('finalPhotoContainer');
        if (placeObj && placeObj.photoData) {
            finalPhotoContainer.innerHTML = `<img src="${placeObj.photoData}" alt="Фото места">`;
        } else {
            finalPhotoContainer.innerHTML = '';
        }

        document.getElementById('finalDate').textContent = dateStr;
        document.getElementById('finalTime').textContent = timeStr;
        document.getElementById('finalPlace').textContent = placeName;
        showScreen('final');
        launchConfetti();

        const message = `🎉 <b>Новая встреча!</b>\n\n` +
                       `📅 Дата: ${dateStr}\n` +
                       `🕒 Время: ${timeStr}\n` +
                       `📍 Место: ${placeName}\n\n` +
                       `✨ <i>До встречи! 😊</i>`;

        sendTelegramNotification(message);
    });

    // ---- КОНФЕТТИ ----
    function launchConfetti() {
        const box = document.getElementById('confettiBox');
        box.innerHTML = '';
        const colors = ['#ff4d6d', '#ffb347', '#4dff91', '#6aaaff', '#ff6bcb', '#f9f871'];
        for (let i = 0; i < 60; i++) {
            const piece = document.createElement('div');
            piece.className = 'confetti-piece';
            piece.style.left = Math.random() * 100 + '%';
            piece.style.background = colors[Math.floor(Math.random() * colors.length)];
            piece.style.width = 6 + Math.random() * 10 + 'px';
            piece.style.height = 10 + Math.random() * 16 + 'px';
            piece.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
            piece.style.animationDuration = 2.5 + Math.random() * 2 + 's';
            piece.style.animationDelay = Math.random() * 1.2 + 's';
            box.appendChild(piece);
        }
        setTimeout(() => { box.innerHTML = ''; }, 5000);
    }

    // ---- СБРОС ----
    document.getElementById('resetBtn').addEventListener('click', function() {
        showScreen('splash');
        document.getElementById('confettiBox').innerHTML = '';
        document.getElementById('finalPhotoContainer').innerHTML = '';
        selectedPlaceId = placeList.length > 0 ? placeList[0].id : 0;
        selectedPlace = placeList.length > 0 ? placeList[0].name : 'Кафе';
        const today = new Date().toISOString().split('T')[0];
        datePicker.value = today;
        timePicker.value = '18:30';
        updateDateTimeDisplay();
        btnNo.style.position = 'static';
        btnNo.style.left = '0';
        btnNo.style.top = '0';
        noMsg.textContent = '';
        noClicks = 0;
        renderPlaces();
    });

    // ---- ИНИЦИАЛИЗАЦИЯ ----
    renderPlaces();
    updateDateTimeDisplay();

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') document.getElementById('modalPlace').classList.remove('open');
    });

    window.addEventListener('beforeunload', function() {
        localStorage.setItem('placesList', JSON.stringify(placeList));
    });

    console.log('✅ Приложение загружено!');
    console.log('📸 Можно добавлять фото из галереи!');
})();