import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { Utilisateur } from './models';

const CLE_TOKEN = 'poulailler.token';
const CLE_USER = 'poulailler.utilisateur';

/** Connexion par token (DRF). Le token est conservé pour permettre l'usage hors-ligne sur la tablette. */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private http = inject(HttpClient);
  private router = inject(Router);

  readonly utilisateur = signal<Utilisateur | null>(lire(CLE_USER));
  readonly estConnecte = computed(() => !!this.utilisateur() && !!this.token);
  readonly estAdmin = computed(() => this.utilisateur()?.role === 'admin');

  get token(): string | null {
    try {
      return localStorage.getItem(CLE_TOKEN);
    } catch {
      return null;
    }
  }

  async connexion(username: string, password: string): Promise<Utilisateur> {
    const r = await firstValueFrom(
      this.http.post<{ token: string; utilisateur: Utilisateur }>('/api/auth/connexion/', { username, password }),
    );
    localStorage.setItem(CLE_TOKEN, r.token);
    localStorage.setItem(CLE_USER, JSON.stringify(r.utilisateur));
    this.utilisateur.set(r.utilisateur);
    return r.utilisateur;
  }

  async deconnexion(): Promise<void> {
    try {
      await firstValueFrom(this.http.post('/api/auth/deconnexion/', {}));
    } catch {
      /* hors-ligne : on efface quand même la session locale */
    }
    this.oublier();
    this.router.navigateByUrl('/connexion');
  }

  /** Efface la session locale (token expiré ou révoqué). */
  oublier(): void {
    localStorage.removeItem(CLE_TOKEN);
    localStorage.removeItem(CLE_USER);
    this.utilisateur.set(null);
  }

  accueil(): string {
    return this.estAdmin() ? '/pilotage' : '/terrain';
  }
}

function lire<T>(cle: string): T | null {
  try {
    const v = localStorage.getItem(cle);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
}
