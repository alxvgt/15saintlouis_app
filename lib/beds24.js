// lib/beds24.js
const BEDS24_API_URL = 'https://api.beds24.com/v2';

export async function getAccessToken() {
    const refreshToken = process.env.BEDS24_REFRESH_TOKEN;

    if (!refreshToken) {
        throw new Error("BEDS24_REFRESH_TOKEN manquant dans le .env");
    }

    // On appelle /authentication/token avec le Refresh Token dans le header
    const response = await fetch(`${BEDS24_API_URL}/authentication/token`, {
        method: 'GET',
        headers: {
            'accept': 'application/json',
            'refreshToken': refreshToken // C'est ici que l'échange se fait
        },
        next: { revalidate: 3600 } // On met en cache 1h pour éviter de saturer l'API
    });

    const data = await response.json();

    if (!response.ok || !data.token) {
        console.error("Détails Erreur Auth (Refresh -> Access):", data);
        throw new Error('Impossible de générer un Access Token valide');
    }

    return data.token;
}

export async function beds24Fetch(endpoint, options = {}) {
    const accessToken = await getAccessToken();

    const res = await fetch(`${BEDS24_API_URL}${endpoint}`, {
        ...options,
        headers: {
            ...options.headers,
            'accept': 'application/json',
            'token': accessToken, // On utilise l'Access Token ici
            'Content-Type': 'application/json'
        }
    });

    return res.json();
}