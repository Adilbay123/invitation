(function () {
    'use strict';

    // ============================================================
    //  ПАРАМЕТРЫ И СОСТОЯНИЕ
    //  Ссылка: https://сайт/?uid=abc123xyz0
    //  Имена, пол и места приходят с сервера. Без uid страница работает как демо.
    // ============================================================
    const UID = (new URLSearchParams(location.search).get('uid') || '').trim();

    const DEMO_PLACES = [
        { id: 'cafe',   emoji: '☕', name: 'Кафе', desc: 'Уютное место' },
        { id: 'park',   emoji: '🌳', name: 'Парк', desc: 'Свежий воздух' },
        { id: 'cinema', emoji: '🎬', name: 'Кино', desc: 'Новый фильм' },
    ];

    const MAX_NOTES = 3;

    const state = {
        demo: !UID,
        ready: false,
        fromName: 'Тайный поклонник',
        toName: '',
        gender: 'f',
        places: DEMO_PLACES,
        placeId: DEMO_PLACES[0].id,
        date: '',
        time: '18:30',
        sent: false,
        sending: false,
        notes: 0,
        noteSending: false,
    };

    const $ = (id) => document.getElementById(id);
    const screens = {
        splash: $('screen-splash'), envelope: $('screen-envelope'), letter: $('screen-letter'),
        datetime: $('screen-datetime'), places: $('screen-places'), final: $('screen-final'),
        error: $('screen-error'),
    };

    const musicBtn = $('musicBtn'), splashEnvelope = $('splashEnvelope'), envelope3d = $('envelope3d');
    const letterGreeting = $('letterGreeting'), btnYes = $('btnYes'), btnNo = $('btnNo'), noMsg = $('noMessage');
    const datePicker = $('datePicker'), timePicker = $('timePicker'), selectedDateEl = $('selectedDateDisplay');
    const nextToPlaces = $('nextToPlaces'), placesContainer = $('placesContainer'), finalizeBtn = $('finalizeBtn');
    const finalDate = $('finalDate'), finalTime = $('finalTime'), finalPlace = $('finalPlace');
    const countdownEl = $('countdown'), sendStatus = $('sendStatus'), retryBtn = $('retryBtn');
    const noteInput = $('noteInput'), noteBtn = $('noteBtn'), noteToName = $('noteToName');
    const shareBtn = $('shareBtn'), resetBtn = $('resetBtn');
    const toastBox = $('toastBox'), confettiBox = $('confettiBox');

    // Фраза по полу получателя: she('уверена', 'уверен')
    const by = (f, m) => (state.gender === 'm' ? m : f);

    // ============================================================
    //  СЕТЬ
    // ============================================================
    async function api(path, payload) {
        const opts = payload
            ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
            : {};
        const res = await fetch(path, opts);
        const data = await res.json().catch(() => ({}));
        return { res, data };
    }

    // ============================================================
    //  ЭКРАНЫ
    // ============================================================
    function showScreen(id) {
        const next = screens[id];
        if (!next) return;
        const current = document.querySelector('.screen.active');
        if (current && current !== next) {
            current.classList.add('leaving');
            setTimeout(() => current.classList.remove('active', 'leaving'), 300);
        }
        next.classList.add('active');
    }

    function showError(title, text) {
        $('errTitle').textContent = title;
        $('errText').textContent = text;
        showScreen('error');
    }

    // ============================================================
    //  ДАТЫ (всё по локальному времени устройства)
    // ============================================================
    function isoLocal(d) {
        const p = (n) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    }

    function formatDate(dateStr) {
        return new Date(dateStr + 'T12:00:00').toLocaleDateString('ru-RU', {
            day: 'numeric', month: 'long', year: 'numeric',
        });
    }

    const formatTime = (t) => t.slice(0, 5);
    const placeLabel = (p) => `${p.emoji ? p.emoji + ' ' : ''}${p.name}`;

    function selectedPlace() {
        return state.places.find((p) => p.id === state.placeId) || state.places[0];
    }

    function updateDateTime() {
        state.date = datePicker.value;
        state.time = timePicker.value;
        selectedDateEl.textContent = state.date ? formatDate(state.date) : '—';
    }

    const today = new Date();
    const maxDate = new Date();
    maxDate.setFullYear(maxDate.getFullYear() + 1);
    datePicker.min = isoLocal(today);
    datePicker.max = isoLocal(maxDate);
    datePicker.value = isoLocal(today);

    // ============================================================
    //  ПЕРСОНАЛИЗАЦИЯ
    // ============================================================
    function applyPersonalization() {
        letterGreeting.textContent = state.toName ? `😊 Привет, ${state.toName}` : '😊 Привет';
        noteToName.textContent = state.fromName;
        document.title = state.toName ? `${state.toName}, тебе сообщение 💌` : 'Особое приглашение 💌';
    }

    // ============================================================
    //  МУЗЫКА (Web Audio)
    // ============================================================
    let audioCtx = null, isMusicPlaying = false, musicTimer = null, resumeAfterHidden = false;

    const melody = [
        { f: 523.25, d: 0.6 }, { f: 659.25, d: 0.6 }, { f: 783.99, d: 0.8 }, { f: 659.25, d: 0.6 },
        { f: 587.33, d: 0.6 }, { f: 698.46, d: 0.6 }, { f: 880.0, d: 0.8 }, { f: 698.46, d: 0.6 },
    ];
    let melodyIndex = 0;

    function playNote(freq, dur, vol) {
        if (!audioCtx) return;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0, audioCtx.currentTime);
        gain.gain.linearRampToValueAtTime(vol, audioCtx.currentTime + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + dur);
    }

    function scheduleMelody() {
        if (!isMusicPlaying || !audioCtx) return;
        const note = melody[melodyIndex++ % melody.length];
        playNote(note.f, note.d, 0.04);
        musicTimer = setTimeout(scheduleMelody, note.d * 1000 + 120);
    }

    function startMusic() {
        if (!audioCtx) {
            try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
            catch (e) { return; }
        }
        if (audioCtx.state === 'suspended') audioCtx.resume();
        if (isMusicPlaying) return;
        isMusicPlaying = true;
        musicBtn.classList.add('on');
        musicBtn.textContent = '🔊';
        musicBtn.setAttribute('aria-label', 'Выключить музыку');
        scheduleMelody();
    }

    function stopMusic() {
        isMusicPlaying = false;
        musicBtn.classList.remove('on');
        musicBtn.textContent = '🔇';
        musicBtn.setAttribute('aria-label', 'Включить музыку');
        clearTimeout(musicTimer);
        musicTimer = null;
    }

    musicBtn.addEventListener('click', () => {
        vibrate(8);
        isMusicPlaying ? stopMusic() : startMusic();
    });

    // Музыка не играет в фоновой вкладке
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            resumeAfterHidden = isMusicPlaying;
            if (isMusicPlaying) stopMusic();
        } else if (resumeAfterHidden) {
            resumeAfterHidden = false;
            startMusic();
        }
    });

    // ============================================================
    //  ВИБРАЦИЯ И TOAST
    // ============================================================
    function vibrate(ms) {
        try { if ('vibrate' in navigator) navigator.vibrate(ms); } catch (e) { /* не поддерживается */ }
    }

    function toast(message, type = '', duration = 3200) {
        const el = document.createElement('div');
        el.className = 'toast' + (type ? ' ' + type : '');
        el.textContent = message;
        toastBox.appendChild(el);
        setTimeout(() => {
            el.classList.add('out');
            setTimeout(() => el.remove(), 400);
        }, duration);
    }

    // ============================================================
    //  ЗАСТАВКА → КОНВЕРТ → ПИСЬМО
    // ============================================================
    splashEnvelope.addEventListener('click', () => {
        if (!state.ready) return;
        vibrate(10);
        startMusic();
        showScreen('envelope');
    });

    function openEnvelope() {
        vibrate(10);
        envelope3d.style.transform = 'scale(0.94) rotateY(8deg)';
        setTimeout(() => {
            envelope3d.style.transform = '';
            showScreen('letter');
        }, 280);
    }
    envelope3d.addEventListener('click', openEnvelope);
    envelope3d.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openEnvelope(); }
    });

    // ============================================================
    //  КНОПКА «НЕТ» УБЕГАЕТ (после 6 нажатий «ломается» — выбор остаётся за человеком)
    // ============================================================
    let noClicks = 0;
    const noMessages = () => [
        by('Ты уверена? 😅', 'Ты уверен? 😅'),
        'Подумай ещё 🤭',
        'А может да? ☺️',
        'Не убегай! 😄',
        'Я настаиваю ✨',
    ];

    btnNo.addEventListener('click', (e) => {
        e.preventDefault();
        vibrate(12);
        if (!state.demo) api('/api/invite', { uid: UID, event: 'no' }).catch(() => {});

        const area = btnNo.parentElement;
        btnNo.style.left = Math.max(0, Math.random() * (area.offsetWidth - btnNo.offsetWidth)) + 'px';
        btnNo.style.top = Math.max(0, Math.random() * (area.offsetHeight - btnNo.offsetHeight)) + 'px';
        btnNo.style.transform = `scale(${Math.max(0.55, 1 - noClicks * 0.08)})`;

        const list = noMessages();
        noMsg.textContent = list[noClicks % list.length];
        noClicks++;

        if (noClicks >= 6) {
            noMsg.textContent = 'Кажется, кнопка «Нет» сломалась 😉';
            btnNo.style.visibility = 'hidden';
            btnNo.disabled = true;
        }
    });

    btnYes.addEventListener('click', () => {
        vibrate(15);
        noMsg.textContent = '';
        updateDateTime();
        showScreen('datetime');
    });

    // ============================================================
    //  ДАТА, ВРЕМЯ, МЕСТА
    // ============================================================
    datePicker.addEventListener('change', updateDateTime);
    timePicker.addEventListener('change', updateDateTime);

    nextToPlaces.addEventListener('click', () => {
        vibrate(10);
        updateDateTime();
        if (!state.date || !state.time) return toast('Выбери дату и время', 'error');
        if (new Date(`${state.date}T${state.time}:00`) <= new Date()) {
            return toast('Выбери время в будущем', 'error');
        }
        renderPlaces();
        showScreen('places');
    });

    function renderPlaces() {
        placesContainer.textContent = '';
        state.places.forEach((p) => {
            const selected = p.id === state.placeId;
            const card = document.createElement('div');
            card.className = 'place-card' + (selected ? ' selected' : '');
            card.tabIndex = 0;
            card.setAttribute('role', 'button');
            card.setAttribute('aria-pressed', String(selected));

            const photo = document.createElement('div');
            photo.className = 'photo-place';
            photo.textContent = p.emoji || '📍';

            const info = document.createElement('div');
            info.className = 'place-info';
            const name = document.createElement('div');
            name.className = 'place-name';
            name.textContent = p.name;
            const desc = document.createElement('div');
            desc.className = 'place-desc';
            desc.textContent = [p.desc, p.address].filter(Boolean).join(' • ');
            info.append(name, desc);

            card.append(photo, info);
            if (selected) {
                const check = document.createElement('div');
                check.className = 'place-check';
                check.textContent = '✓';
                card.append(check);
            }

            const choose = () => {
                vibrate(8);
                state.placeId = p.id;
                renderPlaces();
            };
            card.addEventListener('click', choose);
            card.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(); }
            });
            placesContainer.appendChild(card);
        });
    }

    // ============================================================
    //  ФИНАЛ И ОТПРАВКА ОТВЕТА
    // ============================================================
    function fillFinal() {
        const place = selectedPlace();
        finalDate.textContent = formatDate(state.date);
        finalTime.textContent = formatTime(state.time);
        finalPlace.textContent = place ? placeLabel(place) : '—';
        noteToName.textContent = state.fromName;
    }

    function setStatus(text, kind = '') {
        sendStatus.textContent = text;
        sendStatus.className = 'send-status' + (kind ? ' ' + kind : '');
    }

    function updateNoteUi() {
        const left = MAX_NOTES - state.notes;
        noteBtn.disabled = !state.sent || state.noteSending || left <= 0;
        noteInput.disabled = left <= 0;
        if (left <= 0) noteBtn.textContent = 'Записки отправлены ✓';
        else noteBtn.textContent = state.sent ? 'Отправить записку' : 'Записку можно отправить после ответа';
    }

    async function submitAnswer() {
        if (state.sent || state.sending) return;

        if (state.demo) {
            setStatus('Демо-режим: ответ никому не отправляется', 'warn');
            return;
        }

        state.sending = true;
        retryBtn.hidden = true;
        setStatus('Отправляю ответ…');

        try {
            const { res, data } = await api('/api/send', {
                uid: UID, type: 'answer',
                date: state.date, time: state.time, placeId: state.placeId,
            });

            if (res.ok && data.ok) {
                state.sent = true;
                setStatus(`✅ ${state.fromName} получит уведомление`, 'ok');
            } else if (res.status === 409) {
                state.sent = true;
                setStatus('Ответ уже был отправлен ✅', 'ok');
            } else if (res.status >= 400 && res.status < 500 && res.status !== 429) {
                setStatus(data.error || 'Не удалось отправить', 'error'); // повтор не поможет
            } else {
                throw new Error(data.error || res.status);
            }
        } catch (err) {
            console.error(err);
            setStatus('Не получилось отправить. Проверь интернет и повтори.', 'error');
            retryBtn.hidden = false;
        } finally {
            state.sending = false;
            updateNoteUi();
        }
    }

    finalizeBtn.addEventListener('click', () => {
        if (state.sent || state.sending) return;
        vibrate(15);
        fillFinal();
        showScreen('final');
        launchConfetti();
        startCountdown();
        submitAnswer();
    });

    retryBtn.addEventListener('click', () => { vibrate(8); submitAnswer(); });

    // ============================================================
    //  ЗАПИСКА (по кнопке, до MAX_NOTES штук)
    // ============================================================
    noteInput.addEventListener('input', () => {
        noteBtn.disabled = !state.sent || state.noteSending || !noteInput.value.trim() || state.notes >= MAX_NOTES;
    });

    noteBtn.addEventListener('click', async () => {
        const text = noteInput.value.trim();
        if (!text || !state.sent || state.noteSending) return;

        if (state.demo) return toast('Демо-режим: записка не отправляется', 'error');

        state.noteSending = true;
        noteBtn.disabled = true;
        try {
            const { res, data } = await api('/api/send', { uid: UID, type: 'note', note: text });
            if (res.ok && data.ok) {
                state.notes = data.notes || state.notes + 1;
                noteInput.value = '';
                toast(`💬 Записка отправлена: ${state.fromName}`, 'success');
            } else {
                toast('⚠️ ' + (data.error || 'Не удалось отправить записку'), 'error', 5000);
            }
        } catch (err) {
            console.error(err);
            toast('⚠️ Ошибка сети. Попробуй ещё раз.', 'error', 5000);
        } finally {
            state.noteSending = false;
            updateNoteUi();
            noteBtn.disabled = true; // пока не напишет новый текст
        }
    });

    // ============================================================
    //  ОБРАТНЫЙ ОТСЧЁТ
    // ============================================================
    let countdownTimer = null;

    function startCountdown() {
        clearInterval(countdownTimer);
        const tick = () => {
            const diff = new Date(`${state.date}T${state.time}:00`) - new Date();
            if (diff <= 0) {
                countdownEl.textContent = '✨ Встреча уже началась!';
                return;
            }
            const days = Math.floor(diff / 86400000);
            const hours = Math.floor((diff % 86400000) / 3600000);
            const mins = Math.floor((diff % 3600000) / 60000);
            const secs = Math.floor((diff % 60000) / 1000);

            const parts = [];
            if (days > 0) parts.push(`${days} д`);
            if (hours > 0 || days > 0) parts.push(`${hours} ч`);
            parts.push(`${mins} мин`);
            if (days === 0) parts.push(`${secs} с`);
            countdownEl.textContent = `⏳ До встречи: ${parts.join(' ')}`;
        };
        tick();
        countdownTimer = setInterval(tick, 1000);
    }

    // ============================================================
    //  КОНФЕТТИ
    // ============================================================
    function launchConfetti() {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        confettiBox.textContent = '';
        const colors = ['#ffffff', '#a9b8ff', '#d9c2ff', '#8b94b8'];
        for (let i = 0; i < 40; i++) {
            const piece = document.createElement('div');
            piece.className = 'confetti-piece';
            piece.style.left = Math.random() * 100 + '%';
            piece.style.width = 4 + Math.random() * 5 + 'px';
            piece.style.height = 8 + Math.random() * 10 + 'px';
            piece.style.background = colors[Math.floor(Math.random() * colors.length)];
            piece.style.animationDuration = 3 + Math.random() * 2.5 + 's';
            piece.style.animationDelay = Math.random() + 's';
            piece.style.opacity = 0.6 + Math.random() * 0.4;
            confettiBox.appendChild(piece);
        }
        setTimeout(() => { confettiBox.textContent = ''; }, 6500);
    }

    // ============================================================
    //  ПОДЕЛИТЬСЯ (только план встречи, без ссылки на приглашение)
    // ============================================================
    shareBtn.addEventListener('click', async () => {
        vibrate(8);
        const place = selectedPlace();
        const text = `💌 Мы идём гулять!\n📅 ${formatDate(state.date)}\n🕒 ${formatTime(state.time)}\n📍 ${place ? placeLabel(place) : ''}`;

        if (navigator.share) {
            try {
                await navigator.share({ title: 'Особое приглашение', text });
                return;
            } catch (e) {
                if (e.name === 'AbortError') return;
            }
        }
        try {
            await navigator.clipboard.writeText(text);
            toast('📋 Скопировано в буфер', 'success');
        } catch (e) {
            toast('⚠️ Не удалось поделиться', 'error');
        }
    });

    // ============================================================
    //  СБРОС (только в демо-режиме: у настоящего приглашения ответ один)
    // ============================================================
    resetBtn.addEventListener('click', () => {
        vibrate(8);
        state.placeId = state.places[0].id;
        state.sent = false;
        state.notes = 0;
        noteInput.value = '';
        confettiBox.textContent = '';
        countdownEl.textContent = '';
        clearInterval(countdownTimer);
        datePicker.value = isoLocal(new Date());
        timePicker.value = '18:30';
        btnNo.style.visibility = '';
        btnNo.disabled = false;
        btnNo.style.cssText = '';
        noClicks = 0;
        updateDateTime();
        updateNoteUi();
        showScreen('splash');
    });

    // ============================================================
    //  ЗАГРУЗКА ПРИГЛАШЕНИЯ
    // ============================================================
    async function init() {
        updateDateTime();
        updateNoteUi();

        if (state.demo) {
            resetBtn.hidden = false;
            state.ready = true;
            applyPersonalization();
            toast('Демо-режим: открой ссылку из бота, чтобы ответ ушёл', '', 4500);
            return;
        }

        try {
            const { res, data } = await api(`/api/invite?uid=${encodeURIComponent(UID)}`);

            if (res.status === 404) {
                return showError('Ссылка не найдена', 'Возможно, она устарела. Попроси отправителя создать новую.');
            }
            if (!res.ok || !data.ok) throw new Error(data.error || res.status);

            state.fromName = data.fromName || state.fromName;
            state.toName = data.toName || '';
            state.gender = data.gender === 'm' ? 'm' : 'f';
            state.places = data.places && data.places.length ? data.places : DEMO_PLACES;
            state.placeId = state.places[0].id;
            state.notes = data.notes || 0;
            applyPersonalization();

            // Ответ уже отправлен — показываем итог сразу
            if (data.answer) {
                const a = data.answer;
                state.date = a.date;
                state.time = a.time;
                state.placeId = a.placeId;
                state.places = [{ id: a.placeId, emoji: a.placeEmoji, name: a.placeName }];
                state.sent = true;
                fillFinal();
                setStatus('Ответ уже отправлен ✅', 'ok');
                updateNoteUi();
                startCountdown();
                showScreen('final');
                return;
            }

            state.ready = true;
            api('/api/invite', { uid: UID, event: 'open' }).catch(() => {});
        } catch (err) {
            console.error(err);
            showError('Не получилось загрузить', 'Проверь интернет и обнови страницу.');
        }
    }

    init();
})();
