import { NextResponse } from 'next/server';

export function middleware(request) {
    const { pathname } = request.nextUrl;

    const isAuthPage = pathname.startsWith('/login') || pathname.startsWith('/api/auth');
    const isPublicFile = pathname.includes('.');
    const isAuthenticated = request.cookies.get('auth_session');

    // Si l'utilisateur n'est pas connecté et tente d'accéder à une page protégée
    if (!isAuthenticated && !isAuthPage && !isPublicFile) {
        const url = new URL('/login', request.url);
        // On utilise un redirect standard (302/303) pour s'assurer que le navigateur
        // repasse en méthode GET sur la page de destination
        return NextResponse.redirect(url);
    }

    // Si l'utilisateur est connecté et tente d'aller sur login
    if (isAuthenticated && isAuthPage && pathname === '/login') {
        return NextResponse.redirect(new URL('/', request.url));
    }

    return NextResponse.next();
}

export const config = {
    matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};