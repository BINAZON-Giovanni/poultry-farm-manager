import { CurrencyPipe, DatePipe, DecimalPipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, messageErreur } from '../core/api.service';
import { Choix, EtatStock, ListesChoix, MouvementStock } from '../core/models';
import { NotificationService, aujourdHui, decalerJours } from '../core/notification.service';
import { ModaleComponent } from '../shared/modale.component';

/** Module B : stock d'aliment (achats de sacs, sorties automatiques des distributions, ajustements). */
@Component({
  selector: 'app-stock',
  imports: [FormsModule, DecimalPipe, CurrencyPipe, DatePipe, ModaleComponent],
  template: `
    <div class="entete-page">
      <h1>Stock d’aliment</h1>
      <div class="actions">
        <button class="btn" type="button" (click)="ouvrir('SORTIE')">Ajustement / inventaire</button>
        <button class="btn primaire" type="button" (click)="ouvrir('ENTREE')">+ Achat d’aliment</button>
      </div>
    </div>

    @if (etat(); as e) {
      <div class="grille stats">
        <div class="carte stat" [class.alerte]="e.alerte"><div class="libelle">Stock total</div>
          <div class="valeur">{{ e.total_kg | number: '1.0-0' }} <small>kg</small></div>
          <div class="sous">Seuil d’alerte : {{ e.seuil_alerte_kg | number }} kg</div></div>
        <div class="carte stat"><div class="libelle">Consommation prévue</div>
          <div class="valeur">{{ e.ration_totale_jour_kg | number: '1.0-1' }} <small>kg/j</small></div>
          <div class="sous">@if (e.jours_restants !== null) { ≈ {{ e.jours_restants | number: '1.0-0' }} jours d’autonomie }</div></div>
        @for (t of e.par_type; track t.type_aliment) {
          <div class="carte stat" [class.alerte]="t.alerte"><div class="libelle">{{ t.libelle }}</div>
            <div class="valeur">{{ t.stock_kg | number: '1.0-0' }} <small>kg</small></div>
            <div class="sous">@if (t.ration_jour_kg) { {{ t.ration_jour_kg | number: '1.0-1' }} kg/j · ≈ {{ t.jours_restants | number: '1.0-0' }} j } @else { non utilisé actuellement }
              @if (t.alerte) { <strong> · à racheter</strong> }</div></div>
        }
      </div>
    }

    <div class="carte">
      <div class="ligne-entre">
        <h2>Mouvements</h2>
        <div class="filtres">
          <select [(ngModel)]="filtreType" (change)="charger()" aria-label="Type de mouvement">
            <option value="">Tous</option><option value="ENTREE">Entrées</option><option value="SORTIE">Sorties</option>
          </select>
          <input type="date" [(ngModel)]="debut" (change)="charger()" aria-label="Depuis" />
        </div>
      </div>
      <div class="tableau-defile">
        <table>
          <thead><tr><th>Date</th><th>Mouvement</th><th>Aliment</th><th class="droite">Quantité</th><th class="droite">Coût</th><th>Détail</th><th></th></tr></thead>
          <tbody>
            @for (m of mouvements(); track m.id) {
              <tr>
                <td>{{ m.date | date: 'dd/MM/y' }}</td>
                <td><span class="badge" [class.vert]="m.type_mouvement === 'ENTREE'">{{ m.type_mouvement === 'ENTREE' ? 'Entrée' : 'Sortie' }}</span></td>
                <td>{{ m.type_aliment_libelle }}</td>
                <td class="droite">{{ m.type_mouvement === 'ENTREE' ? '+' : '−' }}{{ m.quantite_kg | number: '1.0-2' }} kg
                  @if (m.nb_sacs) { <br /><span class="muted petit">{{ m.nb_sacs }} sacs</span> }</td>
                <td class="droite">{{ m.cout_achat ? (m.cout_achat | currency: 'EUR') : '' }}</td>
                <td class="muted">{{ m.fournisseur }} {{ m.commentaire }}</td>
                <td class="actions">
                  @if (!m.automatique) { <button class="btn icone" type="button" (click)="supprimer(m)" aria-label="Supprimer">🗑</button> }
                  @else { <span class="muted petit" title="Générée par la saisie quotidienne">auto</span> }
                </td>
              </tr>
            } @empty { <tr><td colspan="7" class="vide">Aucun mouvement.</td></tr> }
          </tbody>
        </table>
      </div>
    </div>

    @if (edition(); as m) {
      <app-modale [titre]="m.type_mouvement === 'ENTREE' ? 'Achat d’aliment' : 'Ajustement de stock'" (fermer)="edition.set(null)">
        <form (ngSubmit)="enregistrer(m)">
          @if (m.type_mouvement !== 'ENTREE') {
            <div class="champ"><label>Sens</label>
              <select name="sens" [(ngModel)]="m.type_mouvement"><option value="SORTIE">Retirer du stock (perte, écart d’inventaire)</option>
                <option value="ENTREE_AJUST">Ajouter au stock (écart d’inventaire)</option></select></div>
          }
          <div class="grille deux">
            <div class="champ"><label for="d">Date</label><input id="d" name="date" type="date" [(ngModel)]="m.date" required /></div>
            <div class="champ"><label for="t">Aliment</label>
              <select id="t" name="type" [(ngModel)]="m.type_aliment">@for (t of types(); track t.value) { <option [value]="t.value">{{ t.label }}</option> }</select></div>
            @if (m.type_mouvement === 'ENTREE') {
              <div class="champ"><label for="s">Nombre de sacs</label><input id="s" name="sacs" type="number" min="0" [(ngModel)]="m.nb_sacs" (ngModelChange)="calculerKg(m)" /></div>
              <div class="champ"><label for="ps">Poids d’un sac (kg)</label><input id="ps" name="poids" type="number" min="0" step="0.5" [(ngModel)]="poidsSac" (ngModelChange)="calculerKg(m)" /></div>
            }
            <div class="champ"><label for="q">Quantité (kg)</label><input id="q" name="kg" type="number" min="0.01" step="0.01" [(ngModel)]="m.quantite_kg" required /></div>
            @if (m.type_mouvement === 'ENTREE') {
              <div class="champ"><label for="c">Coût total (€)</label><input id="c" name="cout" type="number" min="0" step="0.01" [(ngModel)]="m.cout_achat" /></div>
              <div class="champ"><label for="f">Fournisseur</label><input id="f" name="fourn" [(ngModel)]="m.fournisseur" /></div>
            }
          </div>
          <div class="champ"><label for="com">Commentaire</label><input id="com" name="com" [(ngModel)]="m.commentaire" /></div>
          @if (m.type_mouvement === 'ENTREE') { <p class="petit muted">Le coût est enregistré automatiquement comme dépense « Aliment ».</p> }
          <p class="erreur-texte">{{ erreur() }}</p>
          <div class="actions-modale">
            <button class="btn" type="button" (click)="edition.set(null)">Annuler</button>
            <button class="btn primaire" type="submit">Enregistrer</button>
          </div>
        </form>
      </app-modale>
    }
  `,
})
export class StockComponent implements OnInit {
  private api = inject(ApiService);
  private notif = inject(NotificationService);
  readonly etat = signal<EtatStock | null>(null);
  readonly mouvements = signal<MouvementStock[]>([]);
  readonly types = signal<Choix[]>([]);
  readonly edition = signal<(Omit<MouvementStock, 'type_mouvement'> & { type_mouvement: string }) | null>(null);
  readonly erreur = signal('');
  filtreType = '';
  debut = decalerJours(aujourdHui(), -90);
  poidsSac = 25;

  async ngOnInit() {
    const choix = await this.api.get<ListesChoix>('/api/choix/');
    this.types.set(choix.types_aliment);
    this.charger();
  }

  async charger() {
    try {
      const [etat, mvts] = await Promise.all([
        this.api.get<EtatStock>('/api/stock/etat/'),
        this.api.get<MouvementStock[]>('/api/stock/', { type_mouvement: this.filtreType, debut: this.debut }),
      ]);
      this.etat.set(etat);
      this.mouvements.set(mvts);
    } catch (e) {
      this.notif.erreur(messageErreur(e));
    }
  }

  ouvrir(type: 'ENTREE' | 'SORTIE') {
    this.erreur.set('');
    this.edition.set({ date: aujourdHui(), type_mouvement: type, type_aliment: 'PONTE', quantite_kg: type === 'ENTREE' ? 250 : 0,
      nb_sacs: type === 'ENTREE' ? 10 : null, cout_achat: null, fournisseur: '', commentaire: type === 'SORTIE' ? 'Ajustement inventaire' : '' });
  }

  calculerKg(m: { nb_sacs: number | null; quantite_kg: number }) {
    if (m.nb_sacs && this.poidsSac) m.quantite_kg = Math.round(m.nb_sacs * this.poidsSac * 100) / 100;
  }

  async enregistrer(m: Omit<MouvementStock, 'type_mouvement'> & { type_mouvement: string }) {
    const corps = { ...m, type_mouvement: m.type_mouvement === 'ENTREE_AJUST' ? 'ENTREE' : m.type_mouvement };
    if (m.type_mouvement !== 'ENTREE') corps.cout_achat = null;
    try {
      await this.api.post('/api/stock/', corps);
      this.edition.set(null);
      this.notif.succes('Stock mis à jour');
      this.charger();
    } catch (e) {
      this.erreur.set(messageErreur(e));
    }
  }

  async supprimer(m: MouvementStock) {
    if (!confirm('Supprimer ce mouvement de stock' + (m.cout_achat ? ' (et la dépense associée)' : '') + ' ?')) return;
    try {
      await this.api.delete(`/api/stock/${m.id}/`);
      this.charger();
    } catch (e) {
      this.notif.erreur(messageErreur(e));
    }
  }
}
