/* ═══════════════════════════════════════════════
   ETILOMETRO ONLINE — Motore di Calcolo v3
   Algoritmo Farmacocinetico Personalizzato
   Formula di Watson · Fattore Cibo · Idratazione
   Farmaci · Integratori · Aminoacidi
   ═══════════════════════════════════════════════ */

// ── Costanti Farmacocinetiche ──
const PHARMA = Object.freeze({
    F_WATER:         0.825,   // Frazione idrica ematica maschile (L/L)
    F_WATER_F:       0.780,   // Frazione idrica ematica femminile (L/L)
    BETA_MIN:        0.10,    // Tasso eliminazione epatico minimo (g/L/h) — worst-case
    ETHANOL_DENSITY: 0.789,   // Densità etanolo a 20°C (g/mL)
    BUFFER_HOURS:    1.0,     // Buffer di sicurezza (30 min assorbimento coda + 30 min incertezza)
    // Fattori di assorbimento per contenuto gastrico (f_bio)
    FOOD_EMPTY:      1.00,    // Stomaco vuoto: assorbimento completo (worst-case)
    FOOD_LIGHT:      0.85,    // Pasto leggero: ~15% riduzione picco, rallenta assorbimento
    FOOD_FULL:       0.70,    // Pasto abbondante: ~30% riduzione picco, molto ritardato
    // Ritardo picco (ore) in base al cibo + integratori
    PEAK_DELAY_EMPTY: 0.50,   // Picco in ~30min a stomaco vuoto
    PEAK_DELAY_LIGHT: 1.00,   // Picco in ~60min con pasto leggero
    PEAK_DELAY_FULL:  1.50,   // Picco in ~90min con pasto abbondante
    // Disidratazione da allenamento: riduzione TBW stimata (%)
    WORKOUT_DEHYDR:  0.030,   // ~3% di perdita idrica stima post-allenamento
    // Extra ritardo da aminoacidi pre-allenamento (substrato gastrico, effetto minore)
    AMINO_PEAK_DELAY_BONUS: 0.25, // +15 min al ritardo di picco se aminoacidi assunti pre-allenamento
    AMINO_F_BONUS:           0.03, // Lieve riduzione ulteriore del picco (~3%) — substrato gastrico
    // Idratazione da acqua integratore durante allenamento
    // Hydrafit 800ml: ~0.80 L di acqua effettivamente assorbita (ipotonica, assorbimento quasi completo)
    HYDRAFIT_WATER_FACTOR: 0.92, // 92% dell'acqua ingerita è assorbita come TBW funzionale post-workout
});

// ── Database Interazioni Farmaci con l'Alcol ──
// Basato su evidenze scientifiche: non alterano direttamente il BAC ma
// aumentano i rischi clinici e richiedono avvertimenti informativi.
const DRUG_INTERACTIONS = {
    eutirox: {
        name: 'Eutirox (Levotiroxina)',
        timing: 'Mattina a stomaco vuoto',
        effect_on_bac: 'nessuno',  // presa la mattina, metabolismo tiroideo ≠ metabolismo etanolo
        bac_modifier: 0,
        risk_level: 'info',
        warning: 'Eutirox va assunto lontano dall\'alcol (≥4h). Serotipo assunto la mattina: nessun effetto sul BAC serale. L\'alcol può ridurre l\'assorbimento dell\'ormone tiroideo se assunto nello stesso momento.'
    },
    montegen: {
        name: 'Montegen (Montelukast)',
        timing: 'Sera prima di dormire',
        effect_on_bac: 'nessuno_diretto',
        bac_modifier: 0,
        risk_level: 'caution',
        warning: '⚠️ Montelukast (Montegen) amplifica gli effetti sedativi dell\'alcol e può aggravare gli effetti neuropsichiatrici (ansia, disturbi del sonno). L\'alcol è inoltre un potenziale trigger per l\'asma — usa con cautela.'
    },
    foster: {
        name: 'Foster (Beclometasone + Formoterolo)',
        timing: 'Prima dell\'allenamento',
        effect_on_bac: 'nessuno_diretto',
        bac_modifier: 0,
        risk_level: 'caution',
        warning: '⚠️ Foster (Formoterolo) + alcol: l\'alcol riduce la tolleranza cardiaca ai beta2-agonisti. Possibile aumento della frequenza cardiaca, palpitazioni e rischio di aritmia. Evita l\'alcol nelle ore successive all\'uso dell\'inalatore.'
    },
};

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

/**
 * Calcola l'età esatta di Filippo in base alla data di nascita.
 */
function calcFilippoAge() {
    const birthDate = new Date(2004, 3, 15); // 15 Aprile 2004
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const m = today.getMonth() - birthDate.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
        age--;
    }
    return age;
}

// Profilo utente con defaults (Filippo da BIA)
let userProfile = {
    sex:      'M',
    age:      calcFilippoAge(),
    weight:   72.0,
    height:   175.0,
    food:     'empty',   // 'empty' | 'light' | 'full'
    foodStartTime: '',   // Inizio pasto
    foodEndTime: '',     // Fine pasto
    workout:  false,
    workoutStartTime: '',// Inizio allenamento
    workoutEndTime: '',  // Fine allenamento
    // Integratori durante allenamento
    hydrationWater: 800,     // ml di acqua/sali assunti durante workout (default: 800ml Hydrafit)
    hydrationGrams: 30,      // g di polvere Hydrafit
    aminoPreWorkout: true,   // NutriXAm aminoacidi pre-allenamento (default: true per Filippo)
    // Farmaci attivi (profilo Filippo — hardcoded per personalizzazione)
    drugs: {
        eutirox:  true,
        montegen: true,
        foster:   true,
    },
};

// ═══════════════════════════════════════════════
// FORMULA DI WATSON — TBW Personalizzata
// ═══════════════════════════════════════════════

/**
 * Calcola la TBW (Total Body Water) in litri con la Formula di Watson.
 * Uomo:   TBW = 2.447 - 0.09156×età + 0.1074×altezza + 0.3362×peso
 * Donna:  TBW = -2.097 + 0.1069×altezza + 0.2466×peso
 */
function calcWatsonTBW(sex, age, weightKg, heightCm) {
    if (sex === 'M') {
        return 2.447 - 0.09156 * age + 0.1074 * heightCm + 0.3362 * weightKg;
    } else {
        return -2.097 + 0.1069 * heightCm + 0.2466 * weightKg;
    }
}

/**
 * Calcola il Volume di Distribuzione (Vd) in litri.
 * Vd = TBW / F_water
 */
function calcVd(tbw, sex) {
    const fWater = sex === 'M' ? PHARMA.F_WATER : PHARMA.F_WATER_F;
    return tbw / fWater;
}

/**
 * Calcola i parametri farmacocinetici dal profilo utente.
 * Restituisce { tbw, vd, fBio, peakDelayHours, workoutNote }
 */
function calcPharmaParams() {
    let tbw = calcWatsonTBW(userProfile.sex, userProfile.age, userProfile.weight, userProfile.height);
    const notes = [];

    if (userProfile.workout) {
        // 1. Disidratazione da allenamento (perdita netta stimata)
        const dehydrLoss = tbw * PHARMA.WORKOUT_DEHYDR;
        tbw -= dehydrLoss;
        notes.push(`−${dehydrLoss.toFixed(2)} L disidratazione allenamento`);

        // 2. Reintegro idrico: Hydrafit + acqua durante workout
        // L'acqua assorbita durante l'allenamento espande il volume di distribuzione
        // riducendo la concentrazione ematica dell'alcol post-workout.
        const hydWaterMl = parseFloat(userProfile.hydrationWater) || 0;
        if (hydWaterMl > 0) {
            // Solo la quota di acqua che diventa TBW funzionale (92% per soluzione ipotonica)
            const hydGain  = (hydWaterMl / 1000) * PHARMA.HYDRAFIT_WATER_FACTOR;
            tbw += hydGain;
            notes.push(`+${hydGain.toFixed(2)} L reintegro idrico (${hydWaterMl} mL × ${(PHARMA.HYDRAFIT_WATER_FACTOR*100).toFixed(0)}%)`);
        }
    }

    const vd = calcVd(tbw, userProfile.sex);

    // Fattore di assorbimento gastrico (f_bio)
    let fBio         = { empty: PHARMA.FOOD_EMPTY, light: PHARMA.FOOD_LIGHT, full: PHARMA.FOOD_FULL }[userProfile.food];
    let peakDelayHours = { empty: PHARMA.PEAK_DELAY_EMPTY, light: PHARMA.PEAK_DELAY_LIGHT, full: PHARMA.PEAK_DELAY_FULL }[userProfile.food];

    // 3. Aminoacidi pre-allenamento (NutriXAm 7.2g)
    // Gli aminoacidi creano un substrato gastrico che rallenta leggermente lo svuotamento
    // e riduce in minima parte il picco. Effetto modesto ma reale.
    if (userProfile.workout && userProfile.aminoPreWorkout) {
        peakDelayHours += PHARMA.AMINO_PEAK_DELAY_BONUS;
        fBio = Math.max(fBio - PHARMA.AMINO_F_BONUS, 0.67); // max riduzione del 3%, non oltre 0.67
        notes.push(`+${(PHARMA.AMINO_PEAK_DELAY_BONUS * 60).toFixed(0)} min ritardo picco (aminoacidi pre-workout)`);
    }

    const workoutNote = notes.join(' · ');
    return { tbw, vd, fBio, peakDelayHours, workoutNote };
}

// ═══════════════════════════════════════════════
// FUNZIONI DI CALCOLO
// ═══════════════════════════════════════════════

/**
 * Calcola i grammi di etanolo puro contenuti in una bevanda.
 */
function calcAlcoholGrams(volumeMl, abvPercent) {
    return volumeMl * (abvPercent / 100) * PHARMA.ETHANOL_DENSITY;
}

/**
 * Calcola la concentrazione ematica di picco (C₀) con fattore cibo.
 * C₀(g/L) = (A × f_bio) / Vd
 */
function calcPeakBAC(totalAlcoholGrams, vd, fBio) {
    return (totalAlcoholGrams * fBio) / vd;
}

/**
 * Calcola il tempo di eliminazione base (cinetica ordine zero).
 * T_elim = C₀ / β_min
 */
function calcEliminationTime(peakBAC) {
    return peakBAC / PHARMA.BETA_MIN;
}

/**
 * Calcola il tempo totale di attesa (dal momento dell'ultimo sorso).
 * T_totale = peakDelay + T_elim + buffer
 */
function calcTotalWaitTime(peakDelayHours, elimTime) {
    return peakDelayHours + elimTime + PHARMA.BUFFER_HOURS;
}

/**
 * Calcola l'ora esatta in cui è sicuro guidare.
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
        year: 'numeric',
    });
}

/**
 * Formatta data+ora compatta per la lista bevande.
 */
function formatDateTime(date) {
    return date.toLocaleString('it-IT', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    });
}

// ═══════════════════════════════════════════════
// PROFILO UTENTE — Salvataggio e Caricamento
// ═══════════════════════════════════════════════

function saveProfile() {
    try {
        localStorage.setItem('etilometro_profile', JSON.stringify(userProfile));
    } catch (e) { /* private browsing */ }
}

function loadProfile() {
    try {
        const saved = localStorage.getItem('etilometro_profile');
        if (saved) {
            const parsed = JSON.parse(saved);
            userProfile = { ...userProfile, ...parsed };
        }
    } catch (e) { /* ignore */ }
}

function syncProfileFromDOM() {
    const weight  = document.getElementById('profileWeight');
    const height  = document.getElementById('profileHeight');
    const food    = document.querySelector('.food-btn.active');
    const foodStartTime = document.getElementById('foodStartTime');
    const foodEndTime   = document.getElementById('foodEndTime');
    const workout = document.getElementById('workoutToggle');
    const workoutStartTime = document.getElementById('workoutStartTime');
    const workoutEndTime   = document.getElementById('workoutEndTime');
    const hydrationWater   = document.getElementById('hydrationWater');
    const hydrationGrams   = document.getElementById('hydrationGrams');
    const aminoPreWorkout  = document.getElementById('aminoToggle');

    // Manteniamo dati fissi
    userProfile.sex = 'M';
    userProfile.age = calcFilippoAge();

    if (weight && weight.value) userProfile.weight = parseFloat(weight.value);
    if (height && height.value) userProfile.height = parseFloat(height.value);
    if (food)   userProfile.food   = food.dataset.food;
    if (foodStartTime) userProfile.foodStartTime = foodStartTime.value;
    if (foodEndTime)   userProfile.foodEndTime   = foodEndTime.value;
    
    if (workout) userProfile.workout = workout.checked;
    if (workoutStartTime) userProfile.workoutStartTime = workoutStartTime.value;
    if (workoutEndTime)   userProfile.workoutEndTime   = workoutEndTime.value;
    
    if (hydrationWater && hydrationWater.value !== '') userProfile.hydrationWater = parseFloat(hydrationWater.value);
    if (hydrationGrams && hydrationGrams.value !== '') userProfile.hydrationGrams = parseFloat(hydrationGrams.value);
    if (aminoPreWorkout) userProfile.aminoPreWorkout = aminoPreWorkout.checked;

    saveProfile();
    updateProfileDisplay();
}

function updateProfileDisplay() {
    const params = calcPharmaParams();
    const tbwEl = document.getElementById('displayTBW');
    const vdEl  = document.getElementById('displayVD');
    const fEl   = document.getElementById('displayFbio');
    if (tbwEl) tbwEl.textContent = params.tbw.toFixed(2) + ' L';
    if (vdEl)  vdEl.textContent  = params.vd.toFixed(2)  + ' L';
    const fLabels = {
        empty: `${params.fBio.toFixed(2)} (Stomaco vuoto)`,
        light: `${params.fBio.toFixed(2)} (Pasto leggero)`,
        full:  `${params.fBio.toFixed(2)} (Pasto abbondante)`,
    };
    if (fEl) fEl.textContent = fLabels[userProfile.food] || '—';
}

function populateDOMFromProfile() {
    const weight = document.getElementById('profileWeight');
    const height = document.getElementById('profileHeight');
    if (weight) weight.value = userProfile.weight;
    if (height) height.value = userProfile.height;

    // Computed Age Display (only for UI update)
    const ageDisplay = document.getElementById('computedAgeDisplay');
    if (ageDisplay) ageDisplay.textContent = `15/04/2004 (${calcFilippoAge()} anni)`;

    // Food buttons & time
    document.querySelectorAll('.food-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.food === userProfile.food);
    });
    const fStart = document.getElementById('foodStartTime');
    if (fStart && userProfile.foodStartTime) fStart.value = userProfile.foodStartTime;
    const fEnd = document.getElementById('foodEndTime');
    if (fEnd && userProfile.foodEndTime) fEnd.value = userProfile.foodEndTime;

    // Workout toggle & time
    const workoutToggle = document.getElementById('workoutToggle');
    if (workoutToggle) workoutToggle.checked = userProfile.workout;
    const wStart = document.getElementById('workoutStartTime');
    if (wStart && userProfile.workoutStartTime) wStart.value = userProfile.workoutStartTime;
    const wEnd = document.getElementById('workoutEndTime');
    if (wEnd && userProfile.workoutEndTime) wEnd.value = userProfile.workoutEndTime;

    // Hydration water & grams
    const hydWaterEl = document.getElementById('hydrationWater');
    if (hydWaterEl) hydWaterEl.value = userProfile.hydrationWater;
    const hydGramsEl = document.getElementById('hydrationGrams');
    if (hydGramsEl) hydGramsEl.value = userProfile.hydrationGrams;

    // Amino toggle
    const aminoEl = document.getElementById('aminoToggle');
    if (aminoEl) aminoEl.checked = userProfile.aminoPreWorkout;

    updateWorkoutUI();
    updateProfileDisplay();
}

function updateWorkoutUI() {
    const wt    = document.getElementById('workoutToggle');
    const badge = document.getElementById('workoutBadge');
    const workoutExtras = document.getElementById('workoutExtras');
    if (!wt || !badge) return;
    if (wt.checked) {
        badge.innerHTML = '⚡ Post-Allenamento attivo — effetti idratazione e aminoacidi calcolati';
        badge.className = 'workout-badge active';
        if (workoutExtras) workoutExtras.style.display = 'grid';
    } else {
        badge.textContent = 'Idratazione normale — effetti allenamento non considerati';
        badge.className = 'workout-badge inactive';
        if (workoutExtras) workoutExtras.style.display = 'none';
    }
    updateProfileDisplay();
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
        startTime: now,
        endTime: now,
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

function syncDrinkTimesFromDOM() {
    consumedDrinks.forEach(d => {
        const startEl = document.getElementById(`drink-start-${d.uid}`);
        const endEl   = document.getElementById(`drink-end-${d.uid}`);
        if (startEl && startEl.value) d.startTime = startEl.value;
        if (endEl && endEl.value)     d.endTime   = endEl.value;
    });
}

function getGlobalEndTime() {
    return consumedDrinks.reduce((max, d) => {
        const t = new Date(d.endTime);
        return t > max ? t : max;
    }, new Date(consumedDrinks[0].endTime));
}

function getGlobalStartTime() {
    return consumedDrinks.reduce((min, d) => {
        const t = new Date(d.startTime);
        return t < min ? t : min;
    }, new Date(consumedDrinks[0].startTime));
}

// ═══════════════════════════════════════════════
// RENDERING UI
// ═══════════════════════════════════════════════

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

    grid.querySelectorAll('.drink-card').forEach(card => {
        card.addEventListener('click', () => {
            const preset = PRESET_DRINKS.find(d => d.id === card.dataset.drinkId);
            if (preset) {
                addDrink(preset.name, preset.icon, preset.volume, preset.abv);
                card.classList.remove('added');
                void card.offsetWidth;
                card.classList.add('added');
                document.getElementById('consumedSection').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        });
        card.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); card.click(); }
        });
    });
}

function renderConsumedList() {
    const list   = document.getElementById('consumedList');
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

    list.querySelectorAll('.consumed-item-remove').forEach(btn => {
        btn.addEventListener('click', () => {
            syncDrinkTimesFromDOM();
            removeDrink(parseInt(btn.dataset.uid));
        });
    });

    list.querySelectorAll('.drink-time-input').forEach(input => {
        input.addEventListener('change', () => {
            const uid   = parseInt(input.dataset.uid);
            const field = input.dataset.field;
            const drink = consumedDrinks.find(d => d.uid === uid);
            if (drink && input.value) drink[field] = input.value;
        });
    });

    list.querySelectorAll('.drink-time-now-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const uid   = parseInt(btn.dataset.uid);
            const field = btn.dataset.field;
            const now   = getCurrentDatetimeLocal();
            const input = document.getElementById(field === 'startTime' ? `drink-start-${uid}` : `drink-end-${uid}`);
            if (input) {
                input.value = now;
                const drink = consumedDrinks.find(d => d.uid === uid);
                if (drink) drink[field] = now;
            }
            btn.classList.add('now-flash');
            setTimeout(() => btn.classList.remove('now-flash'), 400);
        });
    });

    footer.style.display = 'flex';
    document.getElementById('totalAlcohol').textContent = getTotalAlcoholGrams().toFixed(2) + ' g';
    document.getElementById('totalCount').textContent   = consumedDrinks.length;
}

function updateCalculateButton() {
    document.getElementById('calculateBtn').disabled = consumedDrinks.length === 0;
}

// ═══════════════════════════════════════════════
// CALCOLO E VISUALIZZAZIONE RISULTATI
// ═══════════════════════════════════════════════

function performCalculation() {
    syncDrinkTimesFromDOM();
    syncProfileFromDOM();

    // Validate: ogni bevanda deve avere endTime
    let missingEnd = consumedDrinks.some(d => !d.endTime);
    if (missingEnd) {
        const firstBadInput = document.querySelector('.drink-time-input[data-field="endTime"]');
        if (firstBadInput) {
            firstBadInput.focus();
            firstBadInput.style.borderColor = '#ff4757';
            setTimeout(() => firstBadInput.style.borderColor = '', 2000);
        }
        return;
    }

    // Recupera parametri farmacocinetici personalizzati
    const params = calcPharmaParams();
    const { tbw, vd, fBio, peakDelayHours, workoutNote } = params;

    const endTime   = getGlobalEndTime();
    const startTime = getGlobalStartTime();
    const drinkingDurationMin = calcDurationMinutes(startTime, endTime);

    const totalA    = getTotalAlcoholGrams();
    const peakBAC   = calcPeakBAC(totalA, vd, fBio);
    const elimTime  = calcEliminationTime(peakBAC);
    const totalWait = calcTotalWaitTime(peakDelayHours, elimTime);
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
    document.getElementById('resultDriveDate').textContent  = formatDate(safeDriveTime);

    // Drug Warnings
    renderDrugWarnings();
    // Breakdown
    renderBreakdown(totalA, peakBAC, elimTime, totalWait, safeDriveTime,
                    startTime, endTime, drinkingDurationMin,
                    tbw, vd, fBio, peakDelayHours, workoutNote);

    // Chart
    drawBACChart(peakBAC, peakDelayHours, elimTime, totalWait);

    // Scroll to results
    resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/**
 * Renderizza i box di interazione farmaci nella sezione risultati.
 */
function renderDrugWarnings() {
    const container = document.getElementById('drugWarningsContainer');
    if (!container) return;

    const activeDrugs = Object.entries(userProfile.drugs || {})
        .filter(([, active]) => active)
        .map(([key]) => DRUG_INTERACTIONS[key])
        .filter(Boolean);

    if (activeDrugs.length === 0) {
        container.innerHTML = '';
        container.style.display = 'none';
        return;
    }

    container.style.display = 'block';
    container.innerHTML = `
        <div class="drug-warnings-title">💊 Interazioni con i Tuoi Farmaci</div>
        ${activeDrugs.map(drug => `
            <div class="drug-warning-item ${drug.risk_level}">
                <div class="drug-warning-header">
                    <span class="drug-name">${drug.name}</span>
                    <span class="drug-timing">${drug.timing}</span>
                </div>
                <div class="drug-warning-text">${drug.warning}</div>
            </div>
        `).join('')}
        <div class="drug-disclaimer">ℹ️ Nessuno di questi farmaci altera direttamente il BAC calcolato. Le avvertenze riguardano rischi clinici aggiuntivi. Consulta sempre il tuo medico.</div>
    `;
}

// ── Render Breakdown ──
function renderBreakdown(totalA, peakBAC, elimTime, totalWait, safeDriveTime,
                         startTime, endTime, drinkingDurationMin,
                         tbw, vd, fBio, peakDelayHours, workoutNote) {
    const container = document.getElementById('breakdownContent');

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

    const durH = Math.floor(drinkingDurationMin / 60);
    const durM = Math.round(drinkingDurationMin % 60);
    const durStr = durH > 0 ? `${durH}h ${durM}min` : `${durM} min`;

    const foodLabels = { empty: '🍽️ Stomaco Vuoto (f=1.00)', light: '🥗 Pasto Leggero (f=0.85)', full: '🍖 Pasto Abbondante (f=0.70)' };
    const foodLabel = foodLabels[userProfile.food] || '—';

    container.innerHTML = `
        <!-- Profilo usato nel calcolo -->
        <div class="breakdown-step">
            <div class="step-number">👤</div>
            <div class="step-content">
                <div class="step-label">Profilo Utilizzato nel Calcolo</div>
                <div class="step-result">
                    ${userProfile.sex === 'M' ? '♂ Maschio' : '♀ Femmina'} ·
                    ${userProfile.age} anni · ${userProfile.weight} kg · ${userProfile.height} cm
                    ${userProfile.workout ? ' · <span style="color:var(--warning)">⚡ Post-Allenamento</span>' : ''}
                    · ${foodLabel}
                </div>
            </div>
        </div>

        <!-- Session Breakdown -->
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
                    &nbsp;·&nbsp; Durata: <strong>${durStr}</strong>
                </div>
            </div>
        </div>

        <div class="breakdown-step">
            <div class="step-number">1</div>
            <div class="step-content">
                <div class="step-label">TBW — Formula di Watson (personalizzata)</div>
                <div class="step-formula">${userProfile.sex === 'M'
                    ? `TBW = 2.447 − 0.09156×${userProfile.age} + 0.1074×${userProfile.height} + 0.3362×${userProfile.weight}`
                    : `TBW = −2.097 + 0.1069×${userProfile.height} + 0.2466×${userProfile.weight}`
                }${workoutNote ? ` − ${(tbw * PHARMA.WORKOUT_DEHYDR / (1 - PHARMA.WORKOUT_DEHYDR)).toFixed(2)} L (allenamento)` : ''}</div>
                <div class="step-result">TBW = <strong>${tbw.toFixed(2)} L</strong>${workoutNote ? ` <span style="color:var(--warning);font-size:0.8rem">(${workoutNote})</span>` : ''}</div>
            </div>
        </div>

        <div class="breakdown-step">
            <div class="step-number">2</div>
            <div class="step-content">
                <div class="step-label">Volume di Distribuzione (Vd)</div>
                <div class="step-formula">Vd = TBW / F<sub>water</sub> = ${tbw.toFixed(2)} / ${userProfile.sex === 'M' ? PHARMA.F_WATER : PHARMA.F_WATER_F}</div>
                <div class="step-result">Vd = <strong>${vd.toFixed(2)} L</strong></div>
            </div>
        </div>

        <div class="breakdown-step">
            <div class="step-number">3</div>
            <div class="step-content">
                <div class="step-label">Massa etanolo puro ingerito</div>
                <div class="step-formula">A = Σ (Volume × ABV% / 100 × 0.789)</div>
                <div class="step-result">A = <strong>${totalA.toFixed(2)} g</strong></div>
            </div>
        </div>

        <div class="breakdown-step">
            <div class="step-number">4</div>
            <div class="step-content">
                <div class="step-label">Concentrazione ematica di picco (con fattore cibo f=${fBio.toFixed(2)})</div>
                <div class="step-formula">C₀ = (A × f<sub>bio</sub>) / Vd = (${totalA.toFixed(2)} × ${fBio.toFixed(2)}) / ${vd.toFixed(2)}</div>
                <div class="step-result">C₀ = <strong>${peakBAC.toFixed(3)} g/L</strong></div>
            </div>
        </div>

        <div class="breakdown-step">
            <div class="step-number">5</div>
            <div class="step-content">
                <div class="step-label">Ritardo di assorbimento gastrico (basato sul cibo)</div>
                <div class="step-formula">Δt<sub>peak</sub> = ${formatHoursMinutes(peakDelayHours)} — Il picco è raggiunto dopo l'ultimo sorso</div>
                <div class="step-result">Fase assorbimento: <strong>+${formatHoursMinutes(peakDelayHours)}</strong></div>
            </div>
        </div>

        <div class="breakdown-step">
            <div class="step-number">6</div>
            <div class="step-content">
                <div class="step-label">Tempo di eliminazione epatica (cinetica ordine zero, β<sub>min</sub>=0.10 g/L/h)</div>
                <div class="step-formula">T<sub>elim</sub> = C₀ / β<sub>min</sub> = ${peakBAC.toFixed(3)} / ${PHARMA.BETA_MIN}</div>
                <div class="step-result">T<sub>elim</sub> = <strong>${formatHoursMinutes(elimTime)}</strong> (${elimTime.toFixed(2)} ore)</div>
            </div>
        </div>

        <div class="breakdown-step">
            <div class="step-number">7</div>
            <div class="step-content">
                <div class="step-label">Buffer di sicurezza (coda cinetica + incertezza)</div>
                <div class="step-formula">Buffer = +${PHARMA.BUFFER_HOURS} ore</div>
                <div class="step-result">Buffer = <strong>${formatHoursMinutes(PHARMA.BUFFER_HOURS)}</strong></div>
            </div>
        </div>

        <div class="breakdown-step">
            <div class="step-number">✓</div>
            <div class="step-content">
                <div class="step-label">Tempo totale di attesa dall'ultimo sorso (${formatTime(endTime)})</div>
                <div class="step-formula">T<sub>totale</sub> = Δt<sub>peak</sub> + T<sub>elim</sub> + Buffer = ${peakDelayHours.toFixed(2)} + ${elimTime.toFixed(2)} + ${PHARMA.BUFFER_HOURS}</div>
                <div class="step-result highlight">T<sub>totale</sub> = <strong>${formatHoursMinutes(totalWait)}</strong> — Guida sicura dalle <strong>${formatTime(safeDriveTime)}</strong></div>
            </div>
        </div>
    `;
}

// ═══════════════════════════════════════════════
// GRAFICO BAC (Canvas 2D) — Versione Migliorata
// ═══════════════════════════════════════════════

function drawBACChart(peakBAC, peakDelayHours, elimTime, totalWaitHours) {
    const canvas  = document.getElementById('bacChart');
    const wrapper = canvas.parentElement;
    const dpr     = window.devicePixelRatio || 1;

    const rect = wrapper.getBoundingClientRect();
    canvas.width  = rect.width  * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width  = rect.width  + 'px';
    canvas.style.height = rect.height + 'px';

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const W = rect.width;
    const H = rect.height;
    const pad = { top: 40, right: 30, bottom: 55, left: 65 };
    const plotW = W - pad.left - pad.right;
    const plotH = H - pad.top  - pad.bottom;

    // ── Asse temporale: da 0 a totalWait + un po' di respiro ──
    const maxTime = Math.ceil(totalWaitHours + 0.75);
    // ── Asse BAC: dall'alto fino a 0 ──
    const maxBAC  = Math.max(peakBAC * 1.2, 0.6);

    const scaleX = t   => pad.left + (t / maxTime) * plotW;
    const scaleY = bac => pad.top  + (1 - bac / maxBAC) * plotH;

    // ── PULIZIA ──
    ctx.clearRect(0, 0, W, H);

    // ── SFONDO GRAFICO con gradiente ──
    const bgGrad = ctx.createLinearGradient(0, pad.top, 0, H - pad.bottom);
    bgGrad.addColorStop(0, 'rgba(20, 20, 50, 0.6)');
    bgGrad.addColorStop(1, 'rgba(10, 10, 25, 0.2)');
    ctx.fillStyle = bgGrad;
    ctx.beginPath();
    ctx.roundRect(pad.left, pad.top, plotW, plotH, 6);
    ctx.fill();

    // ── ZONA ROSSA (BAC > 0.5, illegale) ──
    if (maxBAC > 0.5) {
        const y05 = scaleY(0.5);
        const dangerGrad = ctx.createLinearGradient(0, pad.top, 0, y05);
        dangerGrad.addColorStop(0, 'rgba(255, 71, 87, 0.08)');
        dangerGrad.addColorStop(1, 'rgba(255, 71, 87, 0.02)');
        ctx.fillStyle = dangerGrad;
        ctx.fillRect(pad.left, pad.top, plotW, y05 - pad.top);
    }

    // ── GRIGLIA ──
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    const bacStep = maxBAC > 1.2 ? 0.25 : maxBAC > 0.6 ? 0.1 : 0.05;
    for (let bac = 0; bac <= maxBAC; bac += bacStep) {
        const y = scaleY(bac);
        ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke();
    }
    for (let t = 0; t <= maxTime; t += 0.5) {
        const x = scaleX(t);
        ctx.beginPath(); ctx.moveTo(x, pad.top); ctx.lineTo(x, H - pad.bottom); ctx.stroke();
    }

    // ── LINEA LIMITE 0.5 g/L ──
    if (maxBAC > 0.5) {
        const y05  = scaleY(0.5);
        ctx.strokeStyle = 'rgba(255, 170, 0, 0.5)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([8, 5]);
        ctx.beginPath(); ctx.moveTo(pad.left, y05); ctx.lineTo(W - pad.right, y05); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(255,170,0,0.8)';
        ctx.font = 'bold 9px Inter, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('⚠ 0.50 g/L  Limite legale', pad.left + 6, y05 - 5);
    }

    // ── ZONA BUFFER (shaded) ──
    const xPeak  = scaleX(peakDelayHours);
    const xZero  = scaleX(peakDelayHours + elimTime);
    const xSafe  = scaleX(totalWaitHours);
    if (xZero < xSafe) {
        const bufGrad = ctx.createLinearGradient(xZero, 0, xSafe, 0);
        bufGrad.addColorStop(0, 'rgba(0, 214, 143, 0.08)');
        bufGrad.addColorStop(1, 'rgba(0, 214, 143, 0.02)');
        ctx.fillStyle = bufGrad;
        ctx.fillRect(xZero, pad.top, xSafe - xZero, plotH);
    }

    // ── CURVA BAC: Assorbimento (0 → peakDelay) + Eliminazione (peakDelay → zero) ──
    // Fase 1: salita (curva sigmoidale semplificata)
    // Fase 2: discesa lineare (cinetica ordine zero)

    const steps = 400;

    // Area sotto la curva
    const areaGrad = ctx.createLinearGradient(0, scaleY(peakBAC), 0, scaleY(0));
    areaGrad.addColorStop(0, 'rgba(255, 71, 87, 0.20)');
    areaGrad.addColorStop(0.4, 'rgba(255, 170, 0, 0.10)');
    areaGrad.addColorStop(1, 'rgba(0, 214, 143, 0.03)');

    ctx.fillStyle = areaGrad;
    ctx.beginPath();
    ctx.moveTo(scaleX(0), scaleY(0));

    for (let i = 0; i <= steps; i++) {
        const t   = (i / steps) * (peakDelayHours + elimTime);
        const bac = bacAtTime(t, peakBAC, peakDelayHours, elimTime);
        if (i === 0) ctx.lineTo(scaleX(0), scaleY(0));
        ctx.lineTo(scaleX(t), scaleY(bac));
    }
    ctx.lineTo(scaleX(peakDelayHours + elimTime), scaleY(0));
    ctx.closePath();
    ctx.fill();

    // Linea principale della curva
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (let i = 0; i <= steps; i++) {
        const t   = (i / steps) * (peakDelayHours + elimTime);
        const bac = bacAtTime(t, peakBAC, peakDelayHours, elimTime);
        const x   = scaleX(t);
        const y   = scaleY(bac);

        // Colore gradiente lungo la curva
        const ratio = bac / peakBAC;
        if (ratio > 0.7) {
            ctx.strokeStyle = '#ff4757';
        } else if (ratio > 0.35) {
            ctx.strokeStyle = '#ffaa00';
        } else {
            ctx.strokeStyle = '#00d68f';
        }

        if (i === 0) { ctx.beginPath(); ctx.moveTo(x, y); }
        else {
            ctx.lineTo(x, y);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(x, y);
        }
    }

    // ── MARKER PICCO ──
    ctx.fillStyle = '#ff4757';
    ctx.shadowColor = 'rgba(255, 71, 87, 0.5)';
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(scaleX(peakDelayHours), scaleY(peakBAC), 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Etichetta picco
    const peakLabelX = scaleX(peakDelayHours);
    const peakLabelY = scaleY(peakBAC);
    ctx.fillStyle = '#ff4757';
    ctx.font = 'bold 11px Outfit, sans-serif';
    ctx.textAlign = peakLabelX > W * 0.6 ? 'right' : 'left';
    const labelOffset = ctx.textAlign === 'right' ? -10 : 10;
    // Background pill
    const label = `PICCO ${peakBAC.toFixed(3)} g/L`;
    const labelW = ctx.measureText(label).width + 14;
    const labelH = 18;
    const lx = peakLabelX + labelOffset - (ctx.textAlign === 'right' ? labelW : 0);
    ctx.fillStyle = 'rgba(255,71,87,0.15)';
    ctx.beginPath(); ctx.roundRect(lx, peakLabelY - labelH - 4, labelW, labelH, 4); ctx.fill();
    ctx.fillStyle = '#ff4757';
    ctx.fillText(label, peakLabelX + labelOffset, peakLabelY - 8);

    // ── LINEA VERTICALE SAFE-TO-DRIVE ──
    ctx.strokeStyle = 'rgba(0, 214, 143, 0.7)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(xSafe, pad.top);
    ctx.lineTo(xSafe, H - pad.bottom);
    ctx.stroke();
    ctx.setLineDash([]);

    // ── MARKER GUIDA SICURA ──
    ctx.fillStyle = '#00d68f';
    ctx.shadowColor = 'rgba(0, 214, 143, 0.5)';
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(xSafe, scaleY(0), 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Etichetta guida sicura
    ctx.font = 'bold 10px Inter, sans-serif';
    ctx.fillStyle = '#00d68f';
    ctx.textAlign = 'center';
    // Pill background
    const safeLabel = '✓ GUIDA SICURA';
    const safeLW = ctx.measureText(safeLabel).width + 14;
    ctx.fillStyle = 'rgba(0,214,143,0.15)';
    ctx.beginPath(); ctx.roundRect(xSafe - safeLW/2, pad.top - 28, safeLW, 20, 4); ctx.fill();
    ctx.fillStyle = '#00d68f';
    ctx.fillText(safeLabel, xSafe, pad.top - 12);

    // ── MARKER ZERO CROSSING ──
    ctx.fillStyle = '#ffaa00';
    ctx.beginPath();
    ctx.arc(xZero, scaleY(0), 4, 0, Math.PI * 2);
    ctx.fill();

    // ── PHASE LABELS ──
    if (peakDelayHours > 0.15) {
        const midAbsorb = (scaleX(0) + scaleX(peakDelayHours)) / 2;
        const midY = scaleY(peakBAC * 0.5);
        ctx.fillStyle = 'rgba(255,170,0,0.45)';
        ctx.font = 'italic 9px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('↑ assorbimento', midAbsorb, midY);
    }

    const midElim = (scaleX(peakDelayHours) + scaleX(peakDelayHours + elimTime)) / 2;
    ctx.fillStyle = 'rgba(255,71,87,0.45)';
    ctx.font = 'italic 9px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('↓ eliminazione', midElim, scaleY(peakBAC * 0.5));

    if (xZero < xSafe - 10) {
        ctx.fillStyle = 'rgba(0,214,143,0.5)';
        ctx.font = '9px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('buffer', (xZero + xSafe) / 2, scaleY(0) - 16);
    }

    // ── ETICHETTE ASSI Y ──
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font = '500 10px Inter, sans-serif';
    ctx.textAlign = 'right';
    for (let bac = 0; bac <= maxBAC; bac += bacStep) {
        ctx.fillText(bac.toFixed(bac < 0.1 ? 2 : 1), pad.left - 8, scaleY(bac) + 3);
    }

    // ── ETICHETTE ASSI X ──
    ctx.textAlign = 'center';
    for (let t = 0; t <= maxTime; t += 0.5) {
        if (t % 1 === 0) {
            ctx.fillStyle = 'rgba(255,255,255,0.45)';
            ctx.font = '500 10px Inter, sans-serif';
            ctx.fillText(`${t}h`, scaleX(t), H - pad.bottom + 18);
        } else {
            ctx.fillStyle = 'rgba(255,255,255,0.2)';
            ctx.font = '9px Inter, sans-serif';
            ctx.fillText(`${t}h`, scaleX(t), H - pad.bottom + 16);
        }
    }

    // ── TITOLI ASSI ──
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.font = '500 10px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Ore dall\'ultimo sorso', pad.left + plotW / 2, H - 5);

    ctx.save();
    ctx.translate(15, pad.top + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('BAC (g/L)', 0, 0);
    ctx.restore();

    // ── LINEE ASSI ──
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad.left, pad.top);
    ctx.lineTo(pad.left, H - pad.bottom);
    ctx.lineTo(W - pad.right, H - pad.bottom);
    ctx.stroke();
}

/**
 * Calcola il BAC a un dato tempo t (ore dall'ultimo sorso).
 * Fase assorbimento [0, peakDelay]: salita con curva logaritmica
 * Fase eliminazione [peakDelay, peakDelay + elimTime]: discesa lineare ordine zero
 */
function bacAtTime(t, peakBAC, peakDelayHours, elimTime) {
    if (t <= 0) return 0;
    if (peakDelayHours < 0.05) {
        // Nessun assorbimento apprezzabile → discesa diretta
        return Math.max(peakBAC - PHARMA.BETA_MIN * t, 0);
    }
    if (t <= peakDelayHours) {
        // Fase di assorbimento: curva sigmoide semplificata (normalizzata 0→1)
        const x = t / peakDelayHours; // 0..1
        const sigmoid = x * x * (3 - 2 * x); // smoothstep cubico
        return peakBAC * sigmoid;
    } else {
        // Fase di eliminazione
        const elapsed = t - peakDelayHours;
        return Math.max(peakBAC - PHARMA.BETA_MIN * elapsed, 0);
    }
}

// ═══════════════════════════════════════════════
// EVENT LISTENERS
// ═══════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {

    // Carica profilo salvato
    loadProfile();
    populateDOMFromProfile();

    // ── Profilo: input changes ──
    const profileInputIds = ['profileWeight', 'profileHeight', 'foodStartTime', 'foodEndTime', 'workoutStartTime', 'workoutEndTime', 'hydrationWater', 'hydrationGrams'];
    profileInputIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('change', () => { syncProfileFromDOM(); });
            // Add input event for number fields to sync while typing
            if (el.type === 'number') {
                el.addEventListener('input', () => { syncProfileFromDOM(); });
            }
        }
    });

    // ── Cibo: bottoni ──
    document.querySelectorAll('.food-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.food-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            userProfile.food = btn.dataset.food;
            syncProfileFromDOM();
        });
    });

    // ── Allenamento toggle ──
    const workoutToggle = document.getElementById('workoutToggle');
    if (workoutToggle) {
        workoutToggle.addEventListener('change', () => {
            userProfile.workout = workoutToggle.checked;
            updateWorkoutUI();
            syncProfileFromDOM();
        });
    }



    // ── Amino toggle ──
    const aminoToggle = document.getElementById('aminoToggle');
    if (aminoToggle) {
        aminoToggle.addEventListener('change', () => {
            userProfile.aminoPreWorkout = aminoToggle.checked;
            syncProfileFromDOM();
        });
    }

    renderPresetDrinks();

    // ── Custom drink form ──
    const addCustomBtn = document.getElementById('addCustomBtn');
    addCustomBtn.addEventListener('click', () => {
        const volumeInput = document.getElementById('customVolume');
        const abvInput    = document.getElementById('customAbv');
        const nameInput   = document.getElementById('customName');

        const volume = parseFloat(volumeInput.value);
        const abv    = parseFloat(abvInput.value);
        const name   = nameInput.value.trim() || 'Personalizzata';

        if (!volume || volume <= 0) {
            volumeInput.focus(); volumeInput.style.borderColor = '#ff4757';
            setTimeout(() => volumeInput.style.borderColor = '', 1500); return;
        }
        if (!abv || abv <= 0 || abv > 100) {
            abvInput.focus(); abvInput.style.borderColor = '#ff4757';
            setTimeout(() => abvInput.style.borderColor = '', 1500); return;
        }

        addDrink(name, '🍶', volume, abv);
        volumeInput.value = '';
        abvInput.value    = '';
        nameInput.value   = '';
    });

    ['customVolume', 'customAbv', 'customName'].forEach(id => {
        document.getElementById(id).addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); addCustomBtn.click(); }
        });
    });

    // ── Clear all ──
    document.getElementById('clearAllBtn').addEventListener('click', clearAllDrinks);

    // ── Calculate ──
    document.getElementById('calculateBtn').addEventListener('click', performCalculation);

    // ── Resize chart on window resize ──
    let resizeTimeout;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            const resultsSection = document.getElementById('results');
            if (resultsSection && resultsSection.style.display !== 'none') {
                const params   = calcPharmaParams();
                const totalA   = getTotalAlcoholGrams();
                const peakBAC  = calcPeakBAC(totalA, params.vd, params.fBio);
                const elimTime = calcEliminationTime(peakBAC);
                const totalWait = calcTotalWaitTime(params.peakDelayHours, elimTime);
                drawBACChart(peakBAC, params.peakDelayHours, elimTime, totalWait);
            }
        }, 250);
    });
});
