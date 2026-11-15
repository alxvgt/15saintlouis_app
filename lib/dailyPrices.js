// lib/dailyPrices.js
// Lecture des "daily prices" Beds24 (Prices -> Daily Price Rules).
//
// Une chambre a jusqu'à 16 prix journaliers (price1..price16). Certaines règles sont LIÉES à une autre
// (priceLinking.priceId renseigné : « prix de base + 16 € » par exemple) ; la règle "de base" est celle
// qui n'est liée à aucune autre. Les emplacements non utilisés ne contiennent que { id }.

// Retourne le numéro (1..16) de la règle de base d'une chambre, ou null si on ne peut pas la deviner
// (aucune règle définie, ou plusieurs règles non liées).
export function findBasePriceId(priceRules) {
    const defined = (priceRules ?? []).filter(r => r && (r.name || r.priceLinking));
    const unlinked = defined.filter(r => r.priceLinking?.priceId == null);
    return unlinked.length === 1 ? unlinked[0].id : null;
}

// Vrai si au moins une daily price rule est définie pour la chambre (sinon inutile de demander les prix au calendrier)
export function hasPriceRules(priceRules) {
    return (priceRules ?? []).some(r => r && (r.name || r.priceLinking));
}

const toNum = (v) => (v === null || v === undefined || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null));

// Prix de base d'une plage du calendrier Beds24 ({ from, to, price1, price2, ... }).
// - règle de base connue : son prix (null si absent pour cette plage)
// - règle de base inconnue : le plus petit des prix journaliers présents
// - aucun prix journalier : null (l'appelant se rabat alors sur les fixed prices)
export function dailyBasePrice(range, baseId) {
    if (baseId != null) return toNum(range[`price${baseId}`]);
    const values = [];
    for (let i = 1; i <= 16; i++) {
        const v = toNum(range[`price${i}`]);
        if (v !== null) values.push(v);
    }
    return values.length ? Math.min(...values) : null;
}
