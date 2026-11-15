// lib/theme.js
// Couleurs (pastel) par logement, utilisées partout dans l'app.
const THEMES = {
    evariste: {
        accent: '#b08a63',   // marron clair
        button: '#dcc3a3',
        buttonText: '#4a2f17',
        nameBg: '#d8bc98',
        rowBg: 'rgba(216, 188, 152, 0.22)',
    },
    grenier: {
        accent: '#6fb585',   // vert
        button: '#bfe3c9',
        buttonText: '#17402a',
        nameBg: '#b9dfc3',
        rowBg: 'rgba(185, 223, 195, 0.20)',
    },
    default: {
        accent: '#94a3b8',
        button: '#dbe3ee',
        buttonText: '#1e293b',
        nameBg: '#cbd5e1',
        rowBg: 'rgba(203, 213, 225, 0.18)',
    },
};

const BY_ID = {315024: 'evariste', 368178: 'grenier'};

// `item` : propriété ({id, name}) ou logement ({propId, name})
export function themeFor(item) {
    const id = Number(item?.id ?? item?.propId);
    const name = String(item?.name ?? '');
    const key = BY_ID[id]
        ?? (/[ée]variste/i.test(name) ? 'evariste' : /grenier/i.test(name) ? 'grenier' : 'default');
    return THEMES[key];
}
