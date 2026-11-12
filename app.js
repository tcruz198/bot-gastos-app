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
const LS_PUSH = 'gastos.push';   // { endpoint, enviado: ms } de la suscripción de este teléfono

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
    estado.datos = normalizar(d);
    guardarLS(LS_DATOS, estado.datos);
    pintar();
  } catch (e) {
    aviso(e.message, true);
  } finally {
    btn.classList.remove('girando');
  }
}

// --- Formato --------------------------------------------------------------

/**
 * Fechas siempre 'aaaa-mm-dd' y horas '09:05'. La API vieja (y lo guardado
 * en el teléfono antes del 04-11) mandaba '31/10/2026': la fecha no se veía
 * y el orden salía mal.
 */
function fechaIso(f) {
  const m = String(f || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : String(f || '');
}
function horaPad(h) {
  const m = String(h || '').match(/^(\d{1,2}):(\d{2})/);
  return m ? m[1].padStart(2, '0') + ':' + m[2] : String(h || '');
}
function normalizar(d) {
  if (!d) return d;
  const arreglar = (lista) => (lista || []).forEach((m) => { m.fecha = fechaIso(m.fecha); m.hora = horaPad(m.hora); });
  arreglar(d.recientes); arreglar(d.delMes); arreglar(d.sinCategoria);
  const nuevoPrimero = (a, b) => (b.fecha + b.hora).localeCompare(a.fecha + a.hora);
  ['recientes', 'delMes', 'sinCategoria'].forEach((k) => { if (d[k]) d[k].sort(nuevoPrimero); });
  return d;
}

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
  const f = new Date(fechaIso(iso) + 'T12:00:00');
  if (isNaN(f)) return String(iso || '');
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
  pintarGuia(d);
  if (d.delMes) cal.meses[mesISO(d.mes)] = d.delMes;
  pintarBadgeCasa();
  if (estado.vista === 'vCasa') pintarCasa();
  if (estado.vista === 'vDias' && cal.mes) pintarCalendario();
  const mios = pendientesDe(d, 'mios').length;
  $('badge').hidden = !mios;
  $('badge').textContent = mios > 99 ? '99+' : mios;
  pintarTitulo();
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** «Buenos días ☀️ · jueves 12»: cambia con la hora del teléfono. */
function saludoDelMomento() {
  const ahora = new Date();
  const h = ahora.getHours();
  const s = h >= 5 && h < 12 ? 'Buenos días ☀️' : h >= 12 && h < 20 ? 'Buenas tardes 🌤️' : 'Buenas noches 🌙';
  return s + ' · ' + DIAS[ahora.getDay()] + ' ' + ahora.getDate();
}

/**
 * El mes como 'aaaa-mm'. La API lo manda como «Noviembre 2026» (nombreDelMes del bot):
 * el 12-11 el calendario lo esperaba 'aaaa-mm' y salía «undefined NaN» sin grilla.
 */
function mesISO(texto) {
  const t = String(texto || '').trim();
  let m = /^(\d{4})-(\d{2})/.exec(t);
  if (m) return m[1] + '-' + m[2];
  m = /^([a-záéíóúñ]+)\s+(\d{4})$/i.exec(t);
  if (m) { const i = MESES.indexOf(norm(m[1])); if (i >= 0) return m[2] + '-' + String(i + 1).padStart(2, '0'); }
  const hoy = new Date();
  return hoy.getFullYear() + '-' + String(hoy.getMonth() + 1).padStart(2, '0');
}

function nombreMes(texto) {
  return MESES[Number(mesISO(texto).slice(5, 7)) - 1];
}

function pintarTitulo() {
  const d = estado.datos;
  const nombre = d ? d.persona : '';
  const titulos = {
    vMes: nombre ? `Hola ${esc(nombre)} <span class="saluda">👋🏼</span>` : 'Gastos',
    vDias: '📅 Calendario',
    vCasa: '🏠 Casa',
    vClasificar: '🏷️ Clasificar',
    vAnotar: '✍️ Anotar gasto'
  };
  const html = titulos[estado.vista] || 'Gastos';
  if ($('topTitle').innerHTML !== html) $('topTitle').innerHTML = html;
  $('topSub').textContent = saludoDelMomento();
}

/** El monto grande sube desde cero la primera vez que se pinta (después cambia directo). */
function contarHasta(el, valor, formato) {
  if (sinMovimiento() || estado.contado || !isFinite(valor)) { el.textContent = formato(valor); return; }
  estado.contado = true;
  const t0 = performance.now(), dur = 900;
  const paso = (t) => {
    const k = Math.min(1, (t - t0) / dur);
    el.textContent = formato(Math.round(valor * (1 - Math.pow(1 - k, 3))));
    if (k < 1) requestAnimationFrame(paso);
  };
  requestAnimationFrame(paso);
}

// La misma silueta de los tres que va en el index (de la mano, discreta).
const FAMILIA_SVG = '<svg class="familia-chica" viewBox="0 0 200 120" aria-hidden="true"><g fill="currentColor"><circle cx="40" cy="24" r="11"/><rect x="28" y="38" width="24" height="46" rx="11"/><rect x="30" y="78" width="9" height="40" rx="4.5"/><rect x="41" y="78" width="9" height="40" rx="4.5"/><circle cx="100" cy="66" r="8"/><rect x="91" y="76" width="18" height="25" rx="8"/><rect x="93" y="96" width="6.5" height="22" rx="3.2"/><rect x="100.5" y="96" width="6.5" height="22" rx="3.2"/><circle cx="160" cy="26" r="10"/><circle cx="169" cy="21" r="5"/><path d="M151 38 h18 q4 0 5 5 l7 41 h-42 l7 -41 q1 -5 5 -5 z"/><rect x="151" y="82" width="7" height="36" rx="3.5"/><rect x="162" y="82" width="7" height="36" rx="3.5"/></g><g fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round"><path d="M50 46 Q72 70 91 83"/><path d="M150 46 Q128 70 109 83"/><path d="M30 46 Q22 66 25 82"/><path d="M170 46 Q179 66 177 80"/></g></svg>';

// Emoji por categoría: solo adorno, una categoría nueva sale con 🏷️.
const EMOJI = {
  'comida': '🥦', 'chatarra': '🍟', 'entretenimiento': '🎉', 'transporte': '🚗',
  'suscripciones': '🔁', 'salud': '💊', 'lucas': '👶', 'mejoras hogar': '🪴',
  'gasto fijo': '🏠', 'deudas': '💳', 'otros': '📦', 'sin clasificar': '🏷️', 'sin recuerdo': '🤷'
};
const emojiDe = (c) => EMOJI[norm(c)] || '🏷️';
// Orden fijo del día a día: así Marta encuentra cada tarjeta siempre en el mismo lugar.
const ORDEN = ['comida', 'chatarra', 'entretenimiento', 'transporte', 'lucas', 'salud',
               'suscripciones', 'mejoras hogar', 'otros'];
const FIJOS = ['gasto fijo'];

function esMetaApp(d, c) { return (d.metas || ['Deudas']).some((m) => norm(m) === norm(c)); }

/** verde = va al ritmo del mes, amarillo = va más rápido que el mes, rojo = se pasó. */
function ritmo(pct, avance) {
  if (pct >= 100) return { clase: 'rojo', txt: 'se pasó' };
  if (pct > avance + 10) return { clase: 'amarillo', txt: 'va rápido' };
  return { clase: 'verde', txt: 'al ritmo' };
}

function pintarMes(d) {
  const queda = d.ingresos - d.total;
  if (d.ingresos) contarHasta($('mQueda'), queda, pesos); else $('mQueda').textContent = '—';
  const mes = nombreMes(d.mes);
  if ($('mHeroLabel')) $('mHeroLabel').textContent = '💰 Queda del sueldo' + (mes ? ' en ' + mes : '');
  $('mQueda').classList.toggle('neg', queda < 0);
  const faltan = d.diasRestantes ?? null;
  $('mHeroSub').innerHTML = `Gastado <b>${pesos(d.total)}</b>${d.ingresos ? ' de ' + pesos(d.ingresos) : ''}` +
    (faltan !== null ? ` · 📅 faltan <b>${faltan}</b> día${faltan === 1 ? '' : 's'}` : '') +
    ` · ${d.cantidad} gastos`;

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
  $('mAvisoPend').hidden = false;
  $('mAvisoPend').classList.toggle('al-dia', !pend.length);
  $('mAvisoPend').innerHTML = pend.length
    ? `🏷️ <span>Tienes <b>${pend.length}</b> gasto${pend.length > 1 ? 's' : ''} sin categoría. <u>Clasificar</u></span>`
    : `✨ <span>Tienes todo clasificado, bien ahí 🙌</span>`;

  $('mAvance').textContent = '· va el ' + d.avanceMes + '% del mes ⏳';
  pintarLectura(d.lectura);
  const pres = d.presupuesto || [];

  // Meta de deuda: acá llenar la barra es lo bueno.
  const meta = pres.find((p) => esMetaApp(d, p.categoria));
  $('mMeta').hidden = !meta;
  if (meta) {
    const pct = Math.round(meta.gasto / meta.tope * 100);
    const falta = meta.tope - meta.gasto;
    $('mMeta').dataset.cat = meta.categoria;
    $('mMeta').innerHTML = `
      <div class="meta-top"><span class="meta-emoji">${emojiDe(meta.categoria)}</span>
        <div><div class="meta-tit">Meta de ${esc(meta.categoria.toLowerCase())}</div>
        <div class="meta-sub">${falta > 0 ? 'faltan <b>' + pesos(falta) + '</b> para la meta' : '🎉 ¡Meta cumplida!'}</div></div>
        <div class="meta-pct">${pct}%</div></div>
      <div class="barra gruesa"><i style="width:${Math.min(pct, 100)}%;background:var(--menta)"></i></div>
      <div class="meta-pie">Pagado ${pesos(meta.gasto)} de ${pesos(meta.tope)}</div>`;
  }

  const tarjeta = (p, ancha) => {
    const pct = Math.round(p.gasto / p.tope * 100);
    // Los fijos se pagan a principio de mes: el ritmo del mes no aplica.
    const r = ancha && pct < 100 ? { clase: 'neutro', txt: pct + '% pagado' } : ritmo(pct, d.avanceMes);
    const queda = p.tope - p.gasto;
    return `<button class="cat ${r.clase}${ancha ? ' ancha' : ''}" data-cat="${esc(p.categoria)}">
      <div class="cat-top"><span class="cat-emoji">${emojiDe(p.categoria)}</span><span class="cat-nom">${esc(p.categoria)}</span></div>
      <div class="cat-label">${queda >= 0 ? 'Quedan' : 'Pasado por'}</div>
      <div class="cat-monto">${pesos(Math.abs(queda))}</div>
      <div class="barra"><i style="width:${Math.min(pct, 100)}%"></i><span class="hoy" style="left:${d.avanceMes}%"></span></div>
      <div class="cat-pie"><span>${pesos(p.gasto)} de ${pesos(p.tope)}</span><span class="cat-ritmo">${r.txt}</span></div>
    </button>`;
  };

  const posicion = (c) => { const i = ORDEN.indexOf(norm(c)); return i === -1 ? 99 : i; };
  const diaADia = pres.filter((p) => !esMetaApp(d, p.categoria) && !FIJOS.includes(norm(p.categoria)))
    .sort((a, b) => posicion(a.categoria) - posicion(b.categoria));
  $('mCats').innerHTML = diaADia.length ? diaADia.map((p) => tarjeta(p)).join('')
    : '<div class="card muted">Sin topes definidos en la hoja Presupuesto.</div>';

  const fijos = pres.filter((p) => FIJOS.includes(norm(p.categoria)));
  $('mFijos').innerHTML = fijos.length ? '<h3 class="sec">🏠 Fijos del depto</h3>' +
    '<div class="grid-cats">' + fijos.map((p) => tarjeta(p, true)).join('') + '</div>' : '';

  const conTope = new Set(pres.map((p) => norm(p.categoria)));
  const sinTope = d.porCategoria.filter((c) => !conTope.has(norm(c.categoria)));
  $('mSinTopeTit').hidden = $('mSinTope').hidden = !sinTope.length;
  $('mSinTope').innerHTML = sinTope.map((c) =>
    `<div class="fila"><span class="${norm(c.categoria) === 'sin clasificar' ? 'tag-sin' : ''}">${esc(c.categoria)}</span><span class="monto">${pesos(c.monto)}</span></div>`).join('');

  $('mRecientes').innerHTML = listaMovs(d.recientes) || '<div class="muted">Todavía no hay gastos este mes.</div>';
}

/** Gastos agrupados por día (se usa en el mes y en el detalle de una categoría). */
function listaMovs(movs) {
  let html = '', diaPrevio = '';
  movs.forEach((m) => {
    if (m.fecha !== diaPrevio) { html += `<div class="dia">${diaLegible(m.fecha)}</div>`; diaPrevio = m.fecha; }
    const sin = !m.categoria || norm(m.categoria) === 'sin clasificar';
    const detalle = m.comercio && m.notas ? m.notas : (sin ? '' : m.categoria);
    html += `<div class="fila">
      <div class="mov-izq"><div class="mov-nombre">${esc(nombreDe(m))}</div>
      <div class="mov-meta"><i class="punto" style="background:var(--${m.persona === 'Marta' ? 'marta' : 'tomas'})"></i>${sin ? '<span class="tag-sin">sin categoría</span>' : esc(detalle)}</div></div>
      <div class="monto">${montoDe(m)}</div></div>`;
  });
  return html;
}

/** Hoja de abajo con los gastos del mes de una categoría. */
function abrirCategoria(cat) {
  const d = estado.datos; if (!d) return;
  const movs = (d.delMes || d.recientes).filter((m) => norm(m.categoria) === norm(cat));
  const p = (d.presupuesto || []).find((x) => norm(x.categoria) === norm(cat));
  const gasto = movs.filter((m) => m.moneda !== 'USD').reduce((s, m) => s + m.monto, 0);
  $('hTit').textContent = emojiDe(cat) + ' ' + cat;
  $('hDef').textContent = (d.definiciones || {})[cat] || '';
  $('hRes').innerHTML = p
    ? `<div><span>Gastado</span><b>${pesos(p.gasto)}</b></div><div><span>${esMetaApp(d, cat) ? 'Meta' : 'Tope'}</span><b>${pesos(p.tope)}</b></div>` +
      `<div><span>${esMetaApp(d, cat) ? 'Falta' : 'Quedan'}</span><b>${pesos(Math.max(p.tope - p.gasto, 0))}</b></div>`
    : `<div><span>Gastado</span><b>${pesos(gasto)}</b></div>`;
  $('hLista').innerHTML = listaMovs(movs) || '<div class="muted">Nada este mes todavía.</div>';
  $('velo').hidden = $('hoja').hidden = false;
  requestAnimationFrame(() => { $('velo').classList.add('on'); $('hoja').classList.add('on'); });
}
/** La hoja de detalle se cierra deslizándola hacia abajo, como en el iPhone (si está arriba del todo). */
function arrastrarHoja() {
  const hoja = $('hoja'); if (!hoja) return;
  let y0 = null; let dy = 0;
  hoja.addEventListener('touchstart', (e) => {
    y0 = hoja.scrollTop <= 0 ? e.touches[0].clientY : null; dy = 0;
  }, { passive: true });
  hoja.addEventListener('touchmove', (e) => {
    if (y0 === null) return;
    dy = Math.max(0, e.touches[0].clientY - y0);
    if (dy > 0) { hoja.style.transition = 'none'; hoja.style.transform = `translateY(${dy}px)`; }
  }, { passive: true });
  hoja.addEventListener('touchend', () => {
    if (y0 === null) return;
    hoja.style.transition = ''; hoja.style.transform = '';
    if (dy > 90) cerrarHoja();
    y0 = null;
  });
}

function cerrarHoja() {
  $('velo').classList.remove('on'); $('hoja').classList.remove('on');
  setTimeout(() => { $('velo').hidden = $('hoja').hidden = true; }, 220);
}

function pintarGuia(d) {
  const defs = d.definiciones || {};
  $('cGuia').hidden = !Object.keys(defs).length;
  $('cGuiaLista').innerHTML = d.categorias.map((c) =>
    `<div class="guia-fila"><b>${emojiDe(c)} ${esc(c)}</b><span>${esc(defs[c] || '')}</span></div>`).join('');
}

function norm(s) {
  return String(s || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function pendientesDe(d, quien) {
  return d.sinCategoria.filter((m) =>
    !estado.enVuelo.has(m.id) && (quien === 'todos' || m.persona === d.persona));
}

function pintarClasificar(d) {
  // Lo escrito y la categoría marcada sobreviven al repintar (antes se borraban al guardar otra tarjeta).
  const previo = {};
  document.querySelectorAll('#cLista .gasto').forEach((c) => {
    previo[c.dataset.id] = { nota: c.querySelector('.gasto-input')?.value, cat: c.dataset.cat || '' };
  });
  // Del más nuevo al más viejo (la API ya los manda así; esto es por si acaso).
  const lista = pendientesDe(d, estado.quien).slice()
    .sort((a, b) => (b.fecha + b.hora).localeCompare(a.fecha + a.hora));
  if (!lista.length) {
    $('cLista').innerHTML = `<div class="vacio">${FAMILIA_SVG}<b>Todo en orden en casa</b>${
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
      <input class="gasto-input" type="text" placeholder="Qué fue (ej: feria, regalo Cony…)" value="${esc(m.comercio ? m.notas : '')}" autocomplete="off" enterkeyhint="done">
      <div class="gasto-ayuda">${m.sugerida ? 'Si está bien, toca la sugerida y después Guardar.' : 'Escribe qué fue, elige la categoría y toca Guardar.'}</div>
      ${m.sugerida ? `<button class="chip sugerida" data-cat="${esc(m.sugerida.categoria)}">
        <span>✓ ${emojiDe(m.sugerida.categoria)} ${esc(m.sugerida.categoria)}</span>
        <small>${m.sugerida.total > 1 ? `así quedó ${m.sugerida.veces} de ${m.sugerida.total} veces` : 'así quedó la vez anterior'}</small></button>
        <div class="otra">u otra:</div>` : ''}
      <div class="chips">${d.categorias.filter((c) => !m.sugerida || c !== m.sugerida.categoria).map((c) => `<button class="chip" data-cat="${esc(c)}">${emojiDe(c)} ${esc(c)}</button>`).join('')}</div>
      <button class="btn gasto-guardar" disabled>Elige una categoría</button>
    </div>`).join('');
  document.querySelectorAll('#cLista .gasto').forEach((card) => {
    const p = previo[card.dataset.id]; if (!p) return;
    if (p.nota !== undefined) card.querySelector('.gasto-input').value = p.nota;
    if (p.cat) marcarCategoria(card, p.cat, true);
  });
  enfocarGastoPedido();
}

/** Marca (o desmarca con '') la categoría de una tarjeta y deja listo el botón Guardar. */
function marcarCategoria(card, cat, sinEfecto) {
  card.dataset.cat = cat;
  card.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', !!cat && c.dataset.cat === cat));
  const btn = card.querySelector('.gasto-guardar');
  btn.disabled = !cat;
  btn.textContent = cat ? 'Guardar en ' + emojiDe(cat) + ' ' + cat : 'Elige una categoría';
  if (!sinEfecto && cat) { toque(); btn.classList.remove('listo'); void btn.offsetWidth; btn.classList.add('listo'); }
}

/** Vibración cortita al tocar (Android; el iPhone no la permite a páginas web y la ignora). */
function toque(ms) { try { navigator.vibrate && navigator.vibrate(ms || 8); } catch (e) { /* nada */ } }

/** La tarjeta se va a la derecha y después se cierra el hueco: la siguiente sube sola. */
function sacarTarjeta(card) {
  card.classList.add('saliendo');
  if (sinMovimiento() || !card.animate) return;
  const cs = getComputedStyle(card);
  const desde = { height: card.offsetHeight + 'px', marginBottom: cs.marginBottom, paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom };
  card.style.overflow = 'hidden';
  setTimeout(() => {
    card.animate([desde, { height: '0px', marginBottom: '0px', paddingTop: '0px', paddingBottom: '0px' }],
    { duration: 260, easing: 'cubic-bezier(0.23, 1, 0.32, 1)', fill: 'forwards' });
  }, 220);
}

function sinMovimiento() { return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches; }

function pintarAnotarCats(d) {
  $('aCats').innerHTML = d.categorias.map((c) =>
    `<button class="chip${c === estado.catNueva ? ' on' : ''}" data-cat="${esc(c)}">${emojiDe(c)} ${esc(c)}</button>`).join('');
}

// --- Acciones -------------------------------------------------------------

async function clasificar(card, categoria) {
  const id = card.dataset.id;
  const m = estado.datos.sinCategoria.find((x) => x.id === id);
  estado.enVuelo.add(id);
  sacarTarjeta(card);
  actualizarBadge();

  try {
    const nota = (card.querySelector('.gasto-input')?.value || '').trim();
    const r = await llamar('clasificar', { id, cat: categoria, nota });
    if (!r.ok) throw new Error(r.error || 'No se pudo guardar');
    // Recién con la respuesta de Google se da por guardado.
    estado.datos.sinCategoria = estado.datos.sinCategoria.filter((x) => x.id !== id);
    const rec = estado.datos.recientes.find((x) => x.id === id);
    if (rec) { rec.categoria = categoria; if (nota) rec.notas = nota; }
    guardarLS(LS_DATOS, estado.datos);
    toque(14);
    aviso(['✅', '🙌', '✨', '👌', '💪'][Math.floor(Math.random() * 5)] + ' Guardado: ' + nombreDe(m) + ' → ' + categoria + (nota ? ' · ' + nota : ''));
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

// --- Lectura del mes (la escribe Claude una vez al mes, 12-11) ---------------

function pintarLectura(l) {
  const caja = $('mLectura'); if (!caja) return;
  if (!l || !l.texto) { caja.hidden = true; return; }
  const nombre = MESES[Number(String(l.mes).slice(5, 7)) - 1] || '';
  const tit = (l.tipo === 'avance' ? '🧠 Cómo va ' : '🧠 Lectura de ') + nombre;
  const abierta = caja.dataset.abierta === '1';
  const parrafos = esc(l.texto).split(/\n+/).filter((x) => x.trim());
  caja.hidden = false;
  caja.innerHTML = `<button class="lectura-top" data-lectura>
      <span><b>${tit}</b><small>Escrita por Claude con los gastos del mes</small></span><span class="lectura-flecha">${abierta ? '▴' : '▾'}</span></button>
    <div class="lectura-txt${abierta ? '' : ' corta'}">${parrafos.map((x) => `<p>${x}</p>`).join('')}</div>`;
}

// Qué día se gastó en qué: el mes en grilla, con filtro por categoría y persona.
// «Todo» mira el día a día: sin Gasto fijo ni Deudas (el arriendo taparía todo).

const FUERA_DEL_DIA_A_DIA = ['gasto fijo', 'deudas'];
const cal = { mes: '', filtro: '', quien: 'todos', meses: {}, modo: 'gastos' };  // meses: 'aaaa-mm' → movs

function mesActual() { return mesISO(estado.datos?.mes); }

function moverMes(aaaamm, delta) {
  const [a, m] = aaaamm.split('-').map(Number);
  const f = new Date(a, m - 1 + delta, 1);
  return f.getFullYear() + '-' + String(f.getMonth() + 1).padStart(2, '0');
}

function abreviado(n) {
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(1).replace('.', ',') + 'M';
  if (n >= 1000) return '$' + Math.round(n / 1000) + 'k';
  return '$' + Math.round(n);
}

async function abrirCalendario() {
  if (!cal.mes) cal.mes = mesActual();
  if (estado.datos?.delMes) cal.meses[mesActual()] = estado.datos.delMes;
  pintarCalendario();
  if (!cal.meses[cal.mes]) await cargarMesCal(cal.mes);
}

async function cargarMesCal(mes) {
  $('calGrid').classList.add('cargando-cal');
  try {
    const r = await llamar('calendario', { mes });
    if (!r.ok) throw new Error(r.error || 'No pude leer ese mes');
    cal.meses[mes] = (r.movs || []).map((m) => ({ ...m, fecha: fechaIso(m.fecha) }));
  } catch (e) {
    aviso(e.message, true);
  } finally {
    $('calGrid').classList.remove('cargando-cal');
    if (cal.mes === mes) pintarCalendario();
  }
}

/** Los gastos que cuentan con el filtro y la persona elegidos. */
function movsDelCal() {
  return (cal.meses[cal.mes] || []).filter((m) => {
    if (m.moneda === 'USD') return false;
    if (cal.quien !== 'todos' && m.persona !== cal.quien) return false;
    if (cal.filtro) return norm(m.categoria) === norm(cal.filtro);
    return FUERA_DEL_DIA_A_DIA.indexOf(norm(m.categoria)) < 0;
  });
}

function pintarCalendario() {
  const d = estado.datos;
  const [a, m] = cal.mes.split('-').map(Number);
  $('calMes').textContent = MESES[m - 1] + ' ' + a;
  const familia = cal.modo === 'familia';
  document.querySelectorAll('#vDias .solo-gastos').forEach((x) => { x.hidden = familia; });
  document.querySelectorAll('#vDias .solo-familia').forEach((x) => { x.hidden = !familia; });
  // En Familia se puede ir hacia adelante (eventos futuros); en Gastos no hay nada después de hoy.
  $('calDespues').disabled = !familia && cal.mes >= mesActual();
  if (familia) return pintarCalendarioFamilia(a, m);

  // Filtros: «Todo» + las categorías (sin las fijas, que no son de día a día... salvo que las pidan).
  const cats = (d?.categorias || []).filter((c) => norm(c) !== 'sin recuerdo');
  $('calFiltros').innerHTML = [`<button class="chip${cal.filtro ? '' : ' on'}" data-cal="">✨ Todo</button>`]
    .concat(cats.map((c) => `<button class="chip${cal.filtro === c ? ' on' : ''}" data-cal="${esc(c)}">${emojiDe(c)} ${esc(c)}</button>`)).join('');

  const movs = movsDelCal();
  const porDia = {};
  movs.forEach((x) => {
    const dia = Number(x.fecha.slice(8, 10));
    (porDia[dia] = porDia[dia] || { total: 0, n: 0, cats: {} });
    porDia[dia].total += x.monto; porDia[dia].n++;
    porDia[dia].cats[x.categoria] = (porDia[dia].cats[x.categoria] || 0) + x.monto;
  });
  const max = Math.max(1, ...Object.values(porDia).map((x) => x.total));
  const hoy = new Date();
  const esEsteMes = hoy.getFullYear() === a && hoy.getMonth() + 1 === m;
  const diasMes = new Date(a, m, 0).getDate();
  const corrimiento = (new Date(a, m - 1, 1).getDay() + 6) % 7; // lunes primero

  let html = '<span class="cal-dia vacio"></span>'.repeat(corrimiento);
  for (let dia = 1; dia <= diasMes; dia++) {
    const info = porDia[dia];
    const futuro = esEsteMes && dia > hoy.getDate();
    const nivel = info ? Math.max(0.16, info.total / max) : 0;
    const emoji = info ? (cal.filtro ? emojiDe(cal.filtro) : emojiDe(Object.keys(info.cats).sort((x, y) => info.cats[y] - info.cats[x])[0])) : '';
    html += `<button class="cal-dia${info ? ' con' : ''}${futuro ? ' futuro' : ''}${esEsteMes && dia === hoy.getDate() ? ' hoy' : ''}"
      ${info ? `data-dia="${dia}" style="--nivel:${nivel.toFixed(2)}"` : 'disabled'}>
      <span class="cal-num">${dia}</span>${info ? `<span class="cal-emoji">${emoji}</span><span class="cal-monto">${abreviado(info.total)}</span>` : ''}</button>`;
  }
  $('calGrid').innerHTML = html;
  $('calLey').textContent = cal.filtro
    ? 'Cada cuadro marcado es un día con ' + cal.filtro + '. Más color, más gasto. Toca un día para ver el detalle.'
    : 'Día a día, sin arriendo, gastos comunes ni deudas. El emoji es en lo que más se gastó ese día.';

  pintarResumenCal(movs, porDia);
  pintarSemanaCal(movs);
}

function pintarResumenCal(movs, porDia) {
  const total = movs.reduce((s, x) => s + x.monto, 0);
  const dias = Object.keys(porDia).map(Number);
  const tit = cal.filtro ? emojiDe(cal.filtro) + ' ' + esc(cal.filtro) : '✨ Día a día';
  if (!movs.length) {
    $('calRes').innerHTML = `<div class="cal-res-tit">${tit}</div><div class="muted">${cal.meses[cal.mes] ? 'Nada en este mes 🙌' : 'Leyendo la planilla…'}</div>`;
    return;
  }
  const masCaro = dias.sort((x, y) => porDia[y].total - porDia[x].total)[0];
  const [a, m] = cal.mes.split('-').map(Number);
  const fechaCara = DIAS[new Date(a, m - 1, masCaro).getDay()] + ' ' + masCaro;
  // En el mes en curso se cuentan los días que van, no el mes entero.
  const hoy = new Date();
  const corridos = hoy.getFullYear() === a && hoy.getMonth() + 1 === m ? hoy.getDate() : new Date(a, m, 0).getDate();
  const cada = corridos / dias.length;
  const cadaCuanto = dias.length > 1 ? (cada < 1.5 ? ' · casi todos los días' : ' · más o menos cada ' + Math.round(cada) + ' días') : '';
  $('calRes').innerHTML = `<div class="cal-res-tit">${tit}</div>
    <div class="cal-res-grid">
      <div><span>Total</span><b>${pesos(total)}</b></div>
      <div><span>${cal.filtro ? 'Veces' : 'Compras'}</span><b>${movs.length}</b></div>
      <div><span>Días</span><b>${dias.length}</b></div>
    </div>
    <div class="cal-res-pie">📍 El día de más gasto fue el <b>${fechaCara}</b> (${pesos(porDia[masCaro].total)})${cal.filtro ? cadaCuanto : ''}</div>`;
}

function pintarSemanaCal(movs) {
  const nombres = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
  const suma = [0, 0, 0, 0, 0, 0, 0];
  movs.forEach((x) => { const [a, m, d] = x.fecha.split('-').map(Number); suma[(new Date(a, m - 1, d).getDay() + 6) % 7] += x.monto; });
  const max = Math.max(1, ...suma);
  const top = suma.indexOf(Math.max(...suma));
  $('calSemana').innerHTML = movs.length ? nombres.map((n, i) => `<div class="sem-fila${i === top ? ' top' : ''}">
      <span>${n}</span><i><b style="width:${(suma[i] / max * 100).toFixed(1)}%"></b></i><span class="monto">${suma[i] ? abreviado(suma[i]) : '—'}</span></div>`).join('')
    : '<div class="muted">Sin gastos para comparar.</div>';
}

function abrirDiaCal(dia) {
  const fecha = cal.mes + '-' + String(dia).padStart(2, '0');
  const movs = movsDelCal().filter((x) => x.fecha === fecha);
  const total = movs.reduce((s, x) => s + x.monto, 0);
  $('hTit').textContent = '📅 ' + diaLegible(fecha);
  $('hDef').textContent = cal.filtro ? 'Solo ' + cal.filtro : 'Día a día (sin fijos ni deudas)';
  $('hRes').innerHTML = `<div><span>Gastado</span><b>${pesos(total)}</b></div><div><span>Compras</span><b>${movs.length}</b></div><div><span>Quién</span><b>${cal.quien === 'todos' ? 'Los dos' : esc(cal.quien)}</b></div>`;
  $('hLista').innerHTML = listaMovs(movs);
  $('velo').hidden = $('hoja').hidden = false;
  requestAnimationFrame(() => { $('velo').classList.add('on'); $('hoja').classList.add('on'); });
}

function conectarCalendario() {
  on('calAntes', 'click', () => { cal.mes = moverMes(cal.mes, -1); pintarCalendario(); if (!cal.meses[cal.mes]) cargarMesCal(cal.mes); });
  on('calDespues', 'click', () => {
    if (cal.modo !== 'familia' && cal.mes >= mesActual()) return;
    cal.mes = moverMes(cal.mes, 1); pintarCalendario();
    if (cal.modo !== 'familia' && !cal.meses[cal.mes]) cargarMesCal(cal.mes);
  });
  on('calModo', 'click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    cal.modo = b.dataset.v;
    $('calModo').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    if (cal.modo === 'gastos' && cal.mes > mesActual()) cal.mes = mesActual();
    pintarCalendario();
    if (cal.modo === 'gastos' && !cal.meses[cal.mes]) cargarMesCal(cal.mes);
  });
  on('calFiltros', 'click', (e) => {
    const b = e.target.closest('[data-cal]'); if (!b) return;
    toque(); cal.filtro = b.dataset.cal; pintarCalendario();
  });
  on('calQuien', 'click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    cal.quien = b.dataset.v;
    $('calQuien').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    pintarCalendario();
  });
  on('calGrid', 'click', (e) => {
    const b = e.target.closest('[data-dia]'); if (!b) return;
    if (cal.modo === 'familia') abrirDiaFamilia(Number(b.dataset.dia)); else abrirDiaCal(Number(b.dataset.dia));
  });
  on('hLista', 'click', (e) => {
    const b = e.target.closest('[data-nuevo-evento]'); if (!b) return;
    cerrarHoja(); casa.tab = 'evento'; casa.fecha = b.dataset.nuevoEvento; irA('vCasa');
    setTimeout(() => $('cnTexto') && $('cnTexto').focus(), 350);
  });
}

// --- Casa: súper, pendientes y eventos compartidos (12-11) -------------------
// Viven en la hoja «Familia». Cada cosa tiene su id inventado en el teléfono (un reintento no
// duplica). Se cambia al tiro en pantalla y después se guarda; si Google falla, se deshace.

const VISTA_DE = { clasificar: 'vClasificar', casa: 'vCasa', mes: 'vMes' };
const EMOJIS_EVENTO = ['📌', '🎂', '🩺', '👶', '🏫', '🎉', '✈️', '💼', '🍽️', '💊'];
const casa = { tab: 'lista', para: 'Los dos', emoji: '📌', fecha: '', hora: '', borrando: '' };

function famItems(tipo) { return ((estado.datos && estado.datos.familia) || []).filter((x) => x.tipo === tipo); }

function hoyLocal(delta) {
  const f = new Date(Date.now() + (delta || 0) * 864e5);
  return f.getFullYear() + '-' + String(f.getMonth() + 1).padStart(2, '0') + '-' + String(f.getDate()).padStart(2, '0');
}

function fechaAmable(iso) {
  if (!iso) return '';
  if (iso === hoyLocal()) return 'hoy';
  if (iso === hoyLocal(1)) return 'mañana';
  if (iso === hoyLocal(-1)) return 'ayer';
  return diaLegible(iso);
}

function pintarBadgeCasa() {
  const b = $('badgeCasa'); if (!b) return;
  const quien = estado.datos && estado.datos.persona;
  // Lo que es para hoy (o atrasado) y te toca a ti o a los dos.
  const n = ((estado.datos && estado.datos.familia) || []).filter((x) => x.tipo !== 'lista' && !x.hecho && x.fecha &&
    x.fecha <= hoyLocal() && (x.tipo === 'pendiente' || x.fecha === hoyLocal()) && (x.para === 'Los dos' || x.para === quien)).length;
  b.hidden = !n; b.textContent = n;
}

function chipsPara() {
  return ['Los dos', 'Tomás', 'Marta'].map((p) => `<button class="chip${casa.para === p ? ' on' : ''}" data-para="${p}">${p === 'Los dos' ? '👫 Los dos' : p}</button>`).join('');
}

function pintarCasa() {
  if (!estado.datos) return;
  $('casaSeg').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x.dataset.v === casa.tab));
  const t = casa.tab;
  let form;
  if (t === 'lista') {
    form = `<div class="cn-fila"><input id="cnTexto" type="text" placeholder="Agregar a la lista (leche, pañales…)" autocomplete="off" enterkeyhint="done">
      <button class="cn-mas" id="cnGuardar" aria-label="Agregar">＋</button></div>`;
  } else {
    if (t === 'evento' && !casa.fecha) casa.fecha = hoyLocal();
    form = `<input id="cnTexto" type="text" placeholder="${t === 'evento' ? 'Qué es (cumple de la Cony, control de Lucas…)' : 'Qué hay que hacer (pagar el jardín, llamar al banco…)'}" autocomplete="off" enterkeyhint="done">
      ${t === 'evento' ? `<div class="cn-emojis">${EMOJIS_EVENTO.map((e) => `<button class="${casa.emoji === e ? 'on' : ''}" data-emoji="${e}">${e}</button>`).join('')}</div>` : ''}
      <div class="cn-cuando">
        <label>📅 <input id="cnFecha" type="date" value="${casa.fecha}"></label>
        ${t === 'evento' ? `<label>🕐 <input id="cnHora" type="time" value="${casa.hora}"></label>` : '<span class="muted">fecha opcional</span>'}
      </div>
      <div class="chips cn-para">${chipsPara()}</div>
      <button class="btn" id="cnGuardar">${t === 'evento' ? 'Agendar' : 'Agregar pendiente'}</button>`;
  }
  // No repintar el formulario si se está escribiendo (el repintado viene del refresco automático).
  const activo = document.activeElement && $('casaNuevo').contains(document.activeElement);
  if (!activo || $('casaNuevo').dataset.tab !== t) { $('casaNuevo').innerHTML = form; $('casaNuevo').dataset.tab = t; }
  $('casaLista').innerHTML = t === 'lista' ? htmlLista() : t === 'pendiente' ? htmlPendientes() : htmlEventos();
  pintarBadgeCasa();
}

function puntoDe(p) { return `<i class="punto" style="background:var(--${p === 'Marta' ? 'marta' : 'tomas'})"></i>`; }

function botonBorrar(id) {
  return `<button class="fam-borrar${casa.borrando === id ? ' seguro' : ''}" data-borrar="${esc(id)}" aria-label="Borrar">${casa.borrando === id ? 'Borrar' : '✕'}</button>`;
}

function htmlLista() {
  const items = famItems('lista').sort((a, b) => (a.hecho - b.hecho) || (a.creado || '').localeCompare(b.creado || ''));
  if (!items.length) return `<div class="vacio">🛒<b>La lista está vacía</b>Lo que agreguen aparece acá para los dos.</div>`;
  const comprados = items.filter((x) => x.hecho).length;
  return `<div class="card fam-card">${items.map((x) => `<div class="fam-fila${x.hecho ? ' hecho' : ''}">
      <button class="fam-check" data-hecho="${esc(x.id)}" aria-label="Marcar">${x.hecho ? '✓' : ''}</button>
      <div class="fam-txt">${esc(x.texto)}<small>${puntoDe(x.creadoPor)}${esc(x.creadoPor)}</small></div>${botonBorrar(x.id)}</div>`).join('')}</div>
    ${comprados ? `<button class="fam-limpiar" id="famLimpiar">🧹 Sacar los ${comprados} comprados</button>` : ''}`;
}

function htmlPendientes() {
  const hoy = hoyLocal();
  const items = famItems('pendiente').sort((a, b) => (a.hecho - b.hecho) || ((a.fecha || '9999') .localeCompare(b.fecha || '9999')) || (a.creado || '').localeCompare(b.creado || ''));
  if (!items.length) return `<div class="vacio">✅<b>Sin pendientes</b>Anoten acá lo que hay que hacer en la casa.</div>`;
  return `<div class="card fam-card">${items.map((x) => {
    const atrasado = !x.hecho && x.fecha && x.fecha < hoy;
    return `<div class="fam-fila${x.hecho ? ' hecho' : ''}">
      <button class="fam-check" data-hecho="${esc(x.id)}" aria-label="Marcar">${x.hecho ? '✓' : ''}</button>
      <div class="fam-txt">${esc(x.texto)}<small>${x.para === 'Los dos' ? '👫 Los dos' : puntoDe(x.para) + esc(x.para)}${x.fecha ? ` · <span class="${atrasado ? 'atrasado' : ''}">${atrasado ? '⚠️ ' : '📅 '}${fechaAmable(x.fecha)}</span>` : ''}</small></div>
      ${botonBorrar(x.id)}</div>`;
  }).join('')}</div>`;
}

function htmlEventos() {
  const hoy = hoyLocal();
  const items = famItems('evento').filter((x) => x.fecha >= hoy).sort((a, b) => (a.fecha + (a.hora || '99')).localeCompare(b.fecha + (b.hora || '99')));
  if (!items.length) return `<div class="vacio">📌<b>No hay nada agendado</b>Cumpleaños, controles de Lucas, reuniones del jardín…</div>`;
  let html = '', previo = '';
  items.forEach((x) => {
    if (x.fecha !== previo) { html += `<div class="dia">${fechaAmable(x.fecha) === 'hoy' ? '☀️ Hoy' : fechaAmable(x.fecha) === 'mañana' ? '🌙 Mañana' : diaLegible(x.fecha)}</div>`; previo = x.fecha; }
    html += `<div class="fam-fila evento"><span class="fam-emoji">${esc(x.emoji || '📌')}</span>
      <div class="fam-txt">${esc(x.texto)}<small>${x.hora ? '🕐 ' + esc(x.hora) + ' · ' : ''}${x.para === 'Los dos' ? '👫 Los dos' : puntoDe(x.para) + esc(x.para)}</small></div>${botonBorrar(x.id)}</div>`;
  });
  return `<div class="card fam-card lista">${html}</div>`;
}

/** Cambia en pantalla, guarda, y si Google falla deshace. */
async function famCambiar(accion, params, aplicar, deshacer, okTxt) {
  aplicar(); guardarLS(LS_DATOS, estado.datos); pintarCasa(); toque();
  try {
    const r = await llamar(accion, params);
    if (!r.ok) throw new Error(r.error || 'No se pudo guardar');
    if (okTxt) aviso(okTxt);
  } catch (e) {
    deshacer(); guardarLS(LS_DATOS, estado.datos); pintarCasa();
    aviso(e.message + ' — no se guardó.', true);
  }
}

function famGuardarNuevo() {
  const texto = ($('cnTexto').value || '').trim();
  if (!texto) { $('cnTexto').focus(); return; }
  const t = casa.tab;
  const fecha = t === 'lista' ? '' : ($('cnFecha') ? $('cnFecha').value : '');
  if (t === 'evento' && !fecha) { aviso('Falta la fecha', true); return; }
  const item = { id: idNuevo(), tipo: t, texto, fecha, hora: t === 'evento' && $('cnHora') ? $('cnHora').value : '',
    emoji: t === 'evento' ? casa.emoji : '', para: t === 'lista' ? 'Los dos' : casa.para, hecho: false,
    creadoPor: estado.datos.persona, creado: new Date().toISOString().slice(0, 16).replace('T', ' ') };
  estado.datos.familia = estado.datos.familia || [];
  $('cnTexto').value = '';
  if (t !== 'lista') { casa.hora = ''; casa.emoji = '📌'; casa.fecha = ''; $('casaNuevo').dataset.tab = ''; }
  famCambiar('famGuardar', { id: item.id, tipo: t, texto, fecha: item.fecha, hora: item.hora, emoji: item.emoji, para: item.para },
    () => estado.datos.familia.push(item),
    () => { estado.datos.familia = estado.datos.familia.filter((x) => x.id !== item.id); },
    t === 'lista' ? '' : (t === 'evento' ? '📌 Agendado, le avisé a ' : '✅ Anotado, le avisé a ') + (estado.datos.persona === 'Marta' ? 'Tomás' : 'Marta'));
  if (t === 'lista') setTimeout(() => $('cnTexto') && $('cnTexto').focus(), 50);
}

function conectarCasa() {
  on('casaSeg', 'click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    casa.tab = b.dataset.v; casa.borrando = ''; $('casaNuevo').dataset.tab = ''; pintarCasa();
  });
  on('casaNuevo', 'click', (e) => {
    if (e.target.closest('#cnGuardar')) return famGuardarNuevo();
    const em = e.target.closest('[data-emoji]');
    if (em) { casa.emoji = em.dataset.emoji; $('casaNuevo').querySelectorAll('[data-emoji]').forEach((x) => x.classList.toggle('on', x === em)); toque(); return; }
    const pa = e.target.closest('[data-para]');
    if (pa) { casa.para = pa.dataset.para; $('casaNuevo').querySelectorAll('[data-para]').forEach((x) => x.classList.toggle('on', x === pa)); toque(); }
  });
  on('casaNuevo', 'change', (e) => {
    if (e.target.id === 'cnFecha') casa.fecha = e.target.value;
    if (e.target.id === 'cnHora') casa.hora = e.target.value;
  });
  on('casaNuevo', 'keydown', (e) => { if (e.key === 'Enter' && e.target.id === 'cnTexto') { e.preventDefault(); famGuardarNuevo(); } });
  on('casaLista', 'click', (e) => {
    const h = e.target.closest('[data-hecho]');
    if (h) {
      const x = estado.datos.familia.find((y) => y.id === h.dataset.hecho); if (!x) return;
      const antes = x.hecho;
      return famCambiar('famHecho', { id: x.id, hecho: antes ? '0' : '1' }, () => { x.hecho = !antes; x.actualizado = new Date().toISOString().slice(0, 16).replace('T', ' '); }, () => { x.hecho = antes; });
    }
    const bo = e.target.closest('[data-borrar]');
    if (bo) {
      const id = bo.dataset.borrar;
      if (casa.borrando !== id) { casa.borrando = id; pintarCasa(); setTimeout(() => { if (casa.borrando === id) { casa.borrando = ''; pintarCasa(); } }, 3000); return; }
      casa.borrando = '';
      const x = estado.datos.familia.find((y) => y.id === id); if (!x) return;
      return famCambiar('famBorrar', { id }, () => { estado.datos.familia = estado.datos.familia.filter((y) => y.id !== id); }, () => estado.datos.familia.push(x));
    }
    if (e.target.closest('#famLimpiar')) {
      const comprados = famItems('lista').filter((x) => x.hecho);
      estado.datos.familia = estado.datos.familia.filter((x) => !(x.tipo === 'lista' && x.hecho));
      guardarLS(LS_DATOS, estado.datos); pintarCasa(); toque();
      Promise.all(comprados.map((x) => llamar('famBorrar', { id: x.id }).catch(() => null)))
        .then((rs) => { if (rs.some((r) => !r || !r.ok)) { aviso('Algunos no se borraron, actualiza', true); refrescar(); } });
    }
  });
}

// Calendario en modo Familia: eventos y pendientes con fecha, por día.
function famDelDia(iso) {
  return ((estado.datos && estado.datos.familia) || []).filter((x) => x.tipo !== 'lista' && x.fecha === iso)
    .sort((a, b) => (a.hora || '99').localeCompare(b.hora || '99'));
}

function pintarCalendarioFamilia(a, m) {
  const hoy = new Date();
  const esEsteMes = hoy.getFullYear() === a && hoy.getMonth() + 1 === m;
  const diasMes = new Date(a, m, 0).getDate();
  const corrimiento = (new Date(a, m - 1, 1).getDay() + 6) % 7;
  let html = '<span class="cal-dia vacio"></span>'.repeat(corrimiento);
  for (let dia = 1; dia <= diasMes; dia++) {
    const iso = cal.mes + '-' + String(dia).padStart(2, '0');
    const cosas = famDelDia(iso);
    const emojis = cosas.slice(0, 2).map((x) => x.emoji || (x.tipo === 'evento' ? '📌' : '✅')).join('');
    html += `<button class="cal-dia fam${cosas.length ? ' con-fam' : ''}${esEsteMes && dia === hoy.getDate() ? ' hoy' : ''}" data-dia="${dia}">
      <span class="cal-num">${dia}</span>${cosas.length ? `<span class="cal-emoji">${emojis}</span>${cosas.length > 2 ? `<span class="cal-monto">+${cosas.length - 2}</span>` : '<span></span>'}` : ''}</button>`;
  }
  $('calGrid').innerHTML = html;
  $('calLey').textContent = 'Eventos y pendientes con fecha. Toca un día para ver qué hay o agendar algo.';
  const desde = hoyLocal();
  const prox = ((estado.datos && estado.datos.familia) || []).filter((x) => x.tipo === 'evento' && x.fecha >= desde)
    .sort((x, y) => (x.fecha + (x.hora || '99')).localeCompare(y.fecha + (y.hora || '99'))).slice(0, 5);
  $('calProximos').innerHTML = `<h3 class="sec">📌 Lo que viene</h3><div class="card fam-card">${prox.length ? prox.map((x) =>
    `<div class="fam-fila evento"><span class="fam-emoji">${esc(x.emoji || '📌')}</span><div class="fam-txt">${esc(x.texto)}<small>${fechaAmable(x.fecha)}${x.hora ? ' · ' + esc(x.hora) : ''}</small></div></div>`).join('')
    : '<div class="muted">Nada agendado todavía. Toca un día para agregar algo.</div>'}</div>`;
}

function abrirDiaFamilia(dia) {
  const iso = cal.mes + '-' + String(dia).padStart(2, '0');
  const cosas = famDelDia(iso);
  $('hTit').textContent = '📌 ' + diaLegible(iso);
  $('hDef').textContent = cosas.length ? (cosas.length === 1 ? '1 cosa este día' : cosas.length + ' cosas este día') : 'Nada agendado';
  $('hRes').innerHTML = '';
  $('hLista').innerHTML = cosas.map((x) => `<div class="fam-fila evento${x.hecho ? ' hecho' : ''}"><span class="fam-emoji">${esc(x.emoji || (x.tipo === 'evento' ? '📌' : '✅'))}</span>
      <div class="fam-txt">${esc(x.texto)}<small>${x.hora ? '🕐 ' + esc(x.hora) + ' · ' : ''}${x.tipo === 'pendiente' ? 'pendiente · ' : ''}${x.para === 'Los dos' ? '👫 Los dos' : esc(x.para)}</small></div></div>`).join('') +
    `<button class="btn" data-nuevo-evento="${iso}">＋ Agendar algo este día</button>`;
  $('velo').hidden = $('hoja').hidden = false;
  requestAnimationFrame(() => { $('velo').classList.add('on'); $('hoja').classList.add('on'); });
}

// --- Avisos en el teléfono (Web Push, 12-11) -------------------------------
// En iPhone solo existe con la app agregada a la pantalla de inicio (iOS 16.4+).

function pushPosible() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

function b64aBytes(b64) {
  const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64.length + 3) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

async function suscripcionActual() {
  if (!pushPosible()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

async function pintarPush() {
  const caja = $('mPush'); if (!caja) return;
  if (!pushPosible() || !estado.cfg) { caja.hidden = true; return; }
  const sub = await suscripcionActual().catch(() => null);
  const activo = sub && Notification.permission === 'granted';
  caja.hidden = false;
  caja.classList.toggle('activo', !!activo);
  if (activo) {
    caja.innerHTML = `<div class="push-fila"><span class="push-txt"><b>🔔 Avisos de gastos</b><small>Activos en este teléfono</small></span>
      <button class="switch on" data-push="apagar" role="switch" aria-checked="true" aria-label="Apagar avisos"><i></i></button></div>`;
  } else if (Notification.permission === 'denied') {
    caja.innerHTML = `<div class="push-fila"><span>🔕 Los avisos están bloqueados. Actívalos en Ajustes del teléfono, en Notificaciones, para la app Gastos.</span></div>`;
  } else {
    caja.innerHTML = `<div class="push-tit">🔔 Que te avise cuando hay un gasto</div>
      <div class="push-sub">Te llega una notificación con cada compra y al tocarla la clasificas al tiro.</div>
      <button class="btn" data-push="activar">Activar avisos</button>`;
  }
}

async function activarAvisos(btn) {
  btn.disabled = true; btn.textContent = 'Activando…';
  try {
    const permiso = await Notification.requestPermission();
    if (permiso !== 'granted') { aviso('Sin permiso no puedo avisarte. Puedes darlo después en Ajustes.', true); return; }
    const v = await llamar('vapid');
    if (!v.ok) throw new Error(v.error || 'No pude preparar los avisos');
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64aBytes(v.publica) });
    await mandarSuscripcion(sub);
    const p = await llamar('probarAviso');
    aviso(p.ok ? '✅ Avisos activados' : 'Quedó activado, pero el aviso no llegó: ' + (p.error || ''), !p.ok);
  } catch (e) {
    aviso('No se pudo activar: ' + e.message, true);
  } finally {
    pintarPush();
  }
}

async function mandarSuscripcion(sub) {
  const r = await llamar('suscribir', { sub: JSON.stringify(sub) });
  if (!r.ok) throw new Error(r.error || 'No se guardó la suscripción');
  guardarLS(LS_PUSH, { endpoint: sub.endpoint, enviado: Date.now() });
}

/** Una vez por semana se vuelve a mandar la suscripción: el teléfono a veces la cambia sin avisar. */
async function renovarSuscripcion() {
  try {
    if (!pushPosible() || Notification.permission !== 'granted') return;
    const sub = await suscripcionActual(); if (!sub) return;
    const p = leerLS(LS_PUSH) || {};
    if (p.endpoint === sub.endpoint && Date.now() - (p.enviado || 0) < 7 * 864e5) return;
    await mandarSuscripcion(sub);
  } catch (e) { /* se intenta en la próxima apertura */ }
}

async function accionPush(e) {
  const b = e.target.closest('[data-push]'); if (!b) return;
  const que = b.dataset.push;
  if (que === 'activar') return activarAvisos(b);
  if (que === 'apagar') {
    b.classList.remove('on'); toque();
    const sub = await suscripcionActual().catch(() => null);
    if (sub) { llamar('desuscribir', { endpoint: sub.endpoint }).catch(() => {}); await sub.unsubscribe().catch(() => {}); }
    try { localStorage.removeItem(LS_PUSH); } catch (err) { /* nada */ }
    aviso('Avisos apagados en este teléfono');
    pintarPush();
  }
}

/** Al tocar un aviso se abre la app en ese gasto (?gasto=id, o mensaje del service worker si ya estaba abierta). */
function irAGasto(id) {
  if (!id) return;
  estado.irAGasto = id;
  estado.quien = 'mios';
  $('segQuien')?.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x.dataset.v === 'mios'));
  irA('vClasificar');
  if (estado.datos) pintarClasificar(estado.datos);
  refrescar();
}

function enfocarGastoPedido() {
  const id = estado.irAGasto; if (!id) return;
  const card = [...document.querySelectorAll('#cLista .gasto')].find((c) => c.dataset.id === id);
  if (!card) return;
  estado.irAGasto = null;
  card.scrollIntoView({ block: 'center', behavior: sinMovimiento() ? 'auto' : 'smooth' });
  card.classList.add('pedido');
  setTimeout(() => card.classList.remove('pedido'), 2200);
}

// --- Navegación y avisos --------------------------------------------------

function irA(vista) {
  const doc = document;
  if (estado.vista && estado.vista !== vista && doc.startViewTransition && !sinMovimiento()) {
    doc.documentElement.dataset.transicion = 'pestana';
    const t = doc.startViewTransition(() => cambiarVista(vista));
    t.finished.finally(() => { delete doc.documentElement.dataset.transicion; });
    return;
  }
  cambiarVista(vista);
}

function cambiarVista(vista) {
  estado.vista = vista;
  ['vMes', 'vDias', 'vCasa', 'vClasificar', 'vAnotar'].forEach((v) => { $(v).hidden = v !== vista; });
  if (vista === 'vDias') abrirCalendario();
  if (vista === 'vCasa') pintarCasa();
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

/** addEventListener que no revienta si el elemento no está (HTML viejo en caché). */
function on(id, evento, fn) { const el = $(id); if (el) el.addEventListener(evento, fn); }

function conectar() {
  document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => irA(b.dataset.tab)));
  on('btnRefrescar', 'click', refrescar);
  on('mAvisoPend', 'click', () => { if (!$('mAvisoPend').classList.contains('al-dia')) irA('vClasificar'); });
  ['mCats', 'mFijos', 'mMeta'].forEach((id) => on(id, 'click', (e) => {
    const t = e.target.closest('[data-cat]'); if (t) abrirCategoria(t.dataset.cat);
  }));
  on('velo', 'click', cerrarHoja);
  on('mPush', 'click', accionPush);
  on('mLectura', 'click', () => {
    const c = $('mLectura'); c.dataset.abierta = c.dataset.abierta === '1' ? '' : '1';
    pintarLectura(estado.datos && estado.datos.lectura);
  });
  conectarCalendario();
  conectarCasa();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data && e.data.tipo === 'gasto') irAGasto(e.data.id);
      if (e.data && e.data.tipo === 'ir') irA(VISTA_DE[e.data.ir] || 'vMes');
    });
  }
  arrastrarHoja();
  on('hCerrar', 'click', cerrarHoja);

  on('segQuien', 'click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    estado.quien = b.dataset.v;
    $('segQuien').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    pintarClasificar(estado.datos);
  });

  on('cLista', 'keydown', (e) => {
    if (e.key === 'Enter' && e.target.classList.contains('gasto-input')) e.target.blur();
  });
  // Tocar una categoría solo la marca: se guarda recién con el botón Guardar.
  // Antes guardaba al tiro y un dedazo quedaba mal clasificado (Marta, 12-11).
  on('cLista', 'click', (e) => {
    const card = e.target.closest('.gasto'); if (!card) return;
    const guardar = e.target.closest('.gasto-guardar');
    if (guardar) {
      if (card.dataset.cat && !guardar.disabled) { guardar.disabled = true; clasificar(card, card.dataset.cat); }
      return;
    }
    const chip = e.target.closest('.chip'); if (!chip) return;
    marcarCategoria(card, card.dataset.cat === chip.dataset.cat ? '' : chip.dataset.cat);
  });

  on('aTipo', 'click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    estado.tipo = b.dataset.v;
    $('aTipo').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
  });
  on('aCats', 'click', (e) => {
    const chip = e.target.closest('.chip'); if (!chip) return;
    estado.catNueva = estado.catNueva === chip.dataset.cat ? '' : chip.dataset.cat;
    pintarAnotarCats(estado.datos);
  });
  on('aMonto', 'input', (e) => {
    const n = e.target.value.replace(/\D/g, '');
    e.target.value = n ? Number(n).toLocaleString('es-CL') : '';
  });
  on('aDesc', 'keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });
  on('aGuardar', 'click', guardarNuevo);

  on('setupGuardar', 'click', () => {
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
    ['vMes', 'vDias', 'vCasa', 'vClasificar', 'vAnotar'].forEach((v) => { $(v).hidden = true; });
    $('vSetup').hidden = false;
    document.querySelector('.tabs').hidden = true;
    $('btnRefrescar').hidden = true;
    $('topTitle').textContent = 'Bienvenido';
    return;
  }

  // Lo último que se vio aparece al tiro; Google responde en unos segundos.
  estado.datos = normalizar(leerLS(LS_DATOS));
  document.documentElement.classList.add('entrando');
  setTimeout(() => document.documentElement.classList.remove('entrando'), 900);
  const qs = new URLSearchParams(location.search);
  const pedido = qs.get('gasto');
  const ver = qs.get('ver');
  if (pedido || ver) history.replaceState(null, '', location.pathname);
  irA('vMes');
  if (estado.datos) pintar();
  else $('mRecientes').innerHTML = '<div class="cargando">Leyendo la planilla…</div>';
  if (pedido) irAGasto(pedido); else refrescar();
  if (!pedido && VISTA_DE[ver]) irA(VISTA_DE[ver]);
  pintarPush();
  renovarSuscripcion();

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

// Si algo revienta al arrancar, mostrarlo en vez de dejar la pantalla en negro.
function pantallaDeError(e) {
  document.body.innerHTML = '<div style="padding:60px 24px;text-align:center;font:16px -apple-system,sans-serif;color:#ECFDF5;background:#04231C;min-height:100vh">' +
    '<div style="font-size:44px">🔄</div><h2>La app se quedó a medio actualizar</h2>' +
    '<p style="color:#93C5B4">Toca el botón para cargar la versión nueva.</p>' +
    '<button id="btnReparar" style="margin-top:12px;padding:14px 22px;border:0;border-radius:14px;background:#F6C453;color:#3A2A05;font-weight:800;font-size:17px">Recargar</button>' +
    '<p style="color:#93C5B4;font-size:12px;margin-top:24px">' + String(e && e.message || e).replace(/[<>&]/g, '') + '</p></div>';
  document.getElementById('btnReparar').onclick = async () => {
    try {
      const regs = await navigator.serviceWorker?.getRegistrations?.() || [];
      await Promise.all(regs.map((r) => r.unregister()));
      const ks = await caches.keys(); await Promise.all(ks.map((k) => caches.delete(k)));
    } catch (x) { /* igual recarga */ }
    location.reload();
  };
}

try { iniciar(); } catch (e) { pantallaDeError(e); }
