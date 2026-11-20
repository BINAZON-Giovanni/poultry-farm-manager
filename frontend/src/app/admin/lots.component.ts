import { CurrencyPipe, DatePipe, DecimalPipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, messageErreur } from '../core/api.service';
import { Lot, ReformePoule } from '../core/models';
import { NotificationService, aujourdHui } from '../core/notification.service';
import { ModaleComponent } from '../shared/modale.component';

/** Module A : gestion des bandes (lots) et du cheptel. */
@Component({
  selector: 'app-lots',
  imports: [FormsModule, DecimalPipe, CurrencyPipe, DatePipe, ModaleComponent],
  template: `
    <div class="entete-page">
      <h1>Lots de poules</h1>
      <button class="btn primaire" type="button" (click)="nouveau()">+ Nouveau lot</button>
    </div>

    <div class="carte">
      @if (lots().length === 0) {
        <div class="vide"><div class="grand">🐔</div>Aucun lot. Créez votre première bande de pondeuses.</div>
      } @else {
        <div class="tableau-defile">
          <table>
            <thead><tr><th>Lot</th><th>Arrivée</th><th class="droite">Âge</th><th class="droite">Initial</th><th class="droite">Décès</th>
              <th class="droite">Réformées</th><th class="droite">Vivantes</th><th class="droite">Ration/j</th><th class="droite">Prix d’achat</th><th>Statut</th><th></th></tr></thead>
            <tbody>
              @for (l of lots(); track l.id) {
                <tr>
                  <td><strong>{{ l.nom }}</strong><br /><span class="muted petit">{{ l.souche }}</span></td>
                  <td>{{ l.date_arrivee | date: 'dd/MM/y' }}<br /><span class="muted petit">à {{ l.age_arrivee_semaines }} sem.</span></td>
                  <td class="droite">{{ l.age_semaines }} sem.<br /><span class="muted petit">{{ l.age_jours }} j</span></td>
                  <td class="droite">{{ l.effectif_initial | number }}</td>
                  <td class="droite">{{ l.total_deces | number }}</td>
                  <td class="droite">{{ l.total_reformes | number }}</td>
                  <td class="droite"><strong>{{ l.effectif_actuel | number }}</strong></td>
                  <td class="droite">{{ l.ration?.kg | number: '1.0-2' }} kg<br /><span class="muted petit">{{ l.ration?.type_aliment_libelle }}</span></td>
                  <td class="droite">{{ l.prix_achat_total | currency: 'EUR' }}</td>
                  <td><span class="badge" [class.vert]="l.statut === 'ACTIF'">{{ l.statut === 'ACTIF' ? 'Actif' : 'Réformé' }}</span></td>
                  <td class="actions">
                    <button class="btn petit" type="button" (click)="modifier(l)">Modifier</button>
                    <button class="btn petit" type="button" (click)="voirReformes(l)">Réformes</button>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </div>

    @if (edition(); as f) {
      <app-modale [titre]="f.id ? 'Modifier le lot' : 'Nouveau lot'" (fermer)="edition.set(null)">
        <form (ngSubmit)="enregistrer(f)">
          <div class="grille deux">
            <div class="champ"><label for="nom">Nom du lot</label><input id="nom" name="nom" [(ngModel)]="f.nom" required placeholder="Bande 2026-A" /></div>
            <div class="champ"><label for="souche">Souche</label><input id="souche" name="souche" [(ngModel)]="f.souche" placeholder="ISA Brown, Lohmann…" /></div>
            <div class="champ"><label for="da">Date d’arrivée</label><input id="da" name="date_arrivee" type="date" [(ngModel)]="f.date_arrivee" required /></div>
            <div class="champ"><label for="age">Âge à l’arrivée (semaines)</label><input id="age" name="age" type="number" min="0" [(ngModel)]="f.age_arrivee_semaines" required /></div>
            <div class="champ"><label for="eff">Effectif initial</label><input id="eff" name="eff" type="number" min="1" [(ngModel)]="f.effectif_initial" required /></div>
            <div class="champ"><label for="prix">Prix d’achat total (€)</label><input id="prix" name="prix" type="number" min="0" step="0.01" [(ngModel)]="f.prix_achat_total" /></div>
          </div>
          <div class="champ"><label for="statut">Statut</label>
            <select id="statut" name="statut" [(ngModel)]="f.statut"><option value="ACTIF">Actif</option><option value="REFORME">Réformé (fin de lot)</option></select></div>
          <div class="champ"><label for="notes">Notes</label><textarea id="notes" name="notes" [(ngModel)]="f.notes" rows="2"></textarea></div>
          <p class="petit muted">Le prix d’achat est enregistré automatiquement comme dépense « Achat poulettes ».</p>
          <p class="erreur-texte">{{ erreur() }}</p>
          <div class="actions-modale">
            @if (f.id) { <button class="btn danger" type="button" (click)="supprimer(f)">Supprimer</button> }
            <button class="btn" type="button" (click)="edition.set(null)">Annuler</button>
            <button class="btn primaire" type="submit">Enregistrer</button>
          </div>
        </form>
      </app-modale>
    }

    @if (reformesLot(); as l) {
      <app-modale [titre]="'Réformes – ' + l.nom" (fermer)="reformesLot.set(null)">
        @if (reformes().length === 0) { <p class="vide">Aucune réforme pour ce lot.</p> }
        <ul class="liste">
          @for (r of reformes(); track r.id) {
            <li><span>{{ r.date | date: 'dd/MM/y' }} · {{ r.quantite_vendue }} poules{{ r.client ? ' · ' + r.client : '' }}
              @if (r.statut_paiement === 'IMPAYE') { <span class="badge accent">Impayé</span> }</span>
              <span>{{ r.prix_total | currency: 'EUR' }}
                <button class="btn icone" type="button" (click)="supprimerReforme(r)" aria-label="Supprimer">🗑</button></span></li>
          }
        </ul>
        <p class="petit muted">Les nouvelles réformes se saisissent dans « Terrain → Ventes ».</p>
      </app-modale>
    }
  `,
})
export class LotsComponent implements OnInit {
  private api = inject(ApiService);
  private notif = inject(NotificationService);
  readonly lots = signal<Lot[]>([]);
  readonly edition = signal<Lot | null>(null);
  readonly erreur = signal('');
  readonly reformesLot = signal<Lot | null>(null);
  readonly reformes = signal<ReformePoule[]>([]);

  ngOnInit() {
    this.charger();
  }

  async charger() {
    try {
      this.lots.set(await this.api.get<Lot[]>('/api/lots/'));
    } catch (e) {
      this.notif.erreur(messageErreur(e));
    }
  }

  nouveau() {
    this.erreur.set('');
    this.edition.set({ nom: '', souche: '', date_arrivee: aujourdHui(), age_arrivee_semaines: 16, effectif_initial: 100,
      prix_achat_total: 0, statut: 'ACTIF', notes: '' });
  }

  modifier(l: Lot) {
    this.erreur.set('');
    this.edition.set({ ...l });
  }

  async enregistrer(f: Lot) {
    try {
      if (f.id) await this.api.put(`/api/lots/${f.id}/`, f);
      else await this.api.post('/api/lots/', f);
      this.edition.set(null);
      this.notif.succes('Lot enregistré');
      this.charger();
    } catch (e) {
      this.erreur.set(messageErreur(e));
    }
  }

  async supprimer(f: Lot) {
    if (!confirm(`Supprimer définitivement le lot « ${f.nom} » et toutes ses saisies (ponte, mortalité, réformes) ?\n\nPour un lot terminé, préférez le statut « Réformé ».`)) return;
    try {
      await this.api.delete(`/api/lots/${f.id}/`);
      this.edition.set(null);
      this.notif.succes('Lot supprimé');
      this.charger();
    } catch (e) {
      this.erreur.set(messageErreur(e));
    }
  }

  async voirReformes(l: Lot) {
    this.reformesLot.set(l);
    this.reformes.set(await this.api.get<ReformePoule[]>('/api/reformes/', { lot: l.id }));
  }

  async supprimerReforme(r: ReformePoule) {
    if (!confirm('Supprimer cette réforme (et la recette associée) ?')) return;
    await this.api.delete(`/api/reformes/${r.id}/`);
    this.voirReformes(this.reformesLot()!);
    this.charger();
  }
}
