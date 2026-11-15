// Indicateur de chargement animé (spinner)
export default function Loader({size = 40, color = '#4ade80', label = 'Chargement'}) {
    const border = Math.max(3, Math.round(size / 9));
    return (
        <div role="status" aria-label={label}
             style={{display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '1.5rem 0'}}>
            <style>{'@keyframes sl-spin { to { transform: rotate(360deg); } }'}</style>
            <div style={{
                width: size, height: size, boxSizing: 'border-box', borderRadius: '50%',
                border: `${border}px solid rgba(255, 255, 255, 0.2)`, borderTopColor: color,
                animation: 'sl-spin 0.8s linear infinite',
            }}/>
        </div>
    );
}
