// lib/bookingRules.js
// Règle d'annulation : seules les réservations créées par l'app peuvent être annulées depuis l'app.
// Beds24 refuse de supprimer une réservation active ; on la passe donc au statut "cancelled".
// On compare le champ « Original Referrer » de Beds24 (`referer` dans l'API).
export const CANCELLABLE_REFERERS = ['api', 'avingtier'];

export const refererOf = (booking) => String(booking?.referer ?? '').trim().toLowerCase();

export const isCancellable = (booking) =>
    !!booking && booking.status !== 'cancelled' && CANCELLABLE_REFERERS.includes(refererOf(booking));
