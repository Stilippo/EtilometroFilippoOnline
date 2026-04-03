/* ═══════════════════════════════════════════════
   ETILOMETRO ONLINE — Motore di Calcolo
   Algoritmo Farmacocinetico Worst-Case
   Basato su dati BIA personali
   Con tracciamento orario per singola bevanda
   ═══════════════════════════════════════════════ */

// ── Costanti Farmacocinetiche (Hardcoded da BIA) ──
const BIA = Object.freeze({
    TBW:             45.4,    // Acqua Corporea Totale (Litri) — misurata BIA
    F_WATER:         0.825,   // Frazione idrica ematica maschile (L/L)
    VD:              55.03,   // Volume di Distribuzione (L) = TBW / F_WATER
    BETA_MIN:        0.10,    // Tasso eliminazione epatico minimo (g/L/h)
    F_BIO:           1.0,     // Biodisponibilità (stomaco vuoto, worst-case)
    BUFFER_HOURS:    1.5,     // Buffer di sicurezza (1.0h assorbimento + 0.5h coda)
    ETHANOL_DENSITY: 0.789,   // Densità etanolo a 20°C (g/mL)
});

// ── Bevande Predefinite ──
const PRESET_DRINKS = [
    { id: 'birra_piccola',     name: 'Birra Piccola',          icon: '🍺', volume: 330, abv: 5.0  },
    { id: 'birra_media',       name: 'Birra Media',            icon: '🍺', volume: 500, abv: 5.0  },
    { id: 'birra_doppio',      name: 'Birra Doppio Malto',     icon: '🍺', volume: 330, abv: 7.5  },
    { id: 'vino_rosso',        name: 'Vino Rosso',             icon: '🍷', volume: 150, abv: 13.5 },
    { id: 'vino_bianco',       name: 'Vino Bianco',            icon: '🍷', volume: 150, abv: 12.0 },
    { id: 'prosecco',          name: 'Prosecco',               icon: '🥂', volume: 150, abv: 11.0 },
    { id: 'spritz',            name: 'Spritz',                 icon: '🍹', volume: 200, abv: 8.0  },
    { id: 'cocktail',          name: 'Cocktail Alcolico',      icon: '🍸', volume: 200, abv: 12.0 },
    { id: 'shot_amaro',        name: 'Shot / Amaro',           icon: '🥃', volume: 40,  abv: 30.0 },
    { id: 'superalcolico',     name: 'Superalcolico',          icon: '🥃', volume: 40,  abv: 40.0 },
];

// ── Stato Applicazione ──
let consumedDrinks = [];
let drinkIdCounter = 0;

// ═══════════════════════════════════════════════
// FUNZIONI DI CALCOLO
// ═══════════════════════════════════════════════

/**
 * Calcola i grammi di etanolo puro contenuti in una bevanda.
 * Formula: A(g) = Volume(mL) × (ABV%/100) × 0.789
 */
function calcAlcoholGrams(volumeMl, abvPercent) {
    return volumeMl * (abvPercent / 100) * BIA.ETHANOL_DENSITY;
}

/**
 * Calcola la concentrazione ematico-alcolica di picco (C₀).
 * Formula: C₀(g/L) = A(g) / Vd(L)
 */
function calcPeakBAC(totalAlcoholGrams) {
    return totalAlcoholGrams / BIA.VD;
}

/**
 * Calcola il tempo di eliminazione base (senza buffer).
 * Formula: T(ore) = C₀ / β_min
 */
function calcEliminationTime(peakBAC) {
    return peakBAC / BIA.BETA_MIN;
}

/**
 * Calcola il tempo totale di attesa (con buffer di sicurezza).
 * Formula Master: T_totale = (A / Vd) / β_min + 1.5
 */
function calcTotalWaitTime(peakBAC) {
    return calcEliminationTime(peakBAC) + BIA.BUFFER_HOURS;
}

/**
 * Calcola l'ora esatta in cui è sicuro guidare.
 * @param {number} totalWaitHours - Ore totali di attesa
 * @param {Date} referenceTime - Orario dell'ultimo sorso (fine consumazione)
 */
function calcSafeDriveTime(totalWaitHours, referenceTime) {
    return new Date(referenceTime.getTime() + totalWaitHours * 3600000);
}

/**
 * Restituisce il valore corrente per un input datetime-local.
 */
function getCurrentDatetimeLocal() {
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    return now.toISOString().slice(0, 16);
}

/**
 * Calcola la durata in minuti tra due Date.
 */
function calcDurationMinutes(start, end) {
    return Math.max(0, (end.getTime() - start.getTime()) / 60000);
}

/**
 * Converte ore decimali in formato "Xh Ymin".
 */
function formatHoursMinutes(decimalHours) {
    const hours = Math.floor(decimalHours);
    const minutes = Math.round((decimalHours - hours) * 60);
    if (hours === 0) return `${minutes} min`;
    if (minutes === 0) return `${hours}h`;
    return `${hours}h ${minutes}min`;
}

/**
 * Formatta una data come "HH:MM".
 */
function formatTime(date) {
    return date.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Formatta una data come "Giorno della settimana, GG Mese AAAA".
 */
function formatDate(date) {
    return date.toLocaleDateString('it-IT', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric'
    });
}

/**
 * Formatta data+ora compatta per visualizzazione in lista bevande.
 */
function formatDateTime(date) {
    return date.toLocaleString('it-IT', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

// ═══════════════════════════════════════════════
// GESTIONE BEVANDE
// ═══════════════════════════════════════════════

function addDrink(name, icon, volumeMl, abvPercent) {
    const grams = calcAlcoholGrams(volumeMl, abvPercent);
    const now = getCurrentDatetimeLocal();
    consumedDrinks.push({
        uid: ++drinkIdCounter,
        name,
        icon,
        volume: volumeMl,
        abv: abvPercent,
        grams,
        startTime: now,  // orario inizio bevanda (default: adesso)
        endTime: now,    // orario fine bevanda (default: adesso)
    });
    renderConsumedList();
    updateCalculateButton();
}

function removeDrink(uid) {
    consumedDrinks = consumedDrinks.filter(d => d.uid !== uid);
    renderConsumedList();
    updateCalculateButton();
}

function clearAllDrinks() {
    consumedDrinks = [];
    renderConsumedList();
    updateCalculateButton();
}

function getTotalAlcoholGrams() {
    return consumedDrinks.reduce((sum, d) => sum + d.grams, 0);
}

/**
 * Legge gli orari aggiornati dagli input nel DOM e li sync nello stato.
 */
function syncDrinkTimesFromDOM() {
    consumedDrinks.forEach(d => {
        const startEl = document.getElementById(`drink-start-${d.uid}`);
        const endEl   = document.getElementById(`drink-end-${d.uid}`);
        if (startEl && startEl.value) d.startTime = startEl.value;
        if (endEl && endEl.value)     d.endTime   = endEl.value;
    });
}

/**
 * Restituisce l'orario globale di fine sessione (max di tutti gli endTime).
 */
function getGlobalEndTime() {
    return consumedDrinks.reduce((max, d) => {
        const t = new Date(d.endTime);
        return t > max ? t : max;
    }, new Date(consumedDrinks[0].endTime));
}

/**
 * Restituisce l'orario globale di inizio sessione (min di tutti gli startTime).
 */
function getGlobalStartTime() {
    return consumedDrinks.reduce((min, d) => {
        const t = new Date(d.startTime);
        return t < min ? t : min;
    }, new Date(consumedDrinks[0].startTime));
}

// ═══════════════════════════════════════════════
// RENDERING UI
// ═══════════════════════════════════════════════

/** Render preset drink cards in the grid */
function renderPresetDrinks() {
    const grid = document.getElementById('drinksGrid');
    grid.innerHTML = PRESET_DRINKS.map(d => {
        const grams = calcAlcoholGrams(d.volume, d.abv);
        return `
            <div class="drink-card" data-drink-id="${d.id}" tabindex="0" role="button"
                 aria-label="Aggiungi ${d.name}">
                <span class="drink-icon">${d.icon}</span>
                <div class="drink-name">${d.name}</div>
                <div class="drink-details">${d.volume} mL · ${d.abv}% vol</div>
                <span class="drink-grams">→ ${grams.toFixed(1)} g alcol</span>
            </div>
        `;
    }).join('');

    // Click handlers
    grid.querySelectorAll('.drink-card').forEach(card => {
        card.addEventListener('click', () => {
            const drinkId = card.dataset.drinkId;
            const preset = PRESET_DRINKS.find(d => d.id === drinkId);
            if (preset) {
                addDrink(preset.name, preset.icon, preset.volume, preset.abv);
                // Pulse animation
                card.classList.remove('added');
                void card.offsetWidth; // trigger reflow
                card.classList.add('added');
                // Scroll to list
                document.getElementById('consumedSection').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        });
        card.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                card.click();
            }
        });
    });
}

/** Render consumed drinks list with per-drink time inputs */
function renderConsumedList() {
    const list = document.getElementById('consumedList');
    const footer = document.getElementById('consumedFooter');

    if (consumedDrinks.length === 0) {
        list.innerHTML = '<p class="consumed-empty" id="consumedEmpty">Nessuna bevanda aggiunta. Seleziona dalla lista o inserisci una personalizzata.</p>';
        footer.style.display = 'none';
        return;
    }

    list.innerHTML = consumedDrinks.map(d => `
        <div class="consumed-item" data-uid="${d.uid}">
            <div class="consumed-item-header">
                <span class="consumed-item-icon">${d.icon}</span>
                <div class="consumed-item-info">
                    <div class="consumed-item-name">${d.name}</div>
                    <div class="consumed-item-detail">${d.volume} mL · ${d.abv}% vol · <span class="consumed-item-grams-inline">${d.grams.toFixed(1)} g alcol</span></div>
                </div>
                <button class="consumed-item-remove" data-uid="${d.uid}" aria-label="Rimuovi ${d.name}" title="Rimuovi">✕</button>
            </div>
            <div class="drink-time-row">
                <div class="drink-time-group">
                    <label class="drink-time-label" for="drink-start-${d.uid}">🟢 Inizio</label>
                    <div class="drink-time-input-wrap">
                        <input type="datetime-local" id="drink-start-${d.uid}" class="drink-time-input"
                               value="${d.startTime}" data-uid="${d.uid}" data-field="startTime">
                        <button class="drink-time-now-btn" data-uid="${d.uid}" data-field="startTime" title="Adesso">📍</button>
                    </div>
                </div>
                <div class="drink-time-separator">→</div>
                <div class="drink-time-group">
                    <label class="drink-time-label" for="drink-end-${d.uid}">🔴 Fine</label>
                    <div class="drink-time-input-wrap">
                        <input type="datetime-local" id="drink-end-${d.uid}" class="drink-time-input"
                               value="${d.endTime}" data-uid="${d.uid}" data-field="endTime">
                        <button class="drink-time-now-btn" data-uid="${d.uid}" data-field="endTime" title="Adesso">📍</button>
                    </div>
                </div>
            </div>
        </div>
    `).join('');

    // Remove handlers
    list.querySelectorAll('.consumed-item-remove').forEach(btn => {
        btn.addEventListener('click', () => {
            syncDrinkTimesFromDOM();
            removeDrink(parseInt(btn.dataset.uid));
        });
    });

    // Time input change handlers — sync to state
    list.querySelectorAll('.drink-time-input').forEach(input => {
        input.addEventListener('change', () => {
            const uid = parseInt(input.dataset.uid);
            const field = input.dataset.field;
            const drink = consumedDrinks.find(d => d.uid === uid);
            if (drink && input.value) drink[field] = input.value;
        });
    });

    // "Now" button handlers for each drink
    list.querySelectorAll('.drink-time-now-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const uid = parseInt(btn.dataset.uid);
            const field = btn.dataset.field;
            const now = getCurrentDatetimeLocal();
            const input = document.getElementById(
                field === 'startTime' ? `drink-start-${uid}` : `drink-end-${uid}`
            );
            if (input) {
                input.value = now;
                const drink = consumedDrinks.find(d => d.uid === uid);
                if (drink) drink[field] = now;
            }
            // Brief flash animation on button
            btn.classList.add('now-flash');
            setTimeout(() => btn.classList.remove('now-flash'), 400);
        });
    });

    // Footer
    footer.style.display = 'flex';
    document.getElementById('totalAlcohol').textContent = getTotalAlcoholGrams().toFixed(2) + ' g';
    document.getElementById('totalCount').textContent = consumedDrinks.length;
}

/** Update calculate button state */
function updateCalculateButton() {
    const btn = document.getElementById('calculateBtn');
    btn.disabled = consumedDrinks.length === 0;
}

// ═══════════════════════════════════════════════
// CALCOLO E VISUALIZZAZIONE RISULTATI
// ═══════════════════════════════════════════════

function performCalculation() {
    // Sync times from DOM before calculating
    syncDrinkTimesFromDOM();

    // Validate: every drink must have a valid endTime
    let missingEnd = false;
    for (const d of consumedDrinks) {
        if (!d.endTime) { missingEnd = true; break; }
    }
    if (missingEnd) {
        const firstBadInput = document.querySelector('.drink-time-input[data-field="endTime"]');
        if (firstBadInput) {
            firstBadInput.focus();
            firstBadInput.style.borderColor = '#ff4757';
            setTimeout(() => firstBadInput.style.borderColor = '', 2000);
        }
        return;
    }

    const endTime   = getGlobalEndTime();
    const startTime = getGlobalStartTime();
    const drinkingDurationMin = calcDurationMinutes(startTime, endTime);

    const totalA    = getTotalAlcoholGrams();
    const peakBAC   = calcPeakBAC(totalA);
    const elimTime  = calcEliminationTime(peakBAC);
    const totalWait = calcTotalWaitTime(peakBAC);
    const safeDriveTime = calcSafeDriveTime(totalWait, endTime);

    // Show results section
    const resultsSection = document.getElementById('results');
    resultsSection.style.display = 'block';

    // BAC
    document.getElementById('resultBac').textContent = peakBAC.toFixed(3);
    const riskBadge = document.getElementById('riskBadge');
    if (peakBAC > 1.5) {
        riskBadge.textContent = '⛔ REATO GRAVE — Revoca patente';
        riskBadge.className = 'risk-badge extreme';
    } else if (peakBAC > 0.8) {
        riskBadge.textContent = '🚨 REATO PENALE — Arresto possibile';
        riskBadge.className = 'risk-badge extreme';
    } else if (peakBAC > 0.5) {
        riskBadge.textContent = '⚠️ ILLEGALITÀ — Sospensione patente';
        riskBadge.className = 'risk-badge danger';
    } else {
        riskBadge.textContent = '🚫 ILLEGALE — Tolleranza Zero attiva';
        riskBadge.className = 'risk-badge danger';
    }

    // Time
    document.getElementById('resultTime').textContent = formatHoursMinutes(totalWait);

    // Drive time
    document.getElementById('resultDriveTime').textContent = formatTime(safeDriveTime);
    document.getElementById('resultDriveDate').textContent = formatDate(safeDriveTime);

    // Breakdown
    renderBreakdown(totalA, peakBAC, elimTime, totalWait, safeDriveTime, startTime, endTime, drinkingDurationMin);

    // Chart
    drawBACChart(peakBAC, totalWait);

    // Scroll to results
    resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/** Render calculation breakdown */
function renderBreakdown(totalA, peakBAC, elimTime, totalWait, safeDriveTime, startTime, endTime, drinkingDurationMin) {
    const container = document.getElementById('breakdownContent');

    // Per-drink breakdown
    const drinksRows = consumedDrinks.map(d => {
        const s = new Date(d.startTime);
        const e = new Date(d.endTime);
        const dur = calcDurationMinutes(s, e);
        const durStr = dur > 0
            ? (dur >= 60 ? `${Math.floor(dur/60)}h ${Math.round(dur%60)}min` : `${Math.round(dur)} min`)
            : '—';
        return `
            <tr>
                <td>${d.icon} ${d.name}</td>
                <td>${d.volume} mL · ${d.abv}%</td>
                <td><strong>${d.grams.toFixed(1)} g</strong></td>
                <td>${formatTime(s)}</td>
                <td>${formatTime(e)}</td>
                <td>${durStr}</td>
            </tr>
        `;
    }).join('');

    // Session duration
    const durH = Math.floor(drinkingDurationMin / 60);
    const durM = Math.round(drinkingDurationMin % 60);
    const durStr = durH > 0 ? `${durH}h ${durM}min` : `${durM} min`;

    container.innerHTML = `
        <!-- Session overview table -->
        <div class="breakdown-step">
            <div class="step-number">🍽️</div>
            <div class="step-content">
                <div class="step-label">Dettaglio Bevande Consumate</div>
                <div class="drink-breakdown-table-wrap">
                    <table class="drink-breakdown-table">
                        <thead>
                            <tr>
                                <th>Bevanda</th>
                                <th>Quantità</th>
                                <th>Alcol</th>
                                <th>Inizio</th>
                                <th>Fine</th>
                                <th>Durata</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${drinksRows}
                        </tbody>
                    </table>
                </div>
                <div class="step-result" style="margin-top: 0.5rem;">
                    Sessione: <strong>${formatTime(startTime)}</strong> → <strong>${formatTime(endTime)}</strong>
                    &nbsp;·&nbsp; Durata totale: <strong>${durStr}</strong>
                    &nbsp;·&nbsp; Calcolo smaltimento dall'ultimo sorso: <strong>${formatTime(endTime)}</strong>
                </div>
            </div>
        </div>

        <div class="breakdown-step">
            <div class="step-number">1</div>
            <div class="step-content">
                <div class="step-label">Massa di etanolo puro ingerito</div>
                <div class="step-formula">A = Σ (Volume × ABV% / 100 × 0.789)</div>
                <div class="step-result">A = <strong>${totalA.toFixed(2)} g</strong></div>
            </div>
        </div>

        <div class="breakdown-step">
            <div class="step-number">2</div>
            <div class="step-content">
                <div class="step-label">Concentrazione ematica di picco (stomaco vuoto, f = 1.0)</div>
                <div class="step-formula">C₀ = A / V<sub>d</sub> = ${totalA.toFixed(2)} / ${BIA.VD}</div>
                <div class="step-result">C₀ = <strong>${peakBAC.toFixed(3)} g/L</strong></div>
            </div>
        </div>

        <div class="breakdown-step">
            <div class="step-number">3</div>
            <div class="step-content">
                <div class="step-label">Tempo di eliminazione epatica (cinetica ordine zero)</div>
                <div class="step-formula">T<sub>elim</sub> = C₀ / β<sub>min</sub> = ${peakBAC.toFixed(3)} / ${BIA.BETA_MIN}</div>
                <div class="step-result">T<sub>elim</sub> = <strong>${formatHoursMinutes(elimTime)}</strong> (${elimTime.toFixed(2)} ore)</div>
            </div>
        </div>

        <div class="breakdown-step">
            <div class="step-number">4</div>
            <div class="step-content">
                <div class="step-label">Buffer di sicurezza (+1.0h assorbimento, +0.5h coda cinetica)</div>
                <div class="step-formula">Buffer = +${BIA.BUFFER_HOURS} ore</div>
                <div class="step-result">Buffer = <strong>${formatHoursMinutes(BIA.BUFFER_HOURS)}</strong></div>
            </div>
        </div>

        <div class="breakdown-step">
            <div class="step-number">✓</div>
            <div class="step-content">
                <div class="step-label">Tempo totale di attesa dall'ultimo sorso (${formatTime(endTime)})</div>
                <div class="step-formula">T<sub>totale</sub> = T<sub>elim</sub> + Buffer = ${elimTime.toFixed(2)} + ${BIA.BUFFER_HOURS}</div>
                <div class="step-result highlight">T<sub>totale</sub> = <strong>${formatHoursMinutes(totalWait)}</strong> — Guida sicura dalle <strong>${formatTime(safeDriveTime)}</strong></div>
            </div>
        </div>
    `;
}

// ═══════════════════════════════════════════════
// GRAFICO BAC (Canvas 2D)
// ═══════════════════════════════════════════════

function drawBACChart(peakBAC, totalWaitHours) {
    const canvas = document.getElementById('bacChart');
    const wrapper = canvas.parentElement;
    const dpr = window.devicePixelRatio || 1;

    // Size canvas to container
    const rect = wrapper.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const W = rect.width;
    const H = rect.height;

    // Padding
    const pad = { top: 30, right: 25, bottom: 45, left: 60 };
    const plotW = W - pad.left - pad.right;
    const plotH = H - pad.top - pad.bottom;

    // Ranges
    const elimTime = peakBAC / BIA.BETA_MIN;
    const maxTime = Math.max(totalWaitHours + 1, 3);
    const maxBAC = Math.max(peakBAC * 1.15, 0.6);

    // Scale functions
    const scaleX = (t) => pad.left + (t / maxTime) * plotW;
    const scaleY = (bac) => pad.top + (1 - bac / maxBAC) * plotH;

    // ── Clear ──
    ctx.clearRect(0, 0, W, H);

    // ── Grid Lines ──
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;

    // Horizontal grid
    const bacStep = maxBAC > 1.0 ? 0.2 : 0.1;
    for (let bac = bacStep; bac <= maxBAC; bac += bacStep) {
        const y = scaleY(bac);
        ctx.beginPath();
        ctx.moveTo(pad.left, y);
        ctx.lineTo(W - pad.right, y);
        ctx.stroke();
    }

    // Vertical grid (every hour)
    for (let t = 1; t <= maxTime; t++) {
        const x = scaleX(t);
        ctx.beginPath();
        ctx.moveTo(x, pad.top);
        ctx.lineTo(x, H - pad.bottom);
        ctx.stroke();
    }

    // ── Buffer Zone (shaded) ──
    if (elimTime < totalWaitHours) {
        const x1 = scaleX(elimTime);
        const x2 = scaleX(totalWaitHours);
        const grad = ctx.createLinearGradient(x1, 0, x2, 0);
        grad.addColorStop(0, 'rgba(0, 214, 143, 0.06)');
        grad.addColorStop(1, 'rgba(0, 214, 143, 0.02)');
        ctx.fillStyle = grad;
        ctx.fillRect(x1, pad.top, x2 - x1, plotH);
    }

    // ── 0.5 g/L Reference Line ──
    if (0.5 < maxBAC) {
        const y05 = scaleY(0.5);
        ctx.strokeStyle = 'rgba(255, 170, 0, 0.35)';
        ctx.lineWidth = 1;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(pad.left, y05);
        ctx.lineTo(W - pad.right, y05);
        ctx.stroke();
        ctx.setLineDash([]);

        // Label
        ctx.fillStyle = 'rgba(255, 170, 0, 0.6)';
        ctx.font = '600 10px Inter, sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText('Limite 0.5 g/L', W - pad.right - 5, y05 - 5);
    }

    // ── BAC Decline Line ──
    const lineGrad = ctx.createLinearGradient(scaleX(0), scaleY(peakBAC), scaleX(elimTime), scaleY(0));
    lineGrad.addColorStop(0, '#ff4757');
    lineGrad.addColorStop(0.5, '#ffaa00');
    lineGrad.addColorStop(1, '#00d68f');

    ctx.strokeStyle = lineGrad;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.beginPath();
    const steps = 200;
    for (let i = 0; i <= steps; i++) {
        const t = (i / steps) * elimTime;
        const bac = Math.max(peakBAC - BIA.BETA_MIN * t, 0);
        const x = scaleX(t);
        const y = scaleY(bac);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // ── Fill Area Under Curve ──
    const areaGrad = ctx.createLinearGradient(0, scaleY(peakBAC), 0, scaleY(0));
    areaGrad.addColorStop(0, 'rgba(255, 71, 87, 0.12)');
    areaGrad.addColorStop(0.5, 'rgba(255, 170, 0, 0.06)');
    areaGrad.addColorStop(1, 'rgba(0, 214, 143, 0.02)');

    ctx.fillStyle = areaGrad;
    ctx.beginPath();
    ctx.moveTo(scaleX(0), scaleY(0));
    for (let i = 0; i <= steps; i++) {
        const t = (i / steps) * elimTime;
        const bac = Math.max(peakBAC - BIA.BETA_MIN * t, 0);
        ctx.lineTo(scaleX(t), scaleY(bac));
    }
    ctx.lineTo(scaleX(elimTime), scaleY(0));
    ctx.closePath();
    ctx.fill();

    // ── Peak Marker ──
    ctx.fillStyle = '#ff4757';
    ctx.beginPath();
    ctx.arc(scaleX(0), scaleY(peakBAC), 5, 0, Math.PI * 2);
    ctx.fill();

    // Peak label
    ctx.fillStyle = '#ff4757';
    ctx.font = '700 11px Outfit, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`C₀ = ${peakBAC.toFixed(3)} g/L`, scaleX(0) + 10, scaleY(peakBAC) - 8);

    // ── Safe-to-Drive Marker ──
    const safeX = scaleX(totalWaitHours);
    ctx.strokeStyle = 'rgba(0, 214, 143, 0.6)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 3]);
    ctx.beginPath();
    ctx.moveTo(safeX, pad.top);
    ctx.lineTo(safeX, H - pad.bottom);
    ctx.stroke();
    ctx.setLineDash([]);

    // Safe marker dot
    ctx.fillStyle = '#00d68f';
    ctx.beginPath();
    ctx.arc(safeX, scaleY(0), 6, 0, Math.PI * 2);
    ctx.fill();

    // Safe label
    ctx.font = '700 10px Inter, sans-serif';
    ctx.fillStyle = '#00d68f';
    ctx.textAlign = 'center';
    ctx.fillText('✓ GUIDA SICURA', safeX, pad.top - 10);

    // ── Zero crossing marker ──
    const zeroX = scaleX(elimTime);
    ctx.fillStyle = '#ffaa00';
    ctx.beginPath();
    ctx.arc(zeroX, scaleY(0), 4, 0, Math.PI * 2);
    ctx.fill();

    // ── Axes Labels ──
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '500 10px Inter, sans-serif';

    // Y-axis labels
    ctx.textAlign = 'right';
    for (let bac = 0; bac <= maxBAC; bac += bacStep) {
        const y = scaleY(bac);
        ctx.fillText(bac.toFixed(1), pad.left - 8, y + 3);
    }

    // X-axis labels
    ctx.textAlign = 'center';
    for (let t = 0; t <= maxTime; t++) {
        ctx.fillText(`${t}h`, scaleX(t), H - pad.bottom + 18);
    }

    // Axis titles
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.font = '500 10px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Tempo (ore)', pad.left + plotW / 2, H - 5);

    ctx.save();
    ctx.translate(14, pad.top + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('BAC (g/L)', 0, 0);
    ctx.restore();

    // ── Axes Lines ──
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    // Y axis
    ctx.moveTo(pad.left, pad.top);
    ctx.lineTo(pad.left, H - pad.bottom);
    // X axis
    ctx.lineTo(W - pad.right, H - pad.bottom);
    ctx.stroke();

    // ── Buffer label ──
    if (elimTime < totalWaitHours) {
        const bufferCenterX = (scaleX(elimTime) + safeX) / 2;
        ctx.fillStyle = 'rgba(0, 214, 143, 0.5)';
        ctx.font = '500 9px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Buffer +1.5h', bufferCenterX, scaleY(0) - 12);
    }
}

// ═══════════════════════════════════════════════
// EVENT LISTENERS
// ═══════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
    // Render preset drinks
    renderPresetDrinks();

    // Custom drink form
    const addCustomBtn = document.getElementById('addCustomBtn');
    addCustomBtn.addEventListener('click', () => {
        const volumeInput = document.getElementById('customVolume');
        const abvInput = document.getElementById('customAbv');
        const nameInput = document.getElementById('customName');

        const volume = parseFloat(volumeInput.value);
        const abv = parseFloat(abvInput.value);
        const name = nameInput.value.trim() || 'Personalizzata';

        if (!volume || volume <= 0) {
            volumeInput.focus();
            volumeInput.style.borderColor = '#ff4757';
            setTimeout(() => volumeInput.style.borderColor = '', 1500);
            return;
        }

        if (!abv || abv <= 0 || abv > 100) {
            abvInput.focus();
            abvInput.style.borderColor = '#ff4757';
            setTimeout(() => abvInput.style.borderColor = '', 1500);
            return;
        }

        addDrink(name, '🍶', volume, abv);

        // Clear inputs
        volumeInput.value = '';
        abvInput.value = '';
        nameInput.value = '';
    });

    // Allow Enter key in custom inputs
    ['customVolume', 'customAbv', 'customName'].forEach(id => {
        document.getElementById(id).addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                addCustomBtn.click();
            }
        });
    });

    // Clear all button
    document.getElementById('clearAllBtn').addEventListener('click', clearAllDrinks);

    // Calculate button
    document.getElementById('calculateBtn').addEventListener('click', performCalculation);

    // Resize chart on window resize
    let resizeTimeout;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            const resultsSection = document.getElementById('results');
            if (resultsSection.style.display !== 'none') {
                const totalA = getTotalAlcoholGrams();
                const peakBAC = calcPeakBAC(totalA);
                const totalWait = calcTotalWaitTime(peakBAC);
                drawBACChart(peakBAC, totalWait);
            }
        }, 250);
    });
});
