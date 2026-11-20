import { Injectable, signal } from '@angular/core';

export interface Notification {
  texte: string;
  type: 'succes' | 'erreur' | 'info';
}

@Injectable({ providedIn: 'root' })
export class NotificationService {
  readonly courante = signal<Notification | null>(null);
  private minuteur?: ReturnType<typeof setTimeout>;

  succes(texte: string) {
    this.afficher({ texte, type: 'succes' });
  }
  erreur(texte: string) {
    this.afficher({ texte, type: 'erreur' }, 6000);
  }
  info(texte: string) {
    this.afficher({ texte, type: 'info' });
  }

  private afficher(n: Notification, duree = 3500) {
    clearTimeout(this.minuteur);
    this.courante.set(n);
    this.minuteur = setTimeout(() => this.courante.set(null), duree);
  }
}

/** Date du jour au format AAAA-MM-JJ (heure locale). */
export function aujourdHui(): string {
  return isoDate(new Date());
}

export function isoDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function decalerJours(iso: string, jours: number): string {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + jours);
  return isoDate(d);
}
