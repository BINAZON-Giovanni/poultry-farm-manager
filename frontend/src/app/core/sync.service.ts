import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { estErreurReseau, messageErreur } from './api.service';

const CLE_FILE = 'poulailler.file-attente';
const CLE_ECHECS = 'poulailler.echecs-synchro';

export interface SaisieEnAttente {
  id: string;
  methode: 'POST' | 'PATCH';
  url: string;
  corps: Record<string, unknown>;
  libelle: string;
  creeLe: string;
}

export interface EchecSynchro extends SaisieEnAttente {
  erreur: string;
}

export type ResultatEnvoi<T> = { enLigne: true; data: T } | { enLigne: false };

/**
 * Saisie hors-ligne (tablette au poulailler).
 * Si le réseau est coupé, la saisie est mise en file d'attente (localStorage) puis envoyée
 * automatiquement au retour de la connexion. Chaque création porte un `client_uuid`
 * pour que le serveur ne l'enregistre qu'une fois, même si elle est rejouée.
 */
@Injectable({ providedIn: 'root' })
export class SyncService {
  private http = inject(HttpClient);

  readonly enLigne = signal(typeof navigator === 'undefined' ? true : navigator.onLine);
  readonly file = signal<SaisieEnAttente[]>(lireJson(CLE_FILE, []));
  readonly echecs = signal<EchecSynchro[]>(lireJson(CLE_ECHECS, []));
  readonly nbEnAttente = computed(() => this.file().length);
  readonly synchronisationEnCours = signal(false);
  /** Incrémenté après chaque synchronisation réussie : les écrans peuvent recharger leurs données. */
  readonly version = signal(0);

  constructor() {
    if (typeof window === 'undefined') return;
    window.addEventListener('online', () => {
      this.enLigne.set(true);
      this.synchroniser();
    });
    window.addEventListener('offline', () => this.enLigne.set(false));
    setInterval(() => this.synchroniser(), 30_000);
    setTimeout(() => this.synchroniser(), 1_000);
  }

  /** Envoie la saisie tout de suite si possible, sinon la met en file d'attente. */
  async envoyer<T>(methode: 'POST' | 'PATCH', url: string, corps: Record<string, unknown>, libelle: string): Promise<ResultatEnvoi<T>> {
    if (methode === 'POST' && !corps['client_uuid']) corps = { ...corps, client_uuid: uuid() };
    try {
      const data = await firstValueFrom(this.http.request<T>(methode, url, { body: corps }));
      this.enLigne.set(true);
      return { enLigne: true, data };
    } catch (e) {
      if (!estErreurReseau(e)) throw e; // erreur de validation : à corriger par l'utilisateur
      this.enLigne.set(false);
      this.ajouter({ id: uuid(), methode, url, corps, libelle, creeLe: new Date().toISOString() });
      return { enLigne: false };
    }
  }

  async synchroniser(): Promise<void> {
    if (this.synchronisationEnCours() || this.file().length === 0) return;
    this.synchronisationEnCours.set(true);
    let envoyes = 0;
    try {
      for (const item of [...this.file()]) {
        try {
          await firstValueFrom(this.http.request(item.methode, item.url, { body: item.corps }));
          envoyes++;
        } catch (e) {
          if (estErreurReseau(e)) {
            this.enLigne.set(false);
            break; // toujours hors-ligne : on réessaiera plus tard
          }
          if (e instanceof HttpErrorResponse && e.status === 401) break; // reconnexion nécessaire
          // Refus du serveur (validation) : on met de côté pour que l'utilisateur corrige
          this.echecs.update((l) => [...l, { ...item, erreur: messageErreur(e) }]);
          sauver(CLE_ECHECS, this.echecs());
        }
        this.file.update((l) => l.filter((x) => x.id !== item.id));
        sauver(CLE_FILE, this.file());
        this.enLigne.set(true);
      }
    } finally {
      this.synchronisationEnCours.set(false);
      if (envoyes) this.version.update((v) => v + 1);
    }
  }

  /** Saisies du jour encore en attente pour un lot (affichage sur la tablette). */
  suiviEnAttente(lotId: number, date: string): SaisieEnAttente | undefined {
    return this.file().find((i) => i.url.startsWith('/api/suivis/') && i.corps['lot'] === lotId && i.corps['date'] === date);
  }

  ignorerEchec(id: string): void {
    this.echecs.update((l) => l.filter((x) => x.id !== id));
    sauver(CLE_ECHECS, this.echecs());
  }

  private ajouter(item: SaisieEnAttente): void {
    // Une nouvelle saisie du même lot et du même jour remplace l'ancienne en attente
    const lot = item.corps['lot'];
    const date = item.corps['date'];
    this.file.update((l) => [
      ...l.filter((x) => !(item.url === '/api/suivis/' && x.url === item.url && x.corps['lot'] === lot && x.corps['date'] === date)),
      item,
    ]);
    sauver(CLE_FILE, this.file());
  }
}

export function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  // Repli pour les navigateurs anciens / contexte non sécurisé (http sur le réseau local)
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function lireJson<T>(cle: string, defaut: T): T {
  try {
    const v = localStorage.getItem(cle);
    return v ? (JSON.parse(v) as T) : defaut;
  } catch {
    return defaut;
  }
}

function sauver(cle: string, valeur: unknown): void {
  try {
    localStorage.setItem(cle, JSON.stringify(valeur));
  } catch {
    /* ignore */
  }
}
