// lib/roomData.js
// Chargement côté client des données d'un logement, par morceaux (calendrier, réservations, fixed prices, notes),
// pour pouvoir ne recharger que ce qui a changé.
import { priceForDate } from '@/lib/fixedPrices';
import { expandCalendarRanges, dateKey, parseDate } from '@/lib/calendar';

export const ALL_PARTS = ['calendar', 'bookings', 'fixed', 'notes'];

async function getJson(url) {
    const res = await fetch(url);
    let json = null;
    try { json = await res.json(); } catch { /* corps non JSON */ }
    if (res.status === 429 || json?.code === 429) {
        throw new Error(json?.error ?? "Limite d'appels Beds24 atteinte. Réessaie dans quelques minutes.");
    }
    return json;
}

const failIfError = (json, what) => {
    if (json && json.success === false) throw new Error(`${what} : ${json.error || json.message || 'erreur Beds24'}`);
};

// room : { propId, roomId, hasPriceRules }
export async function fetchRoomParts(room, parts = ALL_PARTS) {
    const q = `propId=${room.propId}&roomId=${room.roomId}`;
    const want = new Set(parts);
    const [cal, book, fixed, notes] = await Promise.all([
        want.has('calendar') ? getJson(`/api/beds24?${q}${room.hasPriceRules ? '&prices=1' : ''}`) : null,
        want.has('bookings') ? getJson(`/api/beds24?${q}&type=bookings`) : null,
        want.has('fixed') ? getJson(`/api/beds24?${q}&type=fixedPrices`) : null,
        want.has('notes') ? getJson(`/api/notes?roomId=${room.roomId}`).catch(() => null) : null,
    ]);
    failIfError(cal, 'Calendrier');
    failIfError(book, 'Réservations');

    const raw = {};
    const debug = {};
    if (cal) { raw.ranges = cal.data?.[0]?.calendar ?? []; debug.calendar = cal; }
    if (book) { raw.bookings = book.data ?? []; debug.bookings = book; }
    if (fixed) { raw.fixedRules = fixed.success && Array.isArray(fixed.data) ? fixed.data : []; debug.fixedPrices = fixed; }
    if (want.has('notes')) raw.notes = notes?.success ? notes.notes : {};
    return {raw, debug};
}

// Assemble les jours à partir des données brutes
export function buildRoomData(raw, basePriceId = null) {
    if (!raw.ranges?.length) return {days: [], error: 'Calendrier vide.'};

    // date -> réservation (les annulées ne bloquent rien : ignorées)
    const bookingMap = {};
    for (const booking of (raw.bookings ?? [])) {
        if (booking.status === 'cancelled') continue;
        const info = {
            id: booking.id,
            status: booking.status,
            arrival: booking.arrival,
            departure: booking.departure,
            channel: booking.channel || '',
            referer: booking.referer || '', // « Original Referrer » (API, avingtier, airbnb…)
            guest: [booking.firstName, booking.lastName].filter(Boolean).join(' '),
        };
        const cur = parseDate(booking.arrival);
        const dep = parseDate(booking.departure);
        while (cur < dep) {
            bookingMap[dateKey(cur)] = info;
            cur.setDate(cur.getDate() + 1);
        }
    }

    const fixedRules = raw.fixedRules ?? [];
    const days = expandCalendarRanges(raw.ranges, basePriceId).map(day => {
        // Daily prices utilisés pour ce jour -> prix de base daily ; sinon fixed price (comportement historique)
        const fixed = day.dailyPrice == null ? priceForDate(fixedRules, day.date) : null;
        return {
            ...day,
            bookingStatus: bookingMap[day.date]?.status ?? null,
            booking: bookingMap[day.date] ?? null,
            price: day.dailyPrice ?? fixed,
            priceSource: day.dailyPrice != null ? 'daily' : (fixed != null ? 'fixed' : null),
        };
    });
    return {days, error: null};
}

// Premier hébergement d'une propriété (avec repli sur un appel dédié si la liste ne contient pas les chambres)
export async function resolveRoom(prop) {
    let room = prop.roomTypes?.[0];
    if (!room?.id) {
        const res = await fetch(`/api/beds24?propId=${prop.id}`);
        const json = await res.json();
        room = json.data?.[0]?.roomTypes?.[0];
    }
    return room?.id
        ? {roomId: room.id, basePriceId: room.basePriceId ?? null, hasPriceRules: !!room.hasPriceRules}
        : null;
}
