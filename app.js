// App de gastos — lee y escribe la misma planilla que el bot de Telegram,
// a través de la API del script (Api.js en ~/bot-gastos).
//
// En este repo no hay datos ni claves: la URL de la API y la clave de cada
// persona llegan en el # del link que manda el bot, y se guardan solo en el
// teléfono. El # nunca viaja a GitHub.

'use strict';

const LS_CFG = 'gastos.cfg';
const LS_DATOS = 'gastos.datos';
const LS_BORRADOR = 'gastos.borrador';

const $ = (id) => document.getElementById(id);
const estado = {
  cfg: null,
  datos: null,
  vista: 'vMes',
  quien: 'mios',
  tipo: 'Manual',
  catNueva: '',
  enVuelo: new Set()    // ids que se están clasificando: no se vuelven a pintar
};

// --- Guardado local (puede fallar en modo privado: la app sigue igual) ----

function leerLS(clave) {
  try { return JSON.parse(localStorage.getItem(clave)); } catch (e) { return null; }
}
function guardarLS(clave, valor) {
  try { localStorage.setItem(clave, JSON.stringify(valor)); } catch (e) { /* sin espacio o privado */ }
}

/** El link del bot trae #api=...&k=...; si no, lo último guardado. */
function cargarConfig() {
  const desdeLink = configDeLink(location.href);
  if (desdeLink) {
    guardarLS(LS_CFG, desdeLink);
    return desdeLink;
  }
  return leerLS(LS_CFG);
}

function configDeLink(link) {
  const i = String(link).indexOf('#');
  if (i === -1) return null;
  const p = new URLSearchParams(link.substring(i + 1));
  const api = p.get('api');
  const k = p.get('k');
  if (!api || !k || !/^https:\/\/script\.google\.com\//.test(api)) return null;
  return { api, k };
}

// --- API ------------------------------------------------------------------

async function llamar(accion, params = {}) {
  const url = new URL(estado.cfg.api);
  url.searchParams.set('accion', accion);
  url.searchParams.set('k', estado.cfg.k);
  Object.entries(params).forEach(([c, v]) => { if (v !== undefined && v !== '') url.searchParams.set(c, v); });

  const ctrl = new AbortController();
  const corte = setTimeout(() => ctrl.abort(), 45000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, redirect: 'follow' });
    const j = await r.json();
    if (!j.ok && j.error === 'clave') throw new Error('Tu link ya no es válido: pídele uno nuevo al bot.');
    return j;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Google tardó demasiado. Intenta de nuevo.');
    if (e instanceof TypeError) throw new Error('Sin conexión con Google. Revisa tu señal.');
    throw e;
  } finally {
    clearTimeout(corte);
  }
}

async function refrescar() {
  const btn = $('btnRefrescar');
  btn.classList.add('girando');
  try {
    const d = await llamar('resumen');
    if (!d.ok) throw new Error(d.error || 'Error al leer la planilla');
    estado.datos = d;
    guardarLS(LS_DATOS, d);
    pintar();
  } catch (e) {
    aviso(e.message, true);
  } finally {
    btn.classList.remove('girando');
  }
}

// --- Formato --------------------------------------------------------------

const pesos = (n) => '$' + Math.round(n || 0).toLocaleString('es-CL');
function montoDe(m) {
  return m.moneda === 'USD' ? 'US$' + Number(m.monto).toFixed(2) : pesos(m.monto);
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function nombreDe(m) { return m.comercio || m.notas || '(sin detalle)'; }

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
function diaLegible(iso) {
  const hoy = new Date();
  const f = new Date(iso + 'T12:00:00');
  const ayer = new Date(hoy); ayer.setDate(hoy.getDate() - 1);
  const mismo = (a, b) => a.toDateString() === b.toDateString();
  if (mismo(f, hoy)) return 'Hoy';
  if (mismo(f, ayer)) return 'Ayer';
  return DIAS[f.getDay()] + ' ' + f.getDate() + '/' + (f.getMonth() + 1);
}

// --- Pintar ---------------------------------------------------------------

function pintar() {
  const d = estado.datos;
  if (!d) return;
  pintarMes(d);
  pintarClasificar(d);
  pintarAnotarCats(d);
  const mios = pendientesDe(d, 'mios').length;
  $('badge').hidden = !mios;
  $('badge').textContent = mios > 99 ? '99+' : mios;
  pintarTitulo();
}

function pintarTitulo() {
  const d = estado.datos;
  const titulos = { vMes: d ? d.mes : 'Gastos', vClasificar: 'Clasificar', vAnotar: 'Anotar gasto' };
  $('topTitle').textContent = titulos[estado.vista] || 'Gastos';
  $('topSub').textContent = d ? 'Hola ' + d.persona : 'Gastos';
}

function pintarMes(d) {
  $('mTotal').textContent = pesos(d.total);
  $('mIngresos').textContent = d.ingresos ? pesos(d.ingresos) : '—';
  const queda = d.ingresos - d.total;
  $('mQueda').textContent = d.ingresos ? pesos(queda) : '—';
  $('mCantidad').textContent = d.cantidad;

  const tot = (d.tomas + d.marta) || 1;
  $('mSplit').innerHTML =
    `<i style="width:${d.tomas / tot * 100}%;background:var(--tomas)"></i>` +
    `<i style="width:${d.marta / tot * 100}%;background:var(--marta)"></i>`;
  $('mSplitLeyenda').innerHTML =
    `<span><i class="punto" style="background:var(--tomas)"></i>Tomás <b>${pesos(d.tomas)}</b></span>` +
    `<span><i class="punto" style="background:var(--marta)"></i>Marta <b>${pesos(d.marta)}</b></span>`;

  $('mUSD').hidden = !(d.totalUSD > 0);
  if (d.totalUSD > 0) $('mUSD').textContent = 'Además US$' + d.totalUSD.toFixed(2) + ' en dólares (fuera del total).';

  const pend = pendientesDe(d, 'mios');
  $('mAvisoPend').hidden = !pend.length;
  if (pend.length) {
    $('mAvisoPend').innerHTML = `🏷️ <span>Tienes <b>${pend.length}</b> gasto${pend.length > 1 ? 's' : ''} sin categoría. <u>Clasificar</u></span>`;
  }

  // Presupuesto: lo más gastado arriba. La rayita marca cuánto va del mes.
  $('mAvance').textContent = '· va el ' + d.avanceMes + '% del mes';
  const pres = [...d.presupuesto].sort((a, b) => b.gasto / b.tope - a.gasto / a.tope);
  $('mPresupuesto').innerHTML = pres.length ? pres.map((p) => {
    const pct = Math.round(p.gasto / p.tope * 100);
    const color = pct >= 100 ? 'var(--rojo)' : pct >= 80 ? 'var(--amarillo)' : 'var(--menta)';
    return `<div class="pres">
      <div class="pres-top"><b>${esc(p.categoria)}</b><span>${pesos(p.gasto)} de ${pesos(p.tope)} · ${pct}%</span></div>
      <div class="barra"><i style="width:${Math.min(pct, 100)}%;background:${color}"></i><span class="hoy" style="left:${d.avanceMes}%"></span></div>
    </div>`;
  }).join('') : '<div class="muted">Sin topes definidos en la hoja Presupuesto.</div>';

  const conTope = new Set(d.presupuesto.map((p) => norm(p.categoria)));
  const sinTope = d.porCategoria.filter((c) => !conTope.has(norm(c.categoria)));
  $('mSinTopeTit').hidden = $('mSinTope').hidden = !sinTope.length;
  $('mSinTope').innerHTML = sinTope.map((c) =>
    `<div class="fila"><span class="${norm(c.categoria) === 'sin clasificar' ? 'tag-sin' : ''}">${esc(c.categoria)}</span><span class="monto">${pesos(c.monto)}</span></div>`).join('');

  // Últimos gastos agrupados por día.
  let html = '', diaPrevio = '';
  d.recientes.forEach((m) => {
    if (m.fecha !== diaPrevio) { html += `<div class="dia">${diaLegible(m.fecha)}</div>`; diaPrevio = m.fecha; }
    const sin = !m.categoria || norm(m.categoria) === 'sin clasificar';
    html += `<div class="fila">
      <div class="mov-izq"><div class="mov-nombre">${esc(nombreDe(m))}</div>
      <div class="mov-meta"><i class="punto" style="background:var(--${m.persona === 'Marta' ? 'marta' : 'tomas'})"></i>${sin ? '<span class="tag-sin">sin categoría</span>' : esc(m.categoria)}</div></div>
      <div class="monto">${montoDe(m)}</div></div>`;
  });
  $('mRecientes').innerHTML = html || '<div class="muted">Todavía no hay gastos este mes.</div>';
}

function norm(s) {
  return String(s || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function pendientesDe(d, quien) {
  return d.sinCategoria.filter((m) =>
    !estado.enVuelo.has(m.id) && (quien === 'todos' || m.persona === d.persona));
}

function pintarClasificar(d) {
  const lista = pendientesDe(d, estado.quien);
  if (!lista.length) {
    $('cLista').innerHTML = `<div class="vacio"><div class="emoji">✨</div><b>Todo clasificado</b>${
      estado.quien === 'mios' ? 'No te queda ningún gasto sin categoría.' : 'No queda nada pendiente de ninguno.'}</div>`;
    return;
  }
  $('cLista').innerHTML = lista.map((m) => `
    <div class="card gasto" data-id="${esc(m.id)}">
      <div class="gasto-top">
        <div class="gasto-nombre">${esc(nombreDe(m))}</div>
        <div class="gasto-monto">${montoDe(m)}</div>
      </div>
      <div class="gasto-meta">${diaLegible(m.fecha)} ${esc(m.hora)} · ${esc(m.persona)}${m.tipo ? ' · ' + esc(m.tipo) : ''}</div>
      ${m.comercio && m.notas ? `<div class="gasto-nota">📝 ${esc(m.notas)}</div>` : ''}
      <div class="chips">${d.categorias.map((c) => `<button class="chip" data-cat="${esc(c)}">${esc(c)}</button>`).join('')}</div>
    </div>`).join('');
}

function pintarAnotarCats(d) {
  $('aCats').innerHTML = d.categorias.map((c) =>
    `<button class="chip${c === estado.catNueva ? ' on' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`).join('');
}

// --- Acciones -------------------------------------------------------------

async function clasificar(card, categoria) {
  const id = card.dataset.id;
  const m = estado.datos.sinCategoria.find((x) => x.id === id);
  estado.enVuelo.add(id);
  card.classList.add('saliendo');
  actualizarBadge();

  try {
    const r = await llamar('clasificar', { id, cat: categoria });
    if (!r.ok) throw new Error(r.error || 'No se pudo guardar');
    // Recién con la respuesta de Google se da por guardado.
    estado.datos.sinCategoria = estado.datos.sinCategoria.filter((x) => x.id !== id);
    const rec = estado.datos.recientes.find((x) => x.id === id);
    if (rec) rec.categoria = categoria;
    guardarLS(LS_DATOS, estado.datos);
    aviso('✅ Guardado: ' + nombreDe(m) + ' → ' + categoria);
  } catch (e) {
    aviso(e.message + ' — no se guardó.', true);
  } finally {
    estado.enVuelo.delete(id);
    pintar();
  }
}

function actualizarBadge() {
  const n = pendientesDe(estado.datos, 'mios').length;
  $('badge').hidden = !n;
  $('badge').textContent = n;
}

function idNuevo() {
  return Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
}

/**
 * El borrador guarda su id: si la señal se cae y se aprieta Guardar de nuevo,
 * va el mismo id y la API no lo anota dos veces.
 */
function borrador() {
  let b = leerLS(LS_BORRADOR);
  if (!b || !b.rid) { b = { rid: idNuevo() }; guardarLS(LS_BORRADOR, b); }
  return b;
}

async function guardarNuevo() {
  const monto = parseInt($('aMonto').value.replace(/\D/g, ''), 10) || 0;
  const desc = $('aDesc').value.trim();
  if (!monto) { aviso('Falta el monto', true); $('aMonto').focus(); return; }
  if (!desc) { aviso('Falta qué fue', true); $('aDesc').focus(); return; }

  const btn = $('aGuardar');
  btn.disabled = true;
  btn.textContent = 'Guardando…';
  try {
    const r = await llamar('nuevo', {
      monto, desc, tipo: estado.tipo, cat: estado.catNueva, rid: borrador().rid
    });
    if (!r.ok) throw new Error(r.error || 'No se pudo guardar');
    aviso('✅ Guardado en la planilla (fila ' + r.fila + '): ' + desc + ' · ' + pesos(monto));
    try { localStorage.removeItem(LS_BORRADOR); } catch (e) { /* nada */ }
    $('aMonto').value = '';
    $('aDesc').value = '';
    estado.catNueva = '';
    if (estado.datos) pintarAnotarCats(estado.datos);
    refrescar();
  } catch (e) {
    aviso(e.message + ' — no se guardó, prueba otra vez.', true);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Guardar';
  }
}

// --- Navegación y avisos --------------------------------------------------

function irA(vista) {
  estado.vista = vista;
  ['vMes', 'vClasificar', 'vAnotar'].forEach((v) => { $(v).hidden = v !== vista; });
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === vista));
  pintarTitulo();
  window.scrollTo(0, 0);
}

let corteAviso;
function aviso(texto, esError) {
  const t = $('toast');
  t.textContent = texto;
  t.classList.toggle('error', !!esError);
  t.hidden = false;
  clearTimeout(corteAviso);
  corteAviso = setTimeout(() => { t.hidden = true; }, esError ? 5000 : 3200);
}

// --- Arranque -------------------------------------------------------------

function conectar() {
  document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => irA(b.dataset.tab)));
  $('btnRefrescar').addEventListener('click', refrescar);
  $('mAvisoPend').addEventListener('click', () => irA('vClasificar'));

  $('segQuien').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    estado.quien = b.dataset.v;
    $('segQuien').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    pintarClasificar(estado.datos);
  });

  $('cLista').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip'); if (!chip) return;
    clasificar(chip.closest('.gasto'), chip.dataset.cat);
  });

  $('aTipo').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    estado.tipo = b.dataset.v;
    $('aTipo').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
  });
  $('aCats').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip'); if (!chip) return;
    estado.catNueva = estado.catNueva === chip.dataset.cat ? '' : chip.dataset.cat;
    pintarAnotarCats(estado.datos);
  });
  $('aMonto').addEventListener('input', (e) => {
    const n = e.target.value.replace(/\D/g, '');
    e.target.value = n ? Number(n).toLocaleString('es-CL') : '';
  });
  $('aDesc').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });
  $('aGuardar').addEventListener('click', guardarNuevo);

  $('setupGuardar').addEventListener('click', () => {
    const cfg = configDeLink($('setupLink').value.trim());
    if (!cfg) { aviso('Ese link no sirve: tiene que ser el que manda el bot.', true); return; }
    guardarLS(LS_CFG, cfg);
    location.reload();
  });

  // Al volver a la app después de un rato, datos frescos.
  let ultimaVez = Date.now();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && estado.cfg && Date.now() - ultimaVez > 60000) refrescar();
    ultimaVez = Date.now();
  });
}

function iniciar() {
  conectar();
  estado.cfg = cargarConfig();

  if (!estado.cfg) {
    ['vMes', 'vClasificar', 'vAnotar'].forEach((v) => { $(v).hidden = true; });
    $('vSetup').hidden = false;
    document.querySelector('.tabs').hidden = true;
    $('btnRefrescar').hidden = true;
    $('topTitle').textContent = 'Bienvenido';
    return;
  }

  // Lo último que se vio aparece al tiro; Google responde en unos segundos.
  estado.datos = leerLS(LS_DATOS);
  irA('vMes');
  if (estado.datos) pintar();
  else $('mRecientes').innerHTML = '<div class="cargando">Leyendo la planilla…</div>';
  refrescar();

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

iniciar();
