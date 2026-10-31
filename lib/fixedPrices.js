// lib/fixedPrices.js
// Lecture seule des "fixed prices" Beds24 : déterminer le prix de base d'une nuit.
//
// Modèle Beds24 : un fixed price est une RÈGLE valable sur une période [firstNight, lastNight],
// pour certains jours de la semaine (allowedDays), avec un prix par nuit (roomPrice).
// L'app ne modifie jamais ces règles.

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DAY_MS = 86400000;

const toUTC = (s) => {
    const [y, m, d] = s.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
};

const dayKey = (s) => DAY_KEYS[new Date(toUTC(s)).getUTCDay()];

function dayAllowed(rule, date) {
    return rule.allowedDays ? !!rule.allowedDays[dayKey(date)] : true;
}

function ruleCovers(rule, date) {
    return rule.roomPriceEnable !== false
        && rule.firstNight <= date && date <= rule.lastNight
        && dayAllowed(rule, date);
}

// Prix de base de la nuit qui commence à `date` (null si aucune règle ne la couvre).
// Si plusieurs règles la couvrent (cas anormal), on retient la plus étroite, puis la plus récente.
export function priceForDate(rules, date) {
    const matches = (rules ?? []).filter(r => ruleCovers(r, date));
    if (matches.length === 0) return null;
    matches.sort((a, b) =>
        (toUTC(a.lastNight) - toUTC(a.firstNight)) - (toUTC(b.lastNight) - toUTC(b.firstNight))
        || (b.id ?? 0) - (a.id ?? 0));
    const price = Number(matches[0].roomPrice);
    return Number.isFinite(price) ? price : null;
}
