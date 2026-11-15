// lib/touchRangeSelect.js
// Sélection tactile « appui long puis glisse » sur une grille de cases.
//
// Cases : éléments portant data-cell, data-room et data-date.
// - appui long (sans bouger) sur une case : démarre le mode sélection (vibration légère si disponible).
//   Si la case était sélectionnée → mode "remove" (on désélectionne au survol), sinon mode "add".
// - glisser : chaque case survolée est ajoutée / retirée ; les cases sautées (doigt rapide) sont comblées
//   par le code appelant grâce à `prev`. Le défilement de la page est bloqué pendant la sélection, et le
//   conteneur défile tout seul quand le doigt approche de son bord gauche/droit.
// - relever le doigt termine le mode et empêche le « clic » synthétique qui re-basculerait la dernière case.
// - bouger avant la fin de l'appui long = simple défilement, rien n'est sélectionné.
//
// config.autoScroll : 'x' (défaut) = le conteneur défile horizontalement près de ses bords gauche/droit ;
//                     'y' = la page défile verticalement près du haut/bas de l'écran (grille en colonne).
//
// getHandlers() → { isSelected(cell), onCell(cell, mode, prevCell|null), onActiveChange(bool) }
// (une fonction, pour toujours lire les dernières valeurs d'un composant React)

export function attachTouchRangeSelect(el, getHandlers, config = {}) {
    const {
        longPressMs = 350,
        moveTolerance = 10,
        edge = 56,
        edgeTop = 170,   // mode 'y' : zone haute plus large (le panneau d'actions est collé en haut)
        edgeBottom = 90,
        scrollSpeed = 14,
        autoScroll: axis = 'x',
        elementFromPoint = (x, y) => document.elementFromPoint(x, y),
    } = config;

    let timer = null;
    let active = false;
    let mode = null;
    let start = null;
    let lastPoint = null;
    let lastCell = null;
    let raf = null;
    let endedAt = 0;

    const pick = (x, y) => {
        const cell = elementFromPoint(x, y)?.closest?.('[data-cell]');
        return cell ? {room: cell.dataset.room, date: cell.dataset.date} : null;
    };

    const apply = (cell) => {
        if (!cell || (lastCell && lastCell.room === cell.room && lastCell.date === cell.date)) return;
        getHandlers().onCell(cell, mode, lastCell && lastCell.room === cell.room ? lastCell : null);
        lastCell = cell;
    };

    const autoScroll = () => {
        if (!active) return;
        if (lastPoint) {
            let moved = false;
            if (axis === 'y') {
                const dy = lastPoint.y > window.innerHeight - edgeBottom ? scrollSpeed : lastPoint.y < edgeTop ? -scrollSpeed : 0;
                if (dy) { window.scrollBy(0, dy); moved = true; }
            } else {
                const r = el.getBoundingClientRect();
                const dx = lastPoint.x > r.right - edge ? scrollSpeed : lastPoint.x < r.left + edge ? -scrollSpeed : 0;
                if (dx) { el.scrollLeft += dx; moved = true; }
            }
            if (moved) apply(pick(lastPoint.x, lastPoint.y));
        }
        raf = requestAnimationFrame(autoScroll);
    };

    const finish = () => {
        clearTimeout(timer);
        timer = null;
        if (active) {
            active = false;
            mode = null;
            lastCell = null;
            endedAt = Date.now();
            if (raf) cancelAnimationFrame(raf);
            raf = null;
            getHandlers().onActiveChange(false);
        }
    };

    const onTouchStart = (e) => {
        finish();
        if (e.touches.length !== 1) return;
        const t = e.touches[0];
        const cell = pick(t.clientX, t.clientY);
        if (!cell) return;
        start = {x: t.clientX, y: t.clientY};
        lastPoint = {...start};
        timer = setTimeout(() => {
            timer = null;
            active = true;
            mode = getHandlers().isSelected(cell) ? 'remove' : 'add';
            lastCell = null;
            apply(cell);
            if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(12);
            getHandlers().onActiveChange(true);
            raf = requestAnimationFrame(autoScroll);
        }, longPressMs);
    };

    const onTouchMove = (e) => {
        const t = e.touches[0];
        if (!t) return;
        if (active) {
            e.preventDefault(); // bloque le défilement pendant la sélection
            lastPoint = {x: t.clientX, y: t.clientY};
            apply(pick(t.clientX, t.clientY));
        } else if (timer && Math.hypot(t.clientX - start.x, t.clientY - start.y) > moveTolerance) {
            clearTimeout(timer); // le doigt a bougé : c'est un défilement
            timer = null;
        }
    };

    const onTouchEnd = (e) => {
        if (active && e.cancelable) e.preventDefault(); // pas de clic synthétique après la sélection
        finish();
    };

    // Menu contextuel natif déclenché par l'appui long (Android) : inutile ici
    const onContextMenu = (e) => e.preventDefault();

    el.addEventListener('touchstart', onTouchStart, {passive: true});
    el.addEventListener('touchmove', onTouchMove, {passive: false}); // non passif : requis pour preventDefault
    el.addEventListener('touchend', onTouchEnd, {passive: false});
    el.addEventListener('touchcancel', finish, {passive: true});
    el.addEventListener('contextmenu', onContextMenu);

    return {
        // vrai juste après une sélection tactile : le composant ignore alors le clic éventuel
        justEnded: () => Date.now() - endedAt < 400,
        detach: () => {
            finish();
            el.removeEventListener('touchstart', onTouchStart);
            el.removeEventListener('touchmove', onTouchMove);
            el.removeEventListener('touchend', onTouchEnd);
            el.removeEventListener('touchcancel', finish);
            el.removeEventListener('contextmenu', onContextMenu);
        },
    };
}
