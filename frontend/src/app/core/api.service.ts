import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

const PREFIXE_CACHE = 'poulailler.cache:';

export type Params = Record<string, string | number | boolean | null | undefined>;

/**
 * Accès à l'API REST Django.
 * Les lectures sont mises en cache localement : hors-ligne, la tablette affiche la dernière version connue.
 */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient);

  async get<T>(url: string, params?: Params): Promise<T> {
    const p = toParams(params);
    const cle = PREFIXE_CACHE + url + '?' + p.toString();
    try {
      const data = await firstValueFrom(this.http.get<T>(url, { params: p }));
      try {
        localStorage.setItem(cle, JSON.stringify({ t: Date.now(), data }));
      } catch {
        /* stockage plein : pas grave */
      }
      return data;
    } catch (e) {
      if (estErreurReseau(e)) {
        const cache = localStorage.getItem(cle);
        if (cache) return JSON.parse(cache).data as T;
      }
      throw e;
    }
  }

  post<T>(url: string, body: unknown): Promise<T> {
    return firstValueFrom(this.http.post<T>(url, body));
  }

  put<T>(url: string, body: unknown): Promise<T> {
    return firstValueFrom(this.http.put<T>(url, body));
  }

  patch<T>(url: string, body: unknown): Promise<T> {
    return firstValueFrom(this.http.patch<T>(url, body));
  }

  delete(url: string): Promise<unknown> {
    return firstValueFrom(this.http.delete(url));
  }

  viderCache(): void {
    Object.keys(localStorage)
      .filter((k) => k.startsWith(PREFIXE_CACHE))
      .forEach((k) => localStorage.removeItem(k));
  }
}

function toParams(params?: Params): HttpParams {
  let p = new HttpParams();
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v !== null && v !== undefined && v !== '') p = p.set(k, String(v));
  }
  return p;
}

export function estErreurReseau(e: unknown): boolean {
  return e instanceof HttpErrorResponse && (e.status === 0 || e.status === 502 || e.status === 503 || e.status === 504);
}

/** Transforme une erreur DRF ({champ: [messages]} ou {detail}) en texte lisible. */
export function messageErreur(e: unknown): string {
  if (estErreurReseau(e)) return 'Serveur injoignable. Vérifiez la connexion.';
  if (e instanceof HttpErrorResponse) {
    const err = e.error;
    if (typeof err === 'string') return err.length < 200 ? err : `Erreur ${e.status}`;
    if (err?.detail) return err.detail;
    if (Array.isArray(err)) return err.join(' ');
    if (err && typeof err === 'object') {
      return Object.entries(err)
        .map(([champ, msg]) => {
          const texte = Array.isArray(msg) ? msg.join(' ') : String(msg);
          return champ === 'non_field_errors' ? texte : `${champ.replaceAll('_', ' ')} : ${texte}`;
        })
        .join(' — ');
    }
    return `Erreur ${e.status}`;
  }
  return e instanceof Error ? e.message : 'Erreur inattendue';
}
