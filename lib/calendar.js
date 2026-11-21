// lib/calendar.js
// Helpers purs partagés par la vue "par logement" et la vue d'ensemble.
import { dailyBasePrice } from '@/lib/dailyPrices';

export const pad2 = (n) => String(n).padStart(2, '0');
export const dateKey = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
export const parseDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (s, n) => { const d = parseDate(s); d.setDate(d.getDate() + n); return dateKey(d); };

// Regroupe des dates en séquences de jours consécutifs : ['2026-12-01','2026-12-02','2026-12-05'] -> [[01,02],[05]]
export function contiguousGroups(dates) {
    const sorted = [...new Set(dates)].sort();
    const groups = [];
    for (const d of sorted) {
        const last = groups[groups.length - 1];
        if (last && addDays(last[last.length - 1], 1) === d) last.push(d);
        else groups.push([d]);
    }
    return groups;
}

export function expandCalendarRanges(ranges, basePriceId = null) {
    const days = [];
    for (const range of ranges) {
        const current = parseDate(range.from);
        const end = parseDate(range.to);
        const dailyPrice = dailyBasePrice(range, basePriceId);
        while (current <= end) {
            days.push({
                date: dateKey(current),
                numAvail: range.numAvail ?? null,
                minStay: range.minStay ?? null,
                maxStay: range.maxStay ?? null,
                override: range.override ?? null,
                dailyPrice,
                price: null,
                priceSource: null,
                multiplier: range.multiplier ?? null,
            });
            current.setDate(current.getDate() + 1);
        }
    }
    return days;
}

export function getDayStatus(day) {
    if (day.override === 'blackout') return 'blocked';
    if (day.bookingStatus === 'black') return 'blocked';
    if (day.numAvail === 0 && !day.bookingStatus) return 'blocked'; // inventaire = 0 sans réservation connue
    if (day.bookingStatus === 'confirmed' || day.bookingStatus === 'new' || day.bookingStatus === 'request') return 'booked';
    return 'available';
}

export const STATUS_COLORS = {
    available: {bg: '#4ade80', text: '#043528'},
    booked: {bg: '#ef4444', text: '#ffffff'},
    blocked: {bg: '#374151', text: '#ffffff'},
};

export const STATUS_LABELS = {
    available: 'Libre',
    booked: 'Réservé',
    blocked: 'Bloqué',
};

// Multiplicateur Beds24 du jour en pourcentage (1 = prix normal -> 100, 1.06 -> 106).
// L'app ne l'utilise plus pour ajuster les prix (voir adjustmentPct) ; il est seulement pris en compte s'il subsiste.
export function multiplierPct(day) {
    const m = Number(day.multiplier);
    return Number.isFinite(m) && m > 0 ? Math.round(m * 100) : 100;
}

// Prix affiché = prix de base (daily price, sinon fixed price) × éventuel multiplicateur résiduel
export function effectivePrice(day) {
    if (day.price == null) return null;
    const pct = multiplierPct(day);
    return pct === 100 ? day.price : Math.round(day.price * pct) / 100;
}

// Ajustement de prix du jour, en % du fixed price (100 = prix du fixed price, 110 = +10 %).
// Sans fixed price connu, on retombe sur le multiplicateur.
export function adjustmentPct(day) {
    const eff = effectivePrice(day);
    if (eff != null && day.fixedPrice > 0) return Math.round(eff / day.fixedPrice * 100);
    return multiplierPct(day);
}

// Prix dans les cases du calendrier : arrondi à l'unité, précédé de « ~ » quand il y a eu arrondi
export function formatCellPrice(p) {
    if (p === null || p === undefined) return '';
    return (Number.isInteger(p) ? '' : '~') + Math.round(p) + '€';
}

export function formatPrice(p) {
    if (p === null || p === undefined) return '';
    return (Number.isInteger(p) ? String(p) : p.toFixed(2).replace('.', ',')) + '€';
}

export function dayTooltip(day, note, extra = '') {
    const status = getDayStatus(day);
    const parts = [`${day.date} — ${STATUS_LABELS[status]}`];
    if (day.minStay) parts.push(`min: ${day.minStay}j`);
    if (day.override) parts.push(`override: ${day.override}`);
    if (day.price != null) {
        const src = day.priceSource === 'daily' ? 'daily price de base' : 'fixed price';
        const fixedInfo = day.priceSource === 'daily' && day.fixedPrice != null ? `, fixed price ${formatPrice(day.fixedPrice)}` : '';
        parts.push(adjustmentPct(day) !== 100
            ? `${formatPrice(effectivePrice(day))} (${src} ${formatPrice(day.price)}${fixedInfo}, ajustement ${adjustmentPct(day)}%)`
            : `${formatPrice(effectivePrice(day))} (${src}${fixedInfo})`);
    }
    if (day.booking) {
        const b = day.booking;
        parts.push(`réservation ${b.arrival} → ${b.departure}${b.guest ? ' — ' + b.guest : ''}${b.channel ? ' (' + b.channel + ')' : ''}`);
    }
    if (extra) parts.push(extra);
    if (note) parts.push(`* ${note}`);
    return parts.join(' — ');
}

export const shortName = (name) => String(name ?? '').split('·')[0].trim() || String(name ?? '');
