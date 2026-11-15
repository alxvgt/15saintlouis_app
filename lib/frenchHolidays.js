// lib/frenchHolidays.js
// Jours fériés (France métropolitaine) et vacances scolaires (zones A, B, C confondues).

const DAY_MS = 86400000;
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const utc = (y, m, d) => Date.UTC(y, m - 1, d);

// Dimanche de Pâques (algorithme de Meeus/Jones/Butcher)
function easterMs(year) {
    const a = year % 19, b = Math.floor(year / 100), c = year % 100;
    const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return utc(year, month, day);
}

const holidayCache = new Map();
function publicHolidays(year) {
    if (holidayCache.has(year)) return holidayCache.get(year);
    const easter = easterMs(year);
    const map = new Map([
        [iso(utc(year, 1, 1)), "Jour de l'An"],
        [iso(easter + DAY_MS), 'Lundi de Pâques'],
        [iso(utc(year, 5, 1)), 'Fête du Travail'],
        [iso(utc(year, 5, 8)), 'Victoire 1945'],
        [iso(easter + 39 * DAY_MS), 'Ascension'],
        [iso(easter + 50 * DAY_MS), 'Lundi de Pentecôte'],
        [iso(utc(year, 7, 14)), 'Fête nationale'],
        [iso(utc(year, 8, 15)), 'Assomption'],
        [iso(utc(year, 11, 1)), 'Toussaint'],
        [iso(utc(year, 11, 11)), 'Armistice 1918'],
        [iso(utc(year, 12, 25)), 'Noël'],
    ]);
    holidayCache.set(year, map);
    return map;
}

// Vacances scolaires, calendrier officiel (arrêtés du 22/10/2025 pour 2026-2027 et du 21/07/2026 pour 2027-2028).
// start = premier jour de vacances (le samedi), end = jour de reprise des cours (EXCLU).
// ➜ À compléter chaque année avec le calendrier publié sur education.gouv.fr/calendrier-scolaire
export const SCHOOL_HOLIDAYS = [
    // 2026-2027
    {name: 'Toussaint', zones: 'ABC', start: '2026-10-17', end: '2026-11-02'},
    {name: 'Noël', zones: 'ABC', start: '2026-12-19', end: '2027-01-04'},
    {name: 'Hiver', zones: 'C', start: '2027-02-06', end: '2027-02-22'},
    {name: 'Hiver', zones: 'A', start: '2027-02-13', end: '2027-03-01'},
    {name: 'Hiver', zones: 'B', start: '2027-02-20', end: '2027-03-08'},
    {name: 'Printemps', zones: 'C', start: '2027-04-03', end: '2027-04-19'},
    {name: 'Printemps', zones: 'A', start: '2027-04-10', end: '2027-04-26'},
    {name: 'Printemps', zones: 'B', start: '2027-04-17', end: '2027-05-03'},
    {name: "Pont de l'Ascension", zones: 'ABC', start: '2027-05-06', end: '2027-05-10'},
    {name: 'Été', zones: 'ABC', start: '2027-07-03', end: '2027-09-02'},
    // 2027-2028
    {name: 'Toussaint', zones: 'ABC', start: '2027-10-23', end: '2027-11-08'},
    {name: 'Noël', zones: 'ABC', start: '2027-12-18', end: '2028-01-03'},
    {name: 'Hiver', zones: 'B', start: '2028-02-05', end: '2028-02-21'},
    {name: 'Hiver', zones: 'C', start: '2028-02-12', end: '2028-02-28'},
    {name: 'Hiver', zones: 'A', start: '2028-02-19', end: '2028-03-06'},
    {name: 'Printemps', zones: 'B', start: '2028-04-08', end: '2028-04-24'},
    {name: 'Printemps', zones: 'C', start: '2028-04-15', end: '2028-05-02'},
    {name: 'Printemps', zones: 'A', start: '2028-04-22', end: '2028-05-09'},
    {name: "Pont de l'Ascension", zones: 'ABC', start: '2028-05-25', end: '2028-05-29'},
    {name: 'Été', zones: 'ABC', start: '2028-07-04', end: '2028-09-01'}, // reprise 2028 : estimation
];

const infoCache = new Map();

// → null si le jour n'est ni férié ni en vacances scolaires (une zone au moins)
// → { holiday: 'Ascension' | null, school: [{ name: 'Hiver', zones: 'AC' }, ...] }
export function holidayInfo(date) {
    if (infoCache.has(date)) return infoCache.get(date);
    const holiday = publicHolidays(Number(date.slice(0, 4))).get(date) ?? null;
    const merged = {};
    for (const p of SCHOOL_HOLIDAYS) {
        if (date >= p.start && date < p.end) merged[p.name] = [...new Set([...(merged[p.name] ?? ''), ...p.zones])].sort().join('');
    }
    const school = Object.entries(merged).map(([name, zones]) => ({name, zones}));
    const info = holiday || school.length ? {holiday, school} : null;
    infoCache.set(date, info);
    return info;
}

const zonesLabel = (z) => (z === 'ABC' ? 'toutes zones' : `zone${z.length > 1 ? 's' : ''} ${z.split('').join(', ')}`);

// Texte pour les infobulles
export function holidayText(info) {
    if (!info) return '';
    const parts = [];
    if (info.holiday) parts.push(`Férié : ${info.holiday}`);
    for (const s of info.school) parts.push(`Vacances scolaires : ${s.name} (${zonesLabel(s.zones)})`);
    return parts.join(' — ');
}
