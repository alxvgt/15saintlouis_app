// Couleurs du liseré des jours spéciaux : jour férié = violet, vacances scolaires = le même violet à 50 % d'opacité
export const HOLIDAY_COLORS = {school: 'rgba(109, 40, 217, 0.5)', public: '#6d28d9'};

// Liseré en bas d'une case (le férié l'emporte sur les vacances). À placer dans un élément `position: relative`.
// `height` et `radius` : nombre (px) ou chaîne CSS (ex. 'calc(var(--cell) * 0.09)')
export function HolidayStripe({info, height = 5, radius = 6}) {
    const kind = info?.holiday ? 'public' : info?.school?.length ? 'school' : null;
    if (!kind) return null;
    return (
        <span style={{
            position: 'absolute', left: 0, right: 0, bottom: 0, height, pointerEvents: 'none',
            backgroundColor: HOLIDAY_COLORS[kind],
            borderRadius: typeof radius === 'number' ? `0 0 ${radius}px ${radius}px` : `0 0 ${radius} ${radius}`,
        }}/>
    );
}

function Swatch({color, stripe}) {
    return (
        <div style={{width: '12px', height: '12px', backgroundColor: color, borderRadius: '3px', position: 'relative'}}>
            {stripe && <span style={{
                position: 'absolute', left: 0, right: 0, bottom: 0, height: '4px', backgroundColor: stripe, borderRadius: '0 0 3px 3px',
            }}/>}
        </div>
    );
}

export default function Legend() {
    const items = [
        ['#4ade80', 'Libre'],
        ['#ef4444', 'Réservé'],
        ['#1a202c', 'Bloqué'],
        ['#f59e0b', 'Sélectionné'],
    ];
    return (
        <div style={{display: 'flex', justifyContent: 'center', gap: '15px', fontSize: '0.8rem', flexWrap: 'wrap'}}>
            {items.map(([color, text]) => (
                <div key={text} style={{display: 'flex', alignItems: 'center', gap: '5px'}}>
                    <Swatch color={color}/>
                    {text}
                </div>
            ))}
            <div style={{display: 'flex', alignItems: 'center', gap: '5px'}}>
                <Swatch color="#9ca3af" stripe={HOLIDAY_COLORS.school}/>
                Vacances scolaires
            </div>
            <div style={{display: 'flex', alignItems: 'center', gap: '5px'}}>
                <Swatch color="#9ca3af" stripe={HOLIDAY_COLORS.public}/>
                Jour férié
            </div>
        </div>
    );
}
