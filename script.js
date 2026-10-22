document.addEventListener('DOMContentLoaded', () => {
  const urlParams = new URLSearchParams(window.location.search);
  const uid = urlParams.get('uid');

  let inviteData = null;
  let noClickCount = 0;
  let selectedPlaceId = null;
  let meetingDateObj = null;

  // Элементы экранов
  const screens = {
    splash: document.getElementById('screenSplash'),
    letter: document.getElementById('screenLetter'),
    datetime: document.getElementById('screenDatetime'),
    places: document.getElementById('screenPlaces'),
    final: document.getElementById('screenFinal'),
    error: document.getElementById('screenError')
  };

  function showScreen(name) {
    Object.values(screens.forEach(s => s?.classList.remove('active')));
    screens[name]?.classList.add('active');
  }

  // Загрузка данных приглашения
  async function init() {
    if (!uid) {
      // Демо режим без uid
      inviteData = {
        fromName: 'Асан',
        toName: 'Дорогой друг',
        gender: 'female',
        answer: null,
        notes: [],
        places: [
          { id: 'p1', name: 'Кафе', emoji: '☕', desc: 'Уютное местечко с десертами', address: 'ул. Ленина, 10' },
          { id: 'p2', name: 'Парк', emoji: '🌳', desc: 'Прогулка на свежем воздухе', address: 'Центральный вход' }
        ]
      };
      setupInviteContent();
      return;
    }

    try {
      const res = await fetch(`/api/invite?uid=${uid}`);
      if (!res.ok) {
        showScreen('error');
        return;
      }
      inviteData = await res.json();
      setupInviteContent();
    } catch (e) {
      console.error('Fetch error:', e);
      showScreen('error');
    }
  }

  function setupInviteContent() {
    document.getElementById('splashSubtitle').textContent = `${inviteData.fromName} приготовил для тебя приглашение!`;
    document.getElementById('letterTitle').textContent = `Привет, ${inviteData.toName}!`;

    // Если ответ уже был отправлен ранее
    if (inviteData.answer) {
      renderFinalScreen(inviteData.answer);
      showScreen('final');
    } else {
      showScreen('splash');
    }
  }

  document.getElementById('btnOpenEnvelope').addEventListener('click', () => {
    showScreen('letter');
    if (uid) {
      fetch(`/api/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid, event: 'open' })
      }).catch(() => {});
    }
  });

  document.getElementById('btnDemoMode').addEventListener('click', () => {
    inviteData = {
      fromName: 'Асан',
      toName: 'Айдана',
      gender: 'female',
      answer: null,
      notes: [],
      places: [
        { id: 'p1', name: 'Кафе', emoji: '☕', desc: 'Уютное местечко с десертами', address: 'ул. Ленина, 10' },
        { id: 'p2', name: 'Парк', emoji: '🌳', desc: 'Прогулка на свежем воздухе', address: 'Центральный вход' }
      ]
    };
    setupInviteContent();
  });

  // Убегающая кнопка «Нет»
  const btnNo = document.getElementById('btnNo');
  btnNo.addEventListener('mouseover', moveNoButton);
  btnNo.addEventListener('click', (e) => {
    e.preventDefault();
    noClickCount++;
    if (uid) {
      fetch(`/api/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid, event: 'no' })
      }).catch(() => {});
    }

    if (noClickCount >= 6) {
      btnNo.style.display = 'none';
    } else {
      moveNoButton();
      btnNo.style.transform = `scale(${1 - noClickCount * 0.12})`;
    }
  });

  function moveNoButton() {
    const x = (Math.random() - 0.5) * 140;
    const y = (Math.random() - 0.5) * 80;
    btnNo.style.transform = `translate(${x}px, ${y}px)`;
  }

  // Кнопка Да
  document.getElementById('btnYes').addEventListener('click', () => {
    // Установка даты по умолчанию (завтра в 18:00 по местному времени)
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    document.getElementById('inputDate').value = tomorrow.toISOString().split('T')[0];
    showScreen('datetime');
  });

  // Переход к выбору места
  document.getElementById('btnNextToPlaces').addEventListener('click', () => {
    const dateVal = document.getElementById('inputDate').value;
    const timeVal = document.getElementById('inputTime').value;

    if (!dateVal || !timeVal) {
      alert('Пожалуйста, выберите дату и время');
      return;
    }

    meetingDateObj = new Date(`${dateVal}T${timeVal}:00`);
    if (meetingDateObj.getTime() < Date.now()) {
      alert('Дата и время не могут быть в прошлом!');
      return;
    }

    renderPlacesList();
    showScreen('places');
  });

  function renderPlacesList() {
    const container = document.getElementById('placesList');
    container.innerHTML = '';

    (inviteData.places || []).forEach(place => {
      const card = document.createElement('div');
      card.className = `place-card ${selectedPlaceId === place.id ? 'selected' : ''}`;
      card.innerHTML = `
        <div class="place-emoji">${place.emoji}</div>
        <div class="place-info">
          <h4>${place.name}</h4>
          <p>${place.desc} • ${place.address}</p>
        </div>
      `;
      card.addEventListener('click', () => {
        document.querySelectorAll('.place-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        selectedPlaceId = place.id;
        document.getElementById('btnSendAnswer').disabled = false;
      });
      container.appendChild(card);
    });
  }

  // Отправка ответа
  document.getElementById('btnSendAnswer').addEventListener('click', async () => {
    if (!selectedPlaceId) return;

    const date = document.getElementById('inputDate').value;
    const time = document.getElementById('inputTime').value;

    if (!uid) {
      alert('Это демо-режим. Ответ не отправлен на сервер.');
      renderFinalScreen({ date, time, placeName: '☕ Кафе', placeAddress: 'ул. Ленина, 10' });
      showScreen('final');
      return;
    }

    try {
      const res = await fetch('/api/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid, type: 'answer', date, time, placeId: selectedPlaceId })
      });

      if (!res.ok) {
        const errData = await res.json();
        alert('Ошибка: ' + (errData.error || 'Не удалось отправить ответ'));
        return;
      }

      const data = await res.json();
      renderFinalScreen(data.answer);
      showScreen('final');
    } catch (e) {
      console.error('Send answer error:', e);
      alert('Ошибка сети. Попробуйте еще раз.');
    }
  });

  function renderFinalScreen(ans) {
    const isFemale = inviteData.gender === 'female';
    document.getElementById('finalTitle').textContent = isFemale ? 'Согласна! 🥰' : 'Согласен! 😎';

    document.getElementById('finalPlanInfo').innerHTML = `
      📅 <b>Дата:</b> ${ans.date} в ${ans.time}<br>
      📍 <b>Место:</b> ${ans.placeName}<br>
      📌 <b>Адрес:</b> ${ans.placeAddress}
    `;

    if (meetingDateObj || ans.date) {
      const targetTime = new Date(`${ans.date}T${ans.time || '18:00'}:00`).getTime();
      startCountdown(targetTime);
    }
  }

  // Обратный отсчет
  function startCountdown(targetTime) {
    setInterval(() => {
      const diff = targetTime - Date.now();
      if (diff <= 0) {
        document.getElementById('countdownBox').innerHTML = '<b>Встреча началась! 🎉</b>';
        return;
      }

      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
      const mins = Math.floor((diff / 1000 / 60) % 60);
      const secs = Math.floor((diff / 1000) % 60);

      document.getElementById('cdDays').textContent = days;
      document.getElementById('cdHours').textContent = hours;
      document.getElementById('cdMins').textContent = mins;
      document.getElementById('cdSecs').textContent = secs;
    }, 1000);
  }

  // Отправка записки
  document.getElementById('btnSendNote').addEventListener('click', async () => {
    const noteText = document.getElementById('inputNote').value.trim();
    if (!noteText) return;

    if (!uid) {
      alert('Записка отправлена (демо)!');
      document.getElementById('inputNote').value = '';
      return;
    }

    try {
      const res = await fetch('/api/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid, type: 'note', note: noteText })
      });
      if (res.ok) {
        alert('Записка успешно отправлена!');
        document.getElementById('inputNote').value = '';
      } else {
        const err = await res.json();
        alert('Ошибка: ' + (err.error || 'Не удалось отправить'));
      }
    } catch (e) {
      alert('Ошибка сети');
    }
  });

  // Кнопка Поделиться
  document.getElementById('btnSharePlan').addEventListener('click', () => {
    const text = 'Ура! Мы договорились погулять! ✨';
    if (navigator.share) {
      navigator.share({ title: 'План встречи', text: text }).catch(() => {});
    } else {
      navigator.clipboard.writeText(text);
      alert('План скопирован в буфер обмена!');
    }
  });

  // Простая музыка Web Audio с паузой при скрытой вкладке
  let audioCtx = null;
  let isPlaying = false;
  let oscillator = null;

  document.getElementById('musicToggle').addEventListener('click', () => {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (isPlaying) {
      stopMusic();
      document.getElementById('musicToggle').textContent = '🔇';
    } else {
      startMusic();
      document.getElementById('musicToggle').textContent = '🎵';
    }
  });

  function startMusic() {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(440, audioCtx.currentTime);
    gainNode.gain.setValueAtTime(0.05, audioCtx.currentTime);
    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    oscillator.start();
    isPlaying = true;
  }

  function stopMusic() {
    if (oscillator) {
      oscillator.stop();
      oscillator.disconnect();
    }
    isPlaying = false;
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && isPlaying) {
      stopMusic();
      document.getElementById('musicToggle').textContent = '🔇';
    }
  });

  init();
});