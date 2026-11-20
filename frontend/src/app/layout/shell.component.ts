import { Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { NotificationService } from '../core/notification.service';
import { SyncService } from '../core/sync.service';

interface Lien {
  url: string;
  libelle: string;
  icone: string;
}

const ICONES: Record<string, string> = {
  accueil: 'M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  oeuf: 'M12 3c3.9 0 7 6.1 7 10.5S15.9 21 12 21s-7-3.1-7-7.5S8.1 3 12 3z',
  vente: 'M4 7h16l-1.5 11a2 2 0 0 1-2 1.7h-9a2 2 0 0 1-2-1.7zM9 7V5a3 3 0 0 1 6 0v2',
  histo: 'M12 7v5l3 2M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5',
  pilotage: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  lots: 'M16 11a4 4 0 1 0-8 0M3 20c0-3.3 4-5 9-5s9 1.7 9 5',
  ration: 'M4 10h16M6 10l1.5 10h9L18 10M9 6c0-1.7 1.3-3 3-3s3 1.3 3 3',
  stock: 'M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10',
  finances: 'M12 2v20M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6',
  utilisateurs: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21c0-3.9 3.1-6 7-6s7 2.1 7 6M17 11a3 3 0 1 0 0-6M22 21c0-2.9-1.8-4.7-4.5-5.5',
  compte: 'M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM3 22c0-4.4 4-7 9-7s9 2.6 9 7',
};

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <div class="layout" [class.tablette]="!auth.estAdmin()">
      <nav class="barre-nav" aria-label="Navigation principale">
        <div class="marque"><img src="icons/icon-96x96.png" alt="" width="34" height="34" /> Mon Poulailler</div>
        <div class="liens">
          @for (l of liens(); track l.url) {
            <a [routerLink]="l.url" routerLinkActive="actif">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path [attr.d]="icones[l.icone]" />
              </svg>
              <span>{{ l.libelle }}</span>
            </a>
          }
        </div>
        <div class="pied-nav">
          <div class="muted petit">{{ auth.utilisateur()?.nom }} · {{ auth.estAdmin() ? 'Administrateur' : 'Exploitant' }}</div>
          <button class="btn petit" type="button" (click)="auth.deconnexion()">Se déconnecter</button>
        </div>
      </nav>

      <main>
        @if (!sync.enLigne() || sync.nbEnAttente() > 0) {
          <div class="bandeau" [class.hors-ligne]="!sync.enLigne()">
            @if (!sync.enLigne()) {
              <strong>Hors-ligne.</strong> Vos saisies sont enregistrées sur la tablette.
            }
            @if (sync.nbEnAttente() > 0) {
              <span>{{ sync.nbEnAttente() }} saisie(s) en attente d'envoi.</span>
              @if (sync.enLigne()) {
                <button class="btn petit" type="button" (click)="sync.synchroniser()" [disabled]="sync.synchronisationEnCours()">Envoyer maintenant</button>
              }
            }
          </div>
        }
        @for (e of sync.echecs(); track e.id) {
          <div class="bandeau erreur">
            <span><strong>Saisie refusée par le serveur</strong> ({{ e.libelle }}) : {{ e.erreur }}</span>
            <button class="btn petit" type="button" (click)="sync.ignorerEchec(e.id)">J'ai compris</button>
          </div>
        }
        <router-outlet />
      </main>
    </div>

    @if (notif.courante(); as n) {
      <div class="toast" [class]="'toast ' + n.type" role="status">{{ n.texte }}</div>
    }
  `,
})
export class ShellComponent {
  readonly auth = inject(AuthService);
  readonly sync = inject(SyncService);
  readonly notif = inject(NotificationService);
  readonly icones = ICONES;

  readonly liens = computed<Lien[]>(() => {
    const terrain: Lien[] = [
      { url: '/terrain', libelle: 'Aujourd’hui', icone: 'accueil' },
      { url: '/terrain/ventes', libelle: 'Ventes', icone: 'vente' },
      { url: '/terrain/historique', libelle: 'Historique', icone: 'histo' },
    ];
    if (!this.auth.estAdmin()) return [...terrain, { url: '/compte', libelle: 'Compte', icone: 'compte' }];
    return [
      { url: '/pilotage', libelle: 'Pilotage', icone: 'pilotage' },
      { url: '/terrain', libelle: 'Terrain', icone: 'accueil' },
      { url: '/lots', libelle: 'Lots', icone: 'lots' },
      { url: '/rations', libelle: 'Rations', icone: 'ration' },
      { url: '/stock', libelle: 'Stock', icone: 'stock' },
      { url: '/finances', libelle: 'Finances', icone: 'finances' },
      { url: '/utilisateurs', libelle: 'Utilisateurs', icone: 'utilisateurs' },
      { url: '/compte', libelle: 'Compte', icone: 'compte' },
    ];
  });
}
