/* =========================================================
   EL TURCO — script.js
   Sin librerías externas. Todo el DOM dinámico se arma con
   textContent / createElement para evitar XSS (no se usa
   innerHTML con datos que puedan venir de un usuario).
   ========================================================= */
'use strict';

/* ---------------------------------------------------------
   CONFIGURACIÓN DE EMAILJS (envío de emails sin backend propio)
   ---------------------------------------------------------
   Se usa únicamente en el formulario de contacto. Completá los
   valores con los datos de tu cuenta en
   https://dashboard.emailjs.com
   --------------------------------------------------------- */
const EMAILJS_PUBLIC_KEY = 'iEk9UF15MzakJwDQ2';
const EMAILJS_SERVICE_ID = 'service_56p4zwe';
const EMAILJS_CONTACT_TEMPLATE_ID = 'template_firq6xs';

const isEmailjsConfigured = () =>
  typeof window.emailjs !== 'undefined' &&
  !EMAILJS_PUBLIC_KEY.startsWith('TU_') &&
  !EMAILJS_SERVICE_ID.startsWith('TU_');

if (typeof window.emailjs !== 'undefined' && !EMAILJS_PUBLIC_KEY.startsWith('TU_')) {
  window.emailjs.init(EMAILJS_PUBLIC_KEY);
}

// Envía un email por EmailJS. Nunca frena el flujo del formulario si
// falla: sólo se registra el error en consola y se avisa en consola.
async function sendEmailNotification(templateId, params) {
  if (!isEmailjsConfigured() || templateId.startsWith('TU_')) {
    console.warn('EmailJS no está configurado todavía: no se envió ningún email.');
    return;
  }
  try {
    await window.emailjs.send(EMAILJS_SERVICE_ID, templateId, params);
  } catch (error) {
    console.error('No se pudo enviar el email de notificación:', error);
  }
}

/* ---------- Utilidades ---------- */
const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));

/* ---------------------------------------------------------
   1. NAVEGACIÓN (menú móvil + resaltado de enlace activo)
   --------------------------------------------------------- */
(function initNav() {
  const toggle = $('#navToggle');
  const nav = $('#primaryNav');
  const header = $('#header');

  if (toggle && nav) {
    toggle.addEventListener('click', () => {
      const isOpen = nav.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', String(isOpen));
    });

    // Cierra el menú móvil al elegir un enlace
    $$('.nav-link, .nav-cta', nav).forEach((link) => {
      link.addEventListener('click', () => {
        nav.classList.remove('is-open');
        toggle.setAttribute('aria-expanded', 'false');
      });
    });
  }

  // Sombra/blur más marcado al hacer scroll (detalle visual sutil)
  window.addEventListener('scroll', () => {
    header.style.boxShadow = window.scrollY > 8
      ? '0 8px 24px -16px rgba(0,0,0,0.6)'
      : 'none';
  }, { passive: true });

  // Resalta el enlace de la sección visible (accesible, sin librerías)
  const sections = $$('main section[id]');
  const navLinks = $$('.nav-link');
  if ('IntersectionObserver' in window && sections.length) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const id = entry.target.getAttribute('id');
        navLinks.forEach((link) => {
          link.classList.toggle('active', link.getAttribute('href') === `#${id}`);
        });
      });
    }, { rootMargin: '-45% 0px -45% 0px' });
    sections.forEach((section) => observer.observe(section));
  }
})();

/* ---------------------------------------------------------
   2. AGENDA DE TURNOS (tablero estilo estadio)
   --------------------------------------------------------- */
const Agenda = (function initAgenda() {
  const dayTabsEl = $('#dayTabs');
  const slotGridEl = $('#slotGrid');
  const summaryEl = $('#bookingSummary');
  const form = $('#bookingForm');
  const statusEl = $('#bookingStatus');

  if (!dayTabsEl || !slotGridEl || !form) return null;

  /* ---------------------------------------------------------
     CONEXIÓN CON FIREBASE (Firestore, base de datos real vía SDK)
     ---------------------------------------------------------
     1. Andá a https://console.firebase.google.com y creá un proyecto
        gratis (plan "Spark").
     2. Dentro del proyecto: "Compilación" > "Firestore Database" >
        "Crear base de datos" (modo producción, la región no importa
        demasiado para este caso, ej. "nam5" o "southamerica-east1").
     3. Aplicá las reglas de seguridad que te dejamos en el chat
        (archivo firestore.rules) desde la pestaña "Reglas".
     4. Andá a "Configuración del proyecto" (ícono de tuerca) >
        en "Tus apps" agregá una app Web (ícono </>) y copiá el
        objeto firebaseConfig que te muestra.
     5. Pegalo acá abajo, reemplazando los valores de ejemplo.
     --------------------------------------------------------- */
  const firebaseConfig = {
    apiKey: 'AIzaSyANhsUB1pQA1xJ7Hgswm0SCPGCXYej3NAI',
    authDomain: 'elturco-92488.firebaseapp.com',
    projectId: 'elturco-92488',
    storageBucket: 'elturco-92488.firebasestorage.app',
    messagingSenderId: '909805366642',
    appId: '1:909805366642:web:7ee9d528fde389fea581eb',
  };

  const isFirebaseConfigured = () =>
    typeof window.firebase !== 'undefined' &&
    !firebaseConfig.apiKey.startsWith('TU_') &&
    !firebaseConfig.projectId.startsWith('TU-PROYECTO');

  let db = null;
  if (isFirebaseConfigured()) {
    window.firebase.initializeApp(firebaseConfig);
    db = window.firebase.firestore();
  }

  // Horarios de juego disponibles (24h). Editable por el negocio.
  const HOURS = [16, 17, 18, 19, 20, 21, 22, 23];
  const DAYS_AHEAD = 7;

  const dayFormatterShort = new Intl.DateTimeFormat('es-AR', { weekday: 'short' });
  const dateFormatterLong = new Intl.DateTimeFormat('es-AR', {
    weekday: 'long', day: 'numeric', month: 'long',
  });

  // Estado en memoria, se llena con datos reales traídos de Firestore
  // (ver loadReservedSlots). No se inventa disponibilidad.
  let selectedDateKey = null;
  let selectedHour = null;
  const reservedByDate = new Map(); // dateKey -> Set(horas) marcadas como ocupadas

  function dateKey(date) {
    // Clave estable YYYY-MM-DD en horario local
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function isTaken(dKey, hour) {
    return reservedByDate.get(dKey)?.has(hour) ?? false;
  }

  function markReserved(dKey, hour) {
    if (!reservedByDate.has(dKey)) reservedByDate.set(dKey, new Set());
    reservedByDate.get(dKey).add(hour);
  }

  // Trae de Firestore todos los horarios ya ocupados dentro del rango de
  // días que se muestra en el tablero (hoy .. hoy + DAYS_AHEAD).
  // Sólo lee la colección "takenSlots" (día + hora), nunca nombres ni
  // teléfonos de otros clientes: esos quedan sólo en "reservations",
  // que las reglas de seguridad bloquean para lectura pública.
  async function loadReservedSlots() {
    reservedByDate.clear();
    if (!isFirebaseConfigured()) {
      console.warn(
        'Firebase no está configurado todavía: completá firebaseConfig ' +
        'en script.js para que la disponibilidad sea real.'
      );
      return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const last = new Date(today);
    last.setDate(today.getDate() + DAYS_AHEAD - 1);

    const snapshot = await db.collection('takenSlots')
      .where('dateKey', '>=', dateKey(today))
      .where('dateKey', '<=', dateKey(last))
      .get();

    snapshot.forEach((doc) => {
      const data = doc.data();
      markReserved(data.dateKey, data.hour);
    });
  }

  // Guarda la reserva en Firestore usando una transacción: primero
  // revisa si el horario ya tiene un documento en "takenSlots" y, si
  // no existe, crea a la vez el registro de disponibilidad y la
  // reserva completa. Si otra persona reservó ese mismo horario un
  // instante antes, la transacción falla y avisamos en vez de duplicar.
  async function persistReservation({ dateKeyValue, hour, name, phone, players }) {
    if (!isFirebaseConfigured()) {
      // Sin backend configurado: seguimos funcionando en modo demo local
      // para no romper la página, pero avisamos por consola.
      console.warn('Reserva NO guardada en un backend real: falta configurar Firebase.');
      return { ok: true, conflict: false };
    }

    const slotId = `${dateKeyValue}_${hour}`;
    const takenRef = db.collection('takenSlots').doc(slotId);
    const reservationRef = db.collection('reservations').doc();

    try {
      await db.runTransaction(async (tx) => {
        const takenDoc = await tx.get(takenRef);
        if (takenDoc.exists) {
          throw new Error('CONFLICT');
        }
        tx.set(takenRef, { dateKey: dateKeyValue, hour });
        tx.set(reservationRef, {
          dateKey: dateKeyValue,
          hour,
          name,
          phone,
          players: Number(players),
          createdAt: window.firebase.firestore.FieldValue.serverTimestamp(),
        });
      });
    } catch (error) {
      if (error.message === 'CONFLICT') {
        return { ok: false, conflict: true };
      }
      throw error;
    }

    return { ok: true, conflict: false };
  }

  function buildDayList() {
    const days = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let i = 0; i < DAYS_AHEAD; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      days.push(d);
    }
    return days;
  }

  function renderDayTabs() {
    const days = buildDayList();
    dayTabsEl.textContent = ''; // limpia de forma segura

    days.forEach((date, index) => {
      const key = dateKey(date);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'day-tab';
      btn.setAttribute('role', 'tab');
      btn.setAttribute('data-date', key);
      btn.setAttribute('aria-selected', index === 0 ? 'true' : 'false');

      const nameSpan = document.createElement('span');
      nameSpan.className = 'day-name';
      nameSpan.textContent = index === 0 ? 'Hoy' : dayFormatterShort.format(date);

      const numSpan = document.createElement('span');
      numSpan.className = 'day-num';
      numSpan.textContent = String(date.getDate()).padStart(2, '0');

      btn.append(nameSpan, numSpan);
      btn.addEventListener('click', () => selectDay(key));
      dayTabsEl.appendChild(btn);

      if (index === 0) selectedDateKey = key;
    });
  }

  function selectDay(key) {
    selectedDateKey = key;
    selectedHour = null;
    $$('.day-tab', dayTabsEl).forEach((tab) => {
      tab.setAttribute('aria-selected', String(tab.getAttribute('data-date') === key));
    });
    renderSlots();
    renderSummary();
  }

  function renderSlots() {
    slotGridEl.textContent = '';
    HOURS.forEach((hour) => {
      const taken = isTaken(selectedDateKey, hour);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'slot-tile';
      btn.setAttribute('aria-pressed', String(selectedHour === hour));
      if (taken) btn.setAttribute('disabled', 'true');

      const time = document.createElement('span');
      time.className = 'slot-time';
      time.textContent = `${String(hour).padStart(2, '0')}:00`;

      const dot = document.createElement('span');
      dot.className = 'slot-dot';
      dot.setAttribute('aria-hidden', 'true');

      btn.append(time, dot);
      btn.setAttribute(
        'aria-label',
        `${String(hour).padStart(2, '0')}:00, ${taken ? 'reservado' : 'disponible'}`
      );

      if (!taken) {
        btn.addEventListener('click', () => {
          selectedHour = hour;
          renderSlots();
          renderSummary();
        });
      }

      slotGridEl.appendChild(btn);
    });
  }

  function renderSummary() {
    summaryEl.textContent = '';

    if (!selectedDateKey || selectedHour === null) {
      const p = document.createElement('p');
      p.className = 'booking-summary-empty';
      p.textContent = 'Todavía no elegiste un horario.';
      summaryEl.appendChild(p);
      return;
    }

    const [y, m, d] = selectedDateKey.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    const readableDate = dateFormatterLong.format(date);

    const dl = document.createElement('dl');

    const dtDate = document.createElement('dt');
    dtDate.textContent = 'Fecha';
    const ddDate = document.createElement('dd');
    ddDate.textContent = readableDate;

    const dtHour = document.createElement('dt');
    dtHour.textContent = 'Horario';
    const ddHour = document.createElement('dd');
    ddHour.textContent = `${String(selectedHour).padStart(2, '0')}:00 hs`;

    dl.append(dtDate, ddDate, dtHour, ddHour);
    summaryEl.appendChild(dl);
  }

  /* ----- Validación del formulario de reserva ----- */
  function setFieldError(inputId, errorId, message) {
    const input = $(`#${inputId}`);
    const error = $(`#${errorId}`);
    if (message) {
      input.setAttribute('aria-invalid', 'true');
      error.textContent = message; // textContent: nunca HTML
    } else {
      input.removeAttribute('aria-invalid');
      error.textContent = '';
    }
    return !message;
  }

  function validateName(value) {
    const trimmed = value.trim();
    const nameRegex = /^[A-Za-zÀ-ÿ\s'-]{2,60}$/;
    if (trimmed.length < 2 || trimmed.length > 60 || !nameRegex.test(trimmed)) {
      return 'Ingresá un nombre válido (2 a 60 letras).';
    }
    return '';
  }

  function validatePhone(value) {
    const trimmed = value.trim();
    // Acepta dígitos, espacios, guiones, paréntesis y un + inicial opcional. 8 a 20 caracteres.
    const phoneRegex = /^\+?[0-9\s()-]{8,20}$/;
    if (!phoneRegex.test(trimmed)) {
      return 'Ingresá un teléfono válido (8 a 20 dígitos).';
    }
    return '';
  }

  function validatePlayers(value) {
    if (!value) return 'Elegí la cantidad de jugadores.';
    return '';
  }

  async function handleSubmit(event) {
    event.preventDefault();
    statusEl.textContent = '';
    statusEl.removeAttribute('data-state');

    const nameInput = $('#bkName');
    const phoneInput = $('#bkPhone');
    const playersInput = $('#bkPlayers');

    const nameError = validateName(nameInput.value);
    const phoneError = validatePhone(phoneInput.value);
    const playersError = validatePlayers(playersInput.value);

    const nameOk = setFieldError('bkName', 'bkNameError', nameError);
    const phoneOk = setFieldError('bkPhone', 'bkPhoneError', phoneError);
    const playersOk = setFieldError('bkPlayers', 'bkPlayersError', playersError);

    if (!selectedDateKey || selectedHour === null) {
      statusEl.textContent = 'Elegí un día y un horario en el tablero antes de confirmar.';
      statusEl.setAttribute('data-state', 'error');
      return;
    }

    if (!nameOk || !phoneOk || !playersOk) {
      statusEl.textContent = 'Revisá los datos marcados en rojo.';
      statusEl.setAttribute('data-state', 'error');
      return;
    }

    // Datos ya validados; se usan sólo para armar un mensaje de texto plano
    // (nunca se insertan como HTML) y para guardar el turno en la base de datos.
    const cleanName = nameInput.value.trim();
    const cleanPhone = phoneInput.value.trim();
    const players = playersInput.value;
    const bookedDateKey = selectedDateKey;
    const bookedHour = selectedHour;

    const [y, m, d] = bookedDateKey.split('-').map(Number);
    const readableDate = dateFormatterLong.format(new Date(y, m - 1, d));
    const timeLabel = `${String(bookedHour).padStart(2, '0')}:00`;

    // Deshabilita el botón mientras se guarda para evitar doble envío
    const submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;
    statusEl.textContent = 'Guardando tu turno...';
    statusEl.removeAttribute('data-state');

    let result;
    try {
      result = await persistReservation({
        dateKeyValue: bookedDateKey,
        hour: bookedHour,
        name: cleanName,
        phone: cleanPhone,
        players,
      });
    } catch (error) {
      console.error(error);
      statusEl.textContent = 'No pudimos guardar tu turno (falló la conexión). Probá de nuevo en un momento.';
      statusEl.setAttribute('data-state', 'error');
      if (submitBtn) submitBtn.disabled = false;
      return;
    }

    if (submitBtn) submitBtn.disabled = false;

    if (result.conflict) {
      // Alguien reservó ese mismo horario un instante antes: refrescamos
      // el tablero para mostrar la disponibilidad real y no duplicar turnos.
      markReserved(bookedDateKey, bookedHour);
      selectedHour = null;
      renderSlots();
      renderSummary();
      statusEl.textContent = 'Justo se ocupó ese horario. Elegí otro, por favor.';
      statusEl.setAttribute('data-state', 'error');
      return;
    }

    markReserved(bookedDateKey, bookedHour);

    // Número de WhatsApp del negocio (reemplazar por el real antes de publicar).
    const BUSINESS_WHATSAPP = '+59898277505'; // TODO: número real de El Turco

    const message =
      `Hola! Quiero reservar la cancha.\n` +
      `Nombre: ${cleanName}\n` +
      `Teléfono: ${cleanPhone}\n` +
      `Jugadores: ${players}\n` +
      `Día: ${readableDate}\n` +
      `Horario: ${timeLabel} hs`;

    const waUrl = `https://wa.me/${BUSINESS_WHATSAPP}?text=${encodeURIComponent(message)}`;

    statusEl.textContent = `¡Listo! Turno del ${readableDate} a las ${timeLabel} hs reservado. Te llevamos a WhatsApp para confirmar con nosotros.`;
    statusEl.removeAttribute('data-state');

    selectedHour = null;
    renderSlots();
    renderSummary();
    form.reset();

    // Abre WhatsApp en una pestaña nueva y segura
    window.open(waUrl, '_blank', 'noopener,noreferrer');
  }

  async function init() {
    renderDayTabs();

    // Estado de carga mientras se consulta la disponibilidad real
    slotGridEl.textContent = '';
    const loadingP = document.createElement('p');
    loadingP.className = 'booking-summary-empty';
    loadingP.textContent = 'Cargando disponibilidad...';
    slotGridEl.appendChild(loadingP);

    try {
      await loadReservedSlots();
    } catch (error) {
      console.error(error);
      statusEl.textContent = 'No pudimos cargar la disponibilidad. Recargá la página.';
      statusEl.setAttribute('data-state', 'error');
    }

    renderSlots();
    renderSummary();
    form.addEventListener('submit', handleSubmit);
  }

  init();
  return { init };
})();

/* ---------------------------------------------------------
   3. FORMULARIO DE CONTACTO
   --------------------------------------------------------- */
(function initContactForm() {
  const form = $('#contactForm');
  if (!form) return;
  const statusEl = $('#contactStatus');

  function setFieldError(inputId, errorId, message) {
    const input = $(`#${inputId}`);
    const error = $(`#${errorId}`);
    if (message) {
      input.setAttribute('aria-invalid', 'true');
      error.textContent = message;
    } else {
      input.removeAttribute('aria-invalid');
      error.textContent = '';
    }
    return !message;
  }

  function validateName(value) {
    const trimmed = value.trim();
    const nameRegex = /^[A-Za-zÀ-ÿ\s'-]{2,60}$/;
    if (trimmed.length < 2 || trimmed.length > 60 || !nameRegex.test(trimmed)) {
      return 'Ingresá un nombre válido (2 a 60 letras).';
    }
    return '';
  }

  function validateEmail(value) {
    const trimmed = value.trim();
    // Validación simple y suficiente para formularios de contacto (no exhaustiva RFC).
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    if (trimmed.length > 100 || !emailRegex.test(trimmed)) {
      return 'Ingresá un correo electrónico válido.';
    }
    return '';
  }

  function validateMessage(value) {
    const trimmed = value.trim();
    if (trimmed.length < 10 || trimmed.length > 500) {
      return 'El mensaje debe tener entre 10 y 500 caracteres.';
    }
    return '';
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    statusEl.textContent = '';
    statusEl.removeAttribute('data-state');

    const nameInput = $('#cName');
    const emailInput = $('#cEmail');
    const messageInput = $('#cMessage');

    const nameOk = setFieldError('cName', 'cNameError', validateName(nameInput.value));
    const emailOk = setFieldError('cEmail', 'cEmailError', validateEmail(emailInput.value));
    const messageOk = setFieldError('cMessage', 'cMessageError', validateMessage(messageInput.value));

    if (!nameOk || !emailOk || !messageOk) {
      statusEl.textContent = 'Revisá los datos marcados en rojo.';
      statusEl.setAttribute('data-state', 'error');
      return;
    }

    const nameValue = nameInput.value.trim();
    const emailValue = emailInput.value.trim();
    const messageValue = messageInput.value.trim();

    const submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;
    statusEl.textContent = 'Enviando tu mensaje...';

    await sendEmailNotification(EMAILJS_CONTACT_TEMPLATE_ID, {
      client_name: nameValue,
      client_email: emailValue,
      message: messageValue,
    });

    if (submitBtn) submitBtn.disabled = false;
    statusEl.textContent = `¡Gracias, ${nameValue}! Recibimos tu mensaje y te vamos a responder a la brevedad.`;
    statusEl.removeAttribute('data-state');
    form.reset();
  });
})();

/* ---------------------------------------------------------
   4. AÑO DEL PIE DE PÁGINA
   --------------------------------------------------------- */
(function setFooterYear() {
  const yearEl = $('#year');
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());
})();