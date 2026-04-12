'use client';
import { startRegistration, startAuthentication } from '@simplewebauthn/browser';
import { useEffect, useState } from 'react';

export default function LoginPage() {
    const [registerAllowed, setRegisterAllowed] = useState(false);

    useEffect(() => {
        fetch('/api/auth/register')
            .then(res => setRegisterAllowed(res.status !== 403))
            .catch(() => setRegisterAllowed(false));
    }, []);
    const handleRegister = async () => {
        try {
            const res = await fetch('/api/auth/register');
            const options = await res.json();
            const regResp = await startRegistration(options);

            const verificationRes = await fetch('/api/auth/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(regResp),
            });

            if (verificationRes.ok) alert('Appareil enregistré !');
        } catch (err) {
            console.error(err);
            alert('Erreur enregistrement: ' + err.message);
        }
    };

    const handleLogin = async () => {
        try {
            const res = await fetch('/api/auth/login');
            const options = await res.json();

            // DEBUG pour voir si l'ID arrive bien dans le navigateur
            console.log("Options de connexion:", options);

            const authResp = await startAuthentication(options);

            const verificationRes = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(authResp),
            });

            if (verificationRes.ok) {
                window.location.href = '/';
            } else {
                alert('Échec de la connexion');
            }
        } catch (err) {
            console.error(err);
            alert('Erreur login: ' + err.message);
        }
    };

    return (
        <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100vh',
            gap: '1rem',
            fontFamily: 'sans-serif'
        }}>
            <h1>Le 15 Saint-Louis</h1>
            <button
                onClick={handleLogin}
                style={{ padding: '15px 30px', fontSize: '1.2rem', cursor: 'pointer', backgroundColor: '#0070f3', color: 'white', border: 'none', borderRadius: '8px' }}
            >
                Se connecter
            </button>

            {registerAllowed && (
            <button
                onClick={handleRegister}
                style={{ padding: '10px 20px', cursor: 'pointer', backgroundColor: '#eaeaea', border: 'none', borderRadius: '5px' }}
            >
                Enregistrer un nouvel appareil
            </button>
    )}
        </div>
    );
}