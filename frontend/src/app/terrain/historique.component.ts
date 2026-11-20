import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService, messageErreur } from '../core/api.service';
import { SuiviQuotidien } from '../core/models';
import { aujourdHui, decalerJours } from '../core/notification.service';
import { SyncService } from '../core/sync.service';

@Component({
  selector: 'app-historique',
  imports: [RouterLink, DatePipe, DecimalPipe],
  template: `
    <div class="entete-page"><h1>Historique des saisies</h1><span class="muted">30 derniers jours</span></div>
    @if (erreur()) { <p class="erreur-texte">{{ erreur() }}</p> }
    <div class="carte">
      @if (suivis().length === 0) {
        <p class="vide">Aucune saisie sur la période.</p>
      } @else {
        <div class="tableau-defile">
          <table>
            <thead><tr><th>Date</th><th>Lot</th><th class="droite">Œufs</th><th class="droite">Cassés</th><th class="droite">Ponte</th>
              <th class="droite">Décès</th><th class="droite">Aliment</th><th>Saisi par</th><th></th></tr></thead>
            <tbody>
              @for (s of suivis(); track s.id) {
                <tr>
                  <td>{{ s.date | date: 'EEE dd/MM' }}</td>
                  <td>{{ s.lot_nom }}</td>
                  <td class="droite">{{ s.oeufs_intacts | number }}</td>
                  <td class="droite">{{ s.oeufs_casses }}</td>
                  <td class="droite">{{ s.taux_ponte !== null ? (s.taux_ponte | number: '1.0-1') + ' %' : '—' }}</td>
                  <td class="droite">{{ s.nb_deces }}@if (s.motif_deces) { <span class="muted petit"> ({{ s.motif_deces }})</span> }</td>
                  <td class="droite">{{ s.aliment_distribue_kg ?? 0 | number: '1.0-2' }} kg</td>
                  <td class="muted">{{ s.saisi_par_nom }}</td>
                  <td><a class="btn petit" [routerLink]="['/terrain/saisie', s.lot]" [queryParams]="{ date: s.date }">Modifier</a></td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </div>
  `,
})
export class HistoriqueComponent {
  private api = inject(ApiService);
  private sync = inject(SyncService);
  readonly suivis = signal<SuiviQuotidien[]>([]);
  readonly erreur = signal('');

  constructor() {
    effect(() => {
      this.sync.version();
      this.charger();
    });
  }

  async charger() {
    try {
      this.suivis.set(await this.api.get<SuiviQuotidien[]>('/api/suivis/', { debut: decalerJours(aujourdHui(), -30), fin: aujourdHui() }));
    } catch (e) {
      this.erreur.set(messageErreur(e));
    }
  }
}
