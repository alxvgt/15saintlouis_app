'use client';
import {useEffect, useRef} from 'react';
import {attachTouchRangeSelect} from '@/lib/touchRangeSelect';

// Branche la sélection tactile (appui long + glisse) sur le conteneur `containerRef`.
// Retourne `justEnded()` pour ignorer le clic qui suit une sélection.
export function useTouchRangeSelect(containerRef, handlers, active = true, config = {}) {
    const latest = useRef(handlers);
    latest.current = handlers;
    const api = useRef(null);

    useEffect(() => {
        const el = containerRef.current;
        if (!el || !active) return;
        api.current = attachTouchRangeSelect(el, () => latest.current, config);
        return () => api.current?.detach();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [containerRef, active, config.autoScroll]);

    return {justEnded: () => api.current?.justEnded() ?? false};
}
