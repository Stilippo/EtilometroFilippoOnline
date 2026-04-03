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
let currentSimulation = null;

function saveDrinks() {
    try {
        localStorage.setItem('etilometro_drinks', JSON.stringify(consumedDrinks));
        pushToGitHub();
    } catch (e) { /* private browsing */ }
}

function loadDrinks() {
    try {
        const saved = localStorage.getItem('etilometro_drinks');
        if (saved) {
            consumedDrinks = JSON.parse(saved);
            drinkIdCounter = consumedDrinks.length > 0 ? Math.max(...consumedDrinks.map(d => d.uid)) : 0;
        }
    } catch (e) { /* ignore */ }
}

function attemptSyncFromURL() {
    const params = new URLSearchParams(window.location.search);
    const syncData = params.get('sync');
    if (syncData) {
        try {
            const decoded = decodeURIComponent(escape(atob(syncData)));
            const data = JSON.parse(decoded);
            if (data.profile) userProfile = { ...userProfile, ...data.profile };
            if (data.drinks) {
                consumedDrinks = data.drinks;
                drinkIdCounter = consumedDrinks.length > 0 ? Math.max(...consumedDrinks.map(d => d.uid)) : 0;
            }
            saveProfile();
            saveDrinks();
            
            // Ripulisce l'URL
            const url = new URL(window.location);
            url.searchParams.delete('sync');
            window.history.replaceState({}, document.title, url);
        } catch (e) {
            console.error('Errore sincronizzazione:', e);
            alert('Il link di sincronizzazione non è valido o è corrotto.');
        }
    }
}

function generateSyncLink() {
    const data = { profile: userProfile, drinks: consumedDrinks };
    const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(data))));
    const url = new URL(window.location.href.split('?')[0]);
    url.searchParams.set('sync', b64);
    return url.toString();
}

function showSyncModal() {
    const link = generateSyncLink();
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(link)}`;
    
    let modal = document.getElementById('syncModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'syncModal';
        modal.className = 'sync-modal-overlay';
        document.body.appendChild(modal);
    }
    modal.innerHTML = `
        <div class="sync-modal-content glass-card">
            <button class="sync-modal-close">✕</button>
            <h3>📱 Continua sul Telefono</h3>
            <p style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 1rem;">Inquadra questo QR Code con il tuo smartphone per ritrovare le tue consumazioni e il tuo profilo sincronizzati all'istante.</p>
            <div style="text-align:center; padding: 1rem; background: white; border-radius: 8px; display:inline-block; margin: 0.5rem 0;">
                <img src="${qrUrl}" alt="QR Code" width="200" height="200">
            </div>
            <div style="margin-top: 1rem;">
                <input type="text" value="${link}" readonly style="width:100%; padding: 0.5rem; border-radius: 4px; border: 1px solid rgba(255,255,255,0.2); background: rgba(0,0,0,0.3); color: white; margin-bottom: 0.5rem; font-size: 0.8rem;" id="syncLinkInput">
                <button class="btn btn-secondary btn-large" style="padding: 0.7rem; font-size: 0.9rem" onclick="document.getElementById('syncLinkInput').select(); document.execCommand('copy'); alert('Link copiato!');">📋 Copia Link</button>
            </div>
        </div>
    `;
    modal.style.display = 'flex';
    modal.querySelector('.sync-modal-close').addEventListener('click', () => modal.style.display = 'none');
}

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
    aiFoodFbio: 1.0,           // Fattore cibo calcolato da IA
    aiFoodPeakDelay: 0.5,      // Ritardo picco calcolato da IA
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

    // Fattore di assorbimento gastrico (f_bio) determinato da AI (default 1.0)
    let fBio = userProfile.aiFoodFbio || 1.0;
    let peakDelayHours = userProfile.aiFoodPeakDelay || 0.5;

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
        pushToGitHub();
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
    if (fEl)   fEl.textContent   = params.fBio.toFixed(2) + ' (Calcolato da AI)';
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
    saveDrinks();
    renderConsumedList();
    updateCalculateButton();
}

function removeDrink(uid) {
    consumedDrinks = consumedDrinks.filter(d => d.uid !== uid);
    saveDrinks();
    renderConsumedList();
    updateCalculateButton();
}

function clearAllDrinks() {
    consumedDrinks = [];
    saveDrinks();
    renderConsumedList();
    updateCalculateButton();
    const resultsSection = document.getElementById('results');
    if (resultsSection) resultsSection.style.display = 'none';
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
            if (drink && input.value) { 
                drink[field] = input.value; 
                saveDrinks(); 
            }
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
                if (drink) { 
                    drink[field] = now; 
                    saveDrinks(); 
                }
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

/**
 * Esegue la simulazione numerica analizzando l'assorbimento ed eliminazione 
 * dell'alcol su base mensile (o minutale).
 * Restituisce l'array di riepilogo cronologico (history) e le metriche principali.
 */
function simulateBAC(drinks, params) {
    if (drinks.length === 0) return null;

    const { vd, fBio, peakDelayHours } = params;
    
    // Ordina i drinks per momento di assunzione
    let sortedDrinks = [...drinks].sort((a,b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
    
    // Determina il momento iniziale della simulazione
    const simStartTime = new Date(sortedDrinks[0].startTime).getTime();
    
    const peakDelayMs = peakDelayHours * 3600000;
    
    let history = [];
    let currentMs = simStartTime;
    // Tasso eliminazione etanolo al minuto (g/L/min)
    const elimPerMin = PHARMA.BETA_MIN / 60;
    
    let currentBAC = 0;
    
    // Tracciamo quanto alcol è stato già assorbito da ogni bevanda
    let absorbedFractions = new Array(sortedDrinks.length).fill(0);
    
    // Per gestire il caso in cui siamo a 0 da ore e beviamo ancora, 
    // la simulazione deve girare finché currentBAC > 0 OPPURE ci sono ancora drink da assorbire
    let maxIters = 72 * 60; // Max 72 ore di simulazione per sicurezza
    let iters = 0;
    
    let peakBAC = 0;
    let peakMs = currentMs;
    
    // Aggiungi punto iniziale
    history.push({ time: new Date(currentMs), bac: 0 });
    
    // Precalcolo orari di assorbimento
    const cachedDrinks = sortedDrinks.map(drink => {
        const startMs = new Date(drink.startTime).getTime();
        const endMs = new Date(drink.endTime).getTime();
        const absorbStartMs = startMs;
        const absorbEndMs = Math.max(endMs, startMs + 1000) + peakDelayMs; 
        const totalBacContrib = (drink.grams * fBio) / vd;
        return { absorbStartMs, absorbEndMs, totalBacContrib };
    });

    // Iteriamo di minuto in minuto
    while (iters < maxIters) {
        currentMs += 60000; // Avanza 1 min
        let anyAbsorbing = false;
        
        // Fase 1: Assorbimento
        for (let i = 0; i < cachedDrinks.length; i++) {
            const cd = cachedDrinks[i];
            
            if (currentMs > cd.absorbStartMs && currentMs <= cd.absorbEndMs) {
                anyAbsorbing = true;
            } else if (currentMs <= cd.absorbStartMs) {
                anyAbsorbing = true; // Still waiting for this drink
            }
            
            let newFraction = 0;
            if (currentMs <= cd.absorbStartMs) {
                newFraction = 0;
            } else if (currentMs >= cd.absorbEndMs) {
                newFraction = 1;
            } else {
                const x = (currentMs - cd.absorbStartMs) / Math.max(1, cd.absorbEndMs - cd.absorbStartMs);
                newFraction = x * x * (3 - 2 * x); // smoothstep
            }
            
            const oldFraction = absorbedFractions[i];
            if (newFraction > oldFraction) {
                const addedFraction = newFraction - oldFraction;
                const addedBac = cd.totalBacContrib * addedFraction;
                currentBAC += addedBac;
                absorbedFractions[i] = newFraction;
            }
        }
        
        // Fase 2: Eliminazione
        if (currentBAC > 0) {
            currentBAC -= elimPerMin;
            if (currentBAC < 0) currentBAC = 0;
        }
        
        // Traccia peak
        if (currentBAC > peakBAC) {
            peakBAC = currentBAC;
            peakMs = currentMs;
        }
        
        // Registra storicamente ogni 2 minuti è un buon compromesso
        if (iters % 2 === 0) {
            history.push({ time: new Date(currentMs), bac: currentBAC });
        }
        
        // Uscita
        if (currentBAC <= 0.0001 && !anyAbsorbing) {
            currentBAC = 0;
            history.push({ time: new Date(currentMs), bac: 0 });
            break;
        }
        
        iters++;
    }
    
    // Tempo di zero effettivo 
    const zeroMs = history[history.length - 1].time.getTime();

    const zeroBACTime = new Date(zeroMs);
    const safeDriveTime = peakBAC > 0 ? new Date(zeroMs + PHARMA.BUFFER_HOURS * 3600000) : new Date();

    return { 
        peakBAC,
        peakTime: new Date(peakMs),
        zeroBACTime,
        safeDriveTime,
        history,
        totalWaitHours: peakBAC > 0 ? Math.max(0, (safeDriveTime.getTime() - Date.now()) / 3600000) : 0
    };
}

function performCalculation() {
    syncDrinkTimesFromDOM();
    syncProfileFromDOM();

    let missingEnd = consumedDrinks.some(d => !d.endTime || !d.startTime);
    if (missingEnd) {
        alert("Assicurati di inserire orario inizio e fine per tutte le bevande.");
        return;
    }

    const params = calcPharmaParams();

    const sim = simulateBAC(consumedDrinks, params);
    if (!sim) {
        return;
    }
    
    currentSimulation = sim;

    const { peakBAC, safeDriveTime, history } = sim;
    const totalA = getTotalAlcoholGrams();

    const resultsSection = document.getElementById('results');
    resultsSection.style.display = 'block';

    document.getElementById('resultBac').textContent = sim.peakBAC.toFixed(3);
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

    const msToWait = safeDriveTime.getTime() - Date.now();
    if (msToWait <= 0) {
        document.getElementById('resultTime').innerHTML = '<span style="color:#00d68f">SMALTITO ✔</span>';
        document.getElementById('resultDriveTime').textContent = '--';
        document.getElementById('resultDriveDate').textContent = 'Sei già idoneo alla guida';
    } else {
        document.getElementById('resultTime').textContent = formatHoursMinutes(msToWait / 3600000);
        document.getElementById('resultDriveTime').textContent = formatTime(safeDriveTime);
        document.getElementById('resultDriveDate').textContent  = formatDate(safeDriveTime);
    }

    renderDrugWarnings();
    renderBreakdownNumerical(totalA, sim, params);
    drawBACChartNumerical(sim.history, safeDriveTime);

    resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

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

function renderBreakdownNumerical(totalA, sim, params) {
    const container = document.getElementById('breakdownContent');

    const drinksRows = consumedDrinks.map(d => {
        const s = new Date(d.startTime);
        const e = new Date(d.endTime);
        const dur = calcDurationMinutes(s, e);
        const durStr = dur > 0 ? (dur >= 60 ? `${Math.floor(dur/60)}h ${Math.round(dur%60)}min` : `${Math.round(dur)} min`) : '—';
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

    const foodLabels = { empty: '🍽️ Stomaco Vuoto (f=1.00)', light: '🥗 Pasto Leggero (f=0.85)', full: '🍖 Pasto Abbondante (f=0.70)' };
    const foodLabel = foodLabels[userProfile.food] || '—';

    container.innerHTML = `
        <div class="breakdown-step">
            <div class="step-number">👤</div>
            <div class="step-content">
                <div class="step-label">Profilo Utilizzato</div>
                <div class="step-result">
                    ${userProfile.sex === 'M' ? '♂ Maschio' : '♀ Femmina'} · ${userProfile.age} anni · ${userProfile.weight} kg · ${userProfile.height} cm
                    ${userProfile.workout ? ' · <span style="color:var(--warning)">⚡ Post-Allenamento</span>' : ''}
                    · ${foodLabel}
                </div>
            </div>
        </div>

        <div class="breakdown-step">
            <div class="step-number">🍽️</div>
            <div class="step-content">
                <div class="step-label">Riepilogo Storico Sessione</div>
                <div class="drink-breakdown-table-wrap">
                    <table class="drink-breakdown-table">
                        <thead>
                            <tr><th>Bevanda</th><th>Quantità</th><th>Alcol</th><th>Inizio</th><th>Fine</th><th>Durata</th></tr>
                        </thead>
                        <tbody>${drinksRows}</tbody>
                    </table>
                </div>
                <div class="step-result" style="margin-top: 0.5rem;">
                    Totale alcol ingerito: <strong>${totalA.toFixed(2)} g</strong> · Picco Assoluto: <strong>${sim.peakBAC.toFixed(3)} g/L</strong> alle ${formatTime(sim.peakTime)}
                </div>
            </div>
        </div>
        
        <div class="breakdown-step">
            <div class="step-number">⚙️</div>
            <div class="step-content">
                <div class="step-label">Simulazione Numerica (Minuto per Minuto)</div>
                <div class="step-formula">Dati elaborati dinamicamente tramite iterazione per gestire sovrapposizione multipla di bevute.</div>
                <div class="step-result">
                    TBW = ${params.tbw.toFixed(2)}L, Vd = ${params.vd.toFixed(2)}L<br>
                    Tasso epatico: -0.10 g/L/h<br>
                    Ritardo picco (fase digestione): +${formatHoursMinutes(params.peakDelayHours)}<br>
                    Buffer tolleranza finale aggiunto: +1h
                </div>
            </div>
        </div>
    `;
}

// ═══════════════════════════════════════════════
// GRAFICO BAC (Canvas 2D) — Orari Reali
// ═══════════════════════════════════════════════

function drawBACChartNumerical(history, safeDriveTime) {
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

    if (!history || history.length === 0) return;

    const W = rect.width;
    const H = rect.height;
    const pad = { top: 40, right: 30, bottom: 55, left: 65 };
    const plotW = W - pad.left - pad.right;
    const plotH = H - pad.top  - pad.bottom;

    const tStart = history[0].time.getTime();
    // Vogliamo che l'asse mostri almeno fino al safeDriveTime + 30 minuti extra
    const safeMs = safeDriveTime.getTime();
    const tEndRaw = Math.max(safeMs + 1800000, history[history.length-1].time.getTime() + 3600000);
    const totalDurationMs = tEndRaw - tStart;
    
    let maxBAC = 0.6;
    history.forEach(pt => { if (pt.bac > maxBAC) maxBAC = pt.bac; });
    maxBAC = maxBAC * 1.2;

    const scaleX = (t) => pad.left + ((t - tStart) / totalDurationMs) * plotW;
    const scaleY = (bac) => pad.top  + (1 - bac / maxBAC) * plotH;

    // PULIZIA
    ctx.clearRect(0, 0, W, H);

    // SFONDO
    const bgGrad = ctx.createLinearGradient(0, pad.top, 0, H - pad.bottom);
    bgGrad.addColorStop(0, 'rgba(20, 20, 50, 0.6)');
    bgGrad.addColorStop(1, 'rgba(10, 10, 25, 0.2)');
    ctx.fillStyle = bgGrad;
    ctx.beginPath(); ctx.roundRect(pad.left, pad.top, plotW, plotH, 6); ctx.fill();

    // ZONA ROSSA
    if (maxBAC > 0.5) {
        const y05 = scaleY(0.5);
        if (y05 > pad.top) { // Ensure rect is positive 
            const dH = Math.max(0, y05 - pad.top);
            const dangerGrad = ctx.createLinearGradient(0, pad.top, 0, y05);
            dangerGrad.addColorStop(0, 'rgba(255, 71, 87, 0.08)');
            dangerGrad.addColorStop(1, 'rgba(255, 71, 87, 0.02)');
            ctx.fillStyle = dangerGrad;
            ctx.fillRect(pad.left, pad.top, plotW, dH);
        }
    }

    // GRIGLIA Y
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    const bacStep = maxBAC > 1.2 ? 0.25 : maxBAC > 0.6 ? 0.1 : 0.05;
    for (let bac = 0; bac <= maxBAC; bac += bacStep) {
        const y = scaleY(bac);
        ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke();
    }
    
    // GRIGLIA X (Orari reali)
    ctx.textAlign = 'center';
    const firstHour = new Date(tStart);
    firstHour.setMinutes(0, 0, 0);
    if (firstHour.getTime() < tStart) firstHour.setHours(firstHour.getHours() + 1);
    
    let tMark = firstHour.getTime();
    while (tMark <= tEndRaw) {
        const x = scaleX(tMark);
        ctx.beginPath(); ctx.moveTo(x, pad.top); ctx.lineTo(x, H - pad.bottom); ctx.stroke();
        
        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        ctx.font = '500 10px Inter, sans-serif';
        const d = new Date(tMark);
        ctx.fillText(formatTime(d), x, H - pad.bottom + 18);
        tMark += 3600000; // Incrementa di 1h
    }

    // LINEA LIMITE 0.5 g/L
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

    // BUFFER ZONE (shaded region from zero to safe)
    const zeroMs = history[history.length - 1].time.getTime();
    const xZero = scaleX(zeroMs);
    const xSafe = scaleX(safeMs);
    if (xZero < xSafe) {
        const bufGrad = ctx.createLinearGradient(xZero, 0, xSafe, 0);
        bufGrad.addColorStop(0, 'rgba(0, 214, 143, 0.08)');
        bufGrad.addColorStop(1, 'rgba(0, 214, 143, 0.02)');
        ctx.fillStyle = bufGrad;
        ctx.fillRect(xZero, pad.top, Math.max(0, xSafe - xZero), plotH);
    }

    // CURVA BAC
    const peakHistory = Math.max(...history.map(h => h.bac));
    const areaGrad = ctx.createLinearGradient(0, scaleY(peakHistory), 0, scaleY(0));
    areaGrad.addColorStop(0, 'rgba(255, 71, 87, 0.20)');
    areaGrad.addColorStop(0.4, 'rgba(255, 170, 0, 0.10)');
    areaGrad.addColorStop(1, 'rgba(0, 214, 143, 0.03)');

    ctx.fillStyle = areaGrad;
    ctx.beginPath();
    ctx.moveTo(scaleX(tStart), scaleY(0));
    for (let i = 0; i < history.length; i++) {
        ctx.lineTo(scaleX(history[i].time.getTime()), scaleY(history[i].bac));
    }
    const lastT = history[history.length-1].time.getTime();
    ctx.lineTo(scaleX(lastT), scaleY(0));
    ctx.closePath();
    ctx.fill();

    // Linea principale
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (let i = 0; i < history.length - 1; i++) {
        const t1 = history[i].time.getTime();
        const t2 = history[i+1].time.getTime();
        const b1 = history[i].bac;
        const b2 = history[i+1].bac;
        
        const ratio = b1 / peakHistory;
        if (ratio > 0.7) ctx.strokeStyle = '#ff4757';
        else if (ratio > 0.35) ctx.strokeStyle = '#ffaa00';
        else ctx.strokeStyle = '#00d68f';
        
        ctx.beginPath();
        ctx.moveTo(scaleX(t1), scaleY(b1));
        ctx.lineTo(scaleX(t2), scaleY(b2));
        ctx.stroke();
    }

    // SAFE DRIVE MARKER
    if (xSafe <= W - pad.right + 20) {
        ctx.strokeStyle = 'rgba(0, 214, 143, 0.7)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 4]);
        ctx.beginPath(); ctx.moveTo(xSafe, pad.top); ctx.lineTo(xSafe, H - pad.bottom); ctx.stroke();
        ctx.setLineDash([]);
        
        ctx.fillStyle = '#00d68f';
        ctx.shadowColor = 'rgba(0, 214, 143, 0.5)';
        ctx.shadowBlur = 10;
        ctx.beginPath(); ctx.arc(xSafe, scaleY(0), 7, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;

        ctx.font = 'bold 10px Inter, sans-serif';
        ctx.fillStyle = '#00d68f';
        ctx.textAlign = 'center';
        // Background pill
        const safeLabel = '✓ GUIDA SICURA';
        const safeLW = ctx.measureText(safeLabel).width + 14;
        ctx.fillStyle = 'rgba(0,214,143,0.15)';
        ctx.beginPath(); ctx.roundRect(xSafe - safeLW/2, pad.top - 28, safeLW, 20, 4); ctx.fill();
        ctx.fillStyle = '#00d68f';
        ctx.fillText(safeLabel, xSafe, pad.top - 12);
    }
    
    // ETICHETTE ASSI Y
    ctx.textAlign = 'right';
    for (let bac = 0; bac <= maxBAC; bac += bacStep) {
        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        ctx.font = '500 10px Inter, sans-serif';
        ctx.fillText(bac.toFixed(bac < 0.1 ? 2 : 1), pad.left - 8, scaleY(bac) + 3);
    }

    // TITOLI ASSI
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.font = '500 10px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Orario (Real-Time)', pad.left + plotW / 2, H - 5);

    ctx.save();
    ctx.translate(15, pad.top + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('BAC (g/L)', 0, 0);
    ctx.restore();
    
    // LINEE ASSI
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad.left, pad.top);
    ctx.lineTo(pad.left, H - pad.bottom);
    ctx.lineTo(W - pad.right, H - pad.bottom);
    ctx.stroke();
}


// ═══════════════════════════════════════════════
// EVENT LISTENERS
// ═══════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', async () => {
    // ── Gestione Sincronizzazione Locale/Cloud ──
    attemptSyncFromURL();

    // Carica profilo base
    loadProfile();
    
    // Tenta di sovrascrivere dal Cloud
    await fetchFromGitHub();

    populateDOMFromProfile();
    loadDrinks(); // Carica drink salvati (da localstorage) solo se fallback
    renderConsumedList();
    updateCalculateButton();

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

    // ── Sync ──
    const syncBtn = document.getElementById('syncBtn');
    if(syncBtn) {
        syncBtn.addEventListener('click', showSyncModal);
    }

    // ── Calculate ──
    document.getElementById('calculateBtn').addEventListener('click', performCalculation);

    // ── Resize chart on window resize ──
    let resizeTimeout;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            const resultsSection = document.getElementById('results');
            if (resultsSection && resultsSection.style.display !== 'none' && currentSimulation) {
                drawBACChartNumerical(currentSimulation.history, currentSimulation.safeDriveTime);
            }
        }, 250);
    });
    // ── Settings API Modal ──
    const savedPat = localStorage.getItem('etilometro_gh_pat');
    const savedGemini = localStorage.getItem('etilometro_gemini_key');
    if(savedPat) {
        const pInp = document.getElementById('githubPatInput');
        if (pInp) pInp.value = savedPat;
    }
    if(savedGemini) {
        const gInp = document.getElementById('geminiKeyInput');
        if (gInp) gInp.value = savedGemini;
    }

    const openSettingsBtn = document.getElementById('openSettingsBtn');
    const closeSettingsBtn = document.getElementById('closeSettingsBtn');
    const saveSettingsBtn = document.getElementById('saveSettingsBtn');
    const settingsModal = document.getElementById('settingsModal');

    if(openSettingsBtn) openSettingsBtn.addEventListener('click', () => settingsModal.style.display = 'flex');
    if(closeSettingsBtn) closeSettingsBtn.addEventListener('click', () => settingsModal.style.display = 'none');
    if(saveSettingsBtn) {
        saveSettingsBtn.addEventListener('click', async () => {
            const pat = document.getElementById('githubPatInput').value.trim();
            const gemini = document.getElementById('geminiKeyInput').value.trim();
            if(pat) localStorage.setItem('etilometro_gh_pat', pat);
            else localStorage.removeItem('etilometro_gh_pat');
            if(gemini) localStorage.setItem('etilometro_gemini_key', gemini);
            else localStorage.removeItem('etilometro_gemini_key');
            settingsModal.style.display = 'none';
            // Inizializza Gist se abbiamo appena inserito un nuovo PAT e non ce n'è uno salvato
            if (pat && !localStorage.getItem('etilometro_gist_id')) {
                await initGitHubDatabase();
            }
        });
    }

    // ── AI Food Scanner ──
    const aiAnalyzeBtn = document.getElementById('aiAnalyzeBtn');
    if (aiAnalyzeBtn) {
        aiAnalyzeBtn.addEventListener('click', async () => {
            const text = document.getElementById('aiFoodText').value.trim();
            if(!text) return;
            const apiKey = localStorage.getItem('etilometro_gemini_key');
            if(!apiKey) {
                alert("Non hai configurato la Google Gemini API Key. Vai su ⚙️ Impostazioni API.");
                return;
            }
            aiAnalyzeBtn.innerHTML = '<span>⏳</span> Elaborazione...';
            aiAnalyzeBtn.disabled = true;

            const aiResult = await askGeminiFoodFactor(text, apiKey);

            aiAnalyzeBtn.innerHTML = '<span>🪄</span> Analizza Pasto con Gemini';
            aiAnalyzeBtn.disabled = false;

            if (aiResult) {
                userProfile.aiFoodFbio = aiResult.fBio;
                userProfile.aiFoodPeakDelay = aiResult.peakDelayHours;
                syncProfileFromDOM();
                
                document.getElementById('aiFoodResult').style.display = 'block';
                document.getElementById('aiFoodExplanation').textContent = aiResult.reason;
                document.getElementById('aiFoodFbio').textContent = aiResult.fBio.toFixed(2);
                document.getElementById('aiFoodDelay').textContent = aiResult.peakDelayHours.toFixed(2) + " ore";
            } else {
                alert("Errore nell'analisi del cibo tramite IA.");
            }
        });
    }
});

// ═══════════════════════════════════════════════
// CLOUD SYSTEM (GITHUB GIST)
// ═══════════════════════════════════════════════

async function initGitHubDatabase() {
    const pat = localStorage.getItem('etilometro_gh_pat');
    if (!pat) return;
    try {
        const response = await fetch('https://api.github.com/gists', {
            method: 'POST',
            headers: { 'Authorization': `token ${pat}`, 'Accept': 'application/vnd.github.v3+json' },
            body: JSON.stringify({
                description: 'Etilometro Online DB',
                public: false,
                files: { 'etilometro_db.json': { content: JSON.stringify({ profile: userProfile, drinks: consumedDrinks }) } }
            })
        });
        const data = await response.json();
        if (data.id) {
            localStorage.setItem('etilometro_gist_id', data.id);
            alert("Database Cloud inizializzato con successo!");
        } else {
            console.error("Gist init error", data);
            alert("Errore nell'inizializzazione del Gist. Controlla il PAT.");
        }
    } catch(e) {
        console.error(e);
        alert("Errore di rete durante la creazione del Gist.");
    }
}

let syncTimeout = null;
async function pushToGitHub() {
    const pat = localStorage.getItem('etilometro_gh_pat');
    const gistId = localStorage.getItem('etilometro_gist_id');
    if (!pat || !gistId) return;

    if (syncTimeout) clearTimeout(syncTimeout);
    syncTimeout = setTimeout(async () => {
        try {
            await fetch(`https://api.github.com/gists/${gistId}`, {
                method: 'PATCH',
                headers: { 'Authorization': `token ${pat}`, 'Accept': 'application/vnd.github.v3+json' },
                body: JSON.stringify({
                    files: {
                        'etilometro_db.json': {
                            content: JSON.stringify({ profile: userProfile, drinks: consumedDrinks })
                        }
                    }
                })
            });
            console.log("Sincronizzato sul Cloud GitHub.");
        } catch (e) { console.error("Sync error", e); }
    }, 2500); // 2.5 seconds debounce
}

async function fetchFromGitHub() {
    const pat = localStorage.getItem('etilometro_gh_pat');
    const gistId = localStorage.getItem('etilometro_gist_id');
    if (!pat || !gistId) return;

    try {
        const response = await fetch(`https://api.github.com/gists/${gistId}`, {
            headers: { 'Authorization': `token ${pat}` }
        });
        const data = await response.json();
        if (data.files && data.files['etilometro_db.json']) {
            const contentStr = data.files['etilometro_db.json'].content;
            const parsed = JSON.parse(contentStr);
            if (parsed.profile) userProfile = { ...userProfile, ...parsed.profile };
            if (parsed.drinks) {
                consumedDrinks = parsed.drinks;
                drinkIdCounter = consumedDrinks.length > 0 ? Math.max(...consumedDrinks.map(d => d.uid)) : 0;
            }
            populateDOMFromProfile();
            renderConsumedList();
            updateCalculateButton();
        }
    } catch (e) {
        console.error("Fetch DB error", e);
    }
}

// ═══════════════════════════════════════════════
// ARTIFICIAL INTELLIGENCE (GEMINI)
// ═══════════════════════════════════════════════

async function askGeminiFoodFactor(foodDescription, apiKey) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
    
    const systemInstruction = `Sei un esperto nutrizionista farmacocinetico. L'utente ti descriverà il suo pasto. Il tuo compito è determinare il fattore di assorbimento gastrico (fBio) e il ritardo di picco alcolemico (peakDelayHours).
Regole:
- fBio deve essere tra 0.70 (pasti molto pesanti/grassi/abbondanti) e 1.0 (stomaco vuoto).
- peakDelayHours deve essere tra 0.5 (stomaco vuoto) e 1.5 (pasti molto abbondanti).
DEVI rispondere *ESCLUSIVAMENTE* outputtando un JSON valido con questa esatta struttura e senza formattazione aggiuntiva markdown:
{
  "fBio": 0.85,
  "peakDelayHours": 1.0,
  "reason": "breve spiegazione nutrizionale..."
}`;

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                system_instruction: { parts: { text: systemInstruction } },
                contents: [
                    { parts: [{ text: foodDescription }] }
                ],
                generationConfig: {
                    responseMimeType: "application/json"
                }
            })
        });

        const jsonResp = await response.json();
        
        if (jsonResp.error) {
            console.error(jsonResp.error);
            return null;
        }
        
        if (jsonResp.candidates && jsonResp.candidates[0].content) {
            let resText = jsonResp.candidates[0].content.parts[0].text;
            resText = resText.replace(/```json/gi, '').replace(/```/g, '').trim();
            return JSON.parse(resText);
        }
    } catch(err) {
        console.error("Gemini err:", err);
        return null;
    }
    return null;
}
