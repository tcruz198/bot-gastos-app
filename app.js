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
  $('mQueda').textContent = d.ingresos ? pesos(queda) : '—';
  $('mQueda').classList.toggle('neg', queda < 0);
  const faltan = d.diasRestantes ?? null;
  $('mHeroSub').innerHTML = `Gastado <b>${pesos(d.total)}</b>${d.ingresos ? ' de ' + pesos(d.ingresos) : ''}` +
    (faltan !== null ? ` · faltan <b>${faltan}</b> día${faltan === 1 ? '' : 's'}` : '') +
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
  $('mAvisoPend').hidden = !pend.length;
  if (pend.length) {
    $('mAvisoPend').innerHTML = `🏷️ <span>Tienes <b>${pend.length}</b> gasto${pend.length > 1 ? 's' : ''} sin categoría. <u>Clasificar</u></span>`;
  }

  $('mAvance').textContent = '· va el ' + d.avanceMes + '% del mes';
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
  $('mFijos').innerHTML = fijos.length ? '<h3 class="sec">Fijos del depto</h3>' +
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
      <div class="gasto-ayuda">${m.sugerida ? 'Si está bien, toca la sugerida. Puedes escribir qué fue antes.' : 'Escribe qué fue y toca la categoría para guardar.'}</div>
      ${m.sugerida ? `<button class="chip sugerida" data-cat="${esc(m.sugerida.categoria)}">
        <span>✓ ${emojiDe(m.sugerida.categoria)} ${esc(m.sugerida.categoria)}</span>
        <small>${m.sugerida.total > 1 ? `así quedó ${m.sugerida.veces} de ${m.sugerida.total} veces` : 'así quedó la vez anterior'}</small></button>
        <div class="otra">u otra:</div>` : ''}
      <div class="chips">${d.categorias.filter((c) => !m.sugerida || c !== m.sugerida.categoria).map((c) => `<button class="chip" data-cat="${esc(c)}">${emojiDe(c)} ${esc(c)}</button>`).join('')}</div>
    </div>`).join('');
}

function pintarAnotarCats(d) {
  $('aCats').innerHTML = d.categorias.map((c) =>
    `<button class="chip${c === estado.catNueva ? ' on' : ''}" data-cat="${esc(c)}">${emojiDe(c)} ${esc(c)}</button>`).join('');
}

// --- Acciones -------------------------------------------------------------

async function clasificar(card, categoria) {
  const id = card.dataset.id;
  const m = estado.datos.sinCategoria.find((x) => x.id === id);
  estado.enVuelo.add(id);
  card.classList.add('saliendo');
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
    aviso('✅ Guardado: ' + nombreDe(m) + ' → ' + categoria + (nota ? ' · ' + nota : ''));
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

/** addEventListener que no revienta si el elemento no está (HTML viejo en caché). */
function on(id, evento, fn) { const el = $(id); if (el) el.addEventListener(evento, fn); }

function conectar() {
  document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => irA(b.dataset.tab)));
  on('btnRefrescar', 'click', refrescar);
  on('mAvisoPend', 'click', () => irA('vClasificar'));
  ['mCats', 'mFijos', 'mMeta'].forEach((id) => on(id, 'click', (e) => {
    const t = e.target.closest('[data-cat]'); if (t) abrirCategoria(t.dataset.cat);
  }));
  on('velo', 'click', cerrarHoja);
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
  on('cLista', 'click', (e) => {
    const chip = e.target.closest('.chip'); if (!chip) return;
    clasificar(chip.closest('.gasto'), chip.dataset.cat);
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
    ['vMes', 'vClasificar', 'vAnotar'].forEach((v) => { $(v).hidden = true; });
    $('vSetup').hidden = false;
    document.querySelector('.tabs').hidden = true;
    $('btnRefrescar').hidden = true;
    $('topTitle').textContent = 'Bienvenido';
    return;
  }

  // Lo último que se vio aparece al tiro; Google responde en unos segundos.
  estado.datos = normalizar(leerLS(LS_DATOS));
  irA('vMes');
  if (estado.datos) pintar();
  else $('mRecientes').innerHTML = '<div class="cargando">Leyendo la planilla…</div>';
  refrescar();

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
