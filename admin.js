'use strict';
/* =========================================================
   EL TURCO — admin.js
   Panel de administración: requiere login (Firebase Authentication)
   para ver y cancelar reservas. Mismo criterio que script.js: sin
   innerHTML con datos dinámicos, todo con textContent/createElement.
   ========================================================= */

const $ = (selector, scope = document) => scope.querySelector(selector);

const dateFormatterLong = new Intl.DateTimeFormat('es-AR', {
  weekday: 'long', day: 'numeric', month: 'long',
});

function todayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function readableDateFromKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return dateFormatterLong.format(new Date(y, m - 1, d));
}

(function initAdmin() {
  const loginSection = $('#loginSection');
  const dashboardSection = $('#dashboardSection');
  const loginForm = $('#loginForm');
  const loginStatus = $('#loginStatus');
  const logoutBtn = $('#logoutBtn');
  const refreshBtn = $('#refreshBtn');
  const showPastToggle = $('#showPastToggle');
  const dashboardStatus = $('#dashboardStatus');
  const reservationsBody = $('#reservationsBody');
  const emptyState = $('#emptyState');

  if (!isFirebaseConfigured()) {
    loginStatus.textContent =
      'Firebase no está configurado (falta firebase-config.js). No se puede iniciar sesión.';
    loginStatus.setAttribute('data-state', 'error');
    return;
  }

  const auth = window.firebase.auth();
  const db = window.firebase.firestore();

  let allReservations = []; // cache en memoria de la última consulta

  /* ----- Login / logout ----- */
  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    loginStatus.textContent = '';
    loginStatus.removeAttribute('data-state');

    const email = $('#adminEmail').value.trim();
    const password = $('#adminPassword').value;

    const submitBtn = loginForm.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    loginStatus.textContent = 'Ingresando...';

    try {
      await auth.signInWithEmailAndPassword(email, password);
      loginForm.reset();
    } catch (error) {
      console.error(error);
      loginStatus.textContent = 'Email o contraseña incorrectos.';
      loginStatus.setAttribute('data-state', 'error');
    } finally {
      submitBtn.disabled = false;
    }
  });

  logoutBtn.addEventListener('click', () => auth.signOut());

  auth.onAuthStateChanged((user) => {
    if (user) {
      loginSection.hidden = true;
      dashboardSection.hidden = false;
      logoutBtn.hidden = false;
      loadReservations();
    } else {
      loginSection.hidden = false;
      dashboardSection.hidden = true;
      logoutBtn.hidden = true;
    }
  });

  /* ----- Cargar reservas ----- */
  async function loadReservations() {
    dashboardStatus.textContent = 'Cargando reservas...';
    dashboardStatus.removeAttribute('data-state');
    reservationsBody.textContent = '';

    try {
      const snapshot = await db.collection('reservations').get();
      allReservations = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      allReservations.sort((a, b) => {
        if (a.dateKey !== b.dateKey) return a.dateKey < b.dateKey ? -1 : 1;
        return a.hour - b.hour;
      });
      dashboardStatus.textContent = '';
      renderTable();
    } catch (error) {
      console.error(error);
      dashboardStatus.textContent =
        'No se pudieron cargar las reservas. Revisá tu conexión o las reglas de Firestore.';
      dashboardStatus.setAttribute('data-state', 'error');
    }
  }

  /* ----- Dibujar la tabla ----- */
  function renderTable() {
    reservationsBody.textContent = '';
    const today = todayKey();
    const showPast = showPastToggle.checked;

    const visible = allReservations.filter((r) => showPast || r.dateKey >= today);

    emptyState.hidden = visible.length > 0;

    visible.forEach((reservation) => {
      const tr = document.createElement('tr');

      const tdDate = document.createElement('td');
      tdDate.textContent = readableDateFromKey(reservation.dateKey);

      const tdHour = document.createElement('td');
      tdHour.textContent = `${String(reservation.hour).padStart(2, '0')}:00`;

      const tdName = document.createElement('td');
      tdName.textContent = reservation.name || '—';

      const tdPhone = document.createElement('td');
      tdPhone.textContent = reservation.phone || '—';

      const tdPlayers = document.createElement('td');
      tdPlayers.textContent = reservation.players ?? '—';

      const tdAction = document.createElement('td');
      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'btn btn-danger btn-sm';
      cancelBtn.textContent = 'Cancelar';
      cancelBtn.addEventListener('click', () => handleCancel(reservation, cancelBtn));
      tdAction.appendChild(cancelBtn);

      tr.append(tdDate, tdHour, tdName, tdPhone, tdPlayers, tdAction);
      reservationsBody.appendChild(tr);
    });
  }

  showPastToggle.addEventListener('change', renderTable);
  refreshBtn.addEventListener('click', loadReservations);

  /* ----- Cancelar una reserva ----- */
  async function handleCancel(reservation, button) {
    const readableDate = readableDateFromKey(reservation.dateKey);
    const timeLabel = `${String(reservation.hour).padStart(2, '0')}:00`;
    const confirmed = window.confirm(
      `¿Cancelar el turno de ${reservation.name} el ${readableDate} a las ${timeLabel} hs?\n` +
      `Esta acción no se puede deshacer.`
    );
    if (!confirmed) return;

    button.disabled = true;
    button.textContent = 'Cancelando...';

    const slotId = `${reservation.dateKey}_${reservation.hour}`;
    try {
      const batch = db.batch();
      batch.delete(db.collection('reservations').doc(reservation.id));
      batch.delete(db.collection('takenSlots').doc(slotId));
      await batch.commit();

      allReservations = allReservations.filter((r) => r.id !== reservation.id);
      renderTable();
      dashboardStatus.textContent = `Turno de ${reservation.name} cancelado. El horario quedó libre de nuevo.`;
      dashboardStatus.removeAttribute('data-state');
    } catch (error) {
      console.error(error);
      button.disabled = false;
      button.textContent = 'Cancelar';
      dashboardStatus.textContent = 'No se pudo cancelar el turno. Probá de nuevo.';
      dashboardStatus.setAttribute('data-state', 'error');
    }
  }
})();
