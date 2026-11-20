import { CurrencyPipe, DatePipe, DecimalPipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, messageErreur } from '../core/api.service';
import { Choix, ListesChoix, Lot, Transaction } from '../core/models';
import { NotificationService, aujourdHui, decalerJours } from '../core/notification.service';
import { ModaleComponent } from '../shared/modale.component';

/** Module D : recettes et dépenses. */
@Component({
  selector: 'app-finances',
  imports: [FormsModule, CurrencyPipe, DatePipe, DecimalPipe, ModaleComponent],
  template: `
    <div class="entete-page">
      <h1>Finances</h1>
      <div class="actions">
        <button class="btn" type="button" (click)="nouvelle('RECETTE')">+ Recette</button>
        <button class="btn primaire" type="button" (click)="nouvelle('DEPENSE')">+ Dépense</button>
      </div>
    </div>

    <div class="carte">
      <div class="filtres">
        <div class="champ sans-marge"><label for="ft">Type</label>
          <select id="ft" [(ngModel)]="filtres.type_transaction" (change)="charger()"><option value="">Tout</option>
            <option value="RECETTE">Recettes</option><option value="DEPENSE">Dépenses</option></select></div>
        <div class="champ sans-marge"><label for="fc">Catégorie</label>
          <select id="fc" [(ngModel)]="filtres.categorie" (change)="charger()"><option value="">Toutes</option>
            @for (c of toutesCategories(); track c.value) { <option [value]="c.value">{{ c.label }}</option> }</select></div>
        <div class="champ sans-marge"><label for="fp">Paiement</label>
          <select id="fp" [(ngModel)]="filtres.statut_paiement" (change)="charger()"><option value="">Tous</option>
            <option value="IMPAYE">Impayés</option><option value="PAYE">Payés</option></select></div>
        <div class="champ sans-marge"><label for="fd">Du</label><input id="fd" type="date" [(ngModel)]="filtres.debut" (change)="charger()" /></div>
        <div class="champ sans-marge"><label for="ff">Au</label><input id="ff" type="date" [(ngModel)]="filtres.fin" (change)="charger()" /></div>
      </div>
      <div class="totaux">
        <span>Recettes <strong class="positif">{{ totaux().recettes | currency: 'EUR' }}</strong></span>
        <span>Dépenses <strong class="negatif">{{ totaux().depenses | currency: 'EUR' }}</strong></span>
        <span>Solde <strong [class.negatif]="totaux().solde < 0" [class.positif]="totaux().solde > 0">{{ totaux().solde | currency: 'EUR' }}</strong></span>
      </div>
      <div class="tableau-defile">
        <table>
          <thead><tr><th>Date</th><th>Catégorie</th><th>Détail</th><th>Lot</th><th class="droite">Qté</th><th class="droite">Montant</th><th>Paiement</th><th></th></tr></thead>
          <tbody>
            @for (t of transactions(); track t.id) {
              <tr>
                <td>{{ t.date | date: 'dd/MM/y' }}</td>
                <td><span class="badge" [class.vert]="t.type_transaction === 'RECETTE'">{{ t.categorie_libelle }}</span></td>
                <td class="retour-ligne">{{ t.description }}{{ t.client ? ' · ' + t.client : '' }}</td>
                <td>{{ t.lot_nom || '' }}</td>
                <td class="droite">{{ t.quantite !== null ? (t.quantite | number) : '' }}</td>
                <td class="droite" [class.negatif]="t.type_transaction === 'DEPENSE'">{{ t.type_transaction === 'DEPENSE' ? '−' : '' }}{{ t.montant_total | currency: 'EUR' }}</td>
                <td>@if (t.statut_paiement === 'IMPAYE') { <span class="badge accent">Impayé</span> }</td>
                <td class="actions">
                  @if (t.automatique) { <span class="muted petit" title="Écriture automatique (lot, réforme ou achat d'aliment)">auto</span> }
                  @else { <button class="btn petit" type="button" (click)="modifier(t)">Modifier</button> }
                </td>
              </tr>
            } @empty { <tr><td colspan="8" class="vide">Aucune transaction sur la période.</td></tr> }
          </tbody>
        </table>
      </div>
    </div>

    @if (edition(); as t) {
      <app-modale [titre]="(t.id ? 'Modifier la ' : 'Nouvelle ') + (t.type_transaction === 'RECETTE' ? 'recette' : 'dépense')" (fermer)="edition.set(null)">
        <form (ngSubmit)="enregistrer(t)">
          <div class="grille deux">
            <div class="champ"><label for="d">Date</label><input id="d" name="date" type="date" [(ngModel)]="t.date" required /></div>
            <div class="champ"><label for="c">Catégorie</label>
              <select id="c" name="cat" [(ngModel)]="t.categorie" required>
                @for (c of (t.type_transaction === 'RECETTE' ? choix()?.categories_recette : choix()?.categories_depense); track c.value) {
                  <option [value]="c.value">{{ c.label }}</option> }
              </select></div>
            <div class="champ"><label for="m">Montant total (€)</label><input id="m" name="montant" type="number" min="0" step="0.01" [(ngModel)]="t.montant_total" required /></div>
            <div class="champ"><label for="q">Quantité (facultatif)</label><input id="q" name="qte" type="number" min="0" step="0.01" [(ngModel)]="t.quantite" /></div>
            <div class="champ"><label for="l">Lot concerné (facultatif)</label>
              <select id="l" name="lot" [(ngModel)]="t.lot"><option [ngValue]="null">— Tous / aucun —</option>
                @for (l of lots(); track l.id) { <option [ngValue]="l.id">{{ l.nom }}</option> }</select></div>
            <div class="champ"><label for="p">Paiement</label>
              <select id="p" name="paie" [(ngModel)]="t.statut_paiement"><option value="PAYE">Payé</option><option value="IMPAYE">Impayé</option></select></div>
          </div>
          <div class="champ"><label for="cl">{{ t.type_transaction === 'RECETTE' ? 'Client' : 'Fournisseur / bénéficiaire' }}</label><input id="cl" name="client" [(ngModel)]="t.client" /></div>
          <div class="champ"><label for="desc">Description</label><input id="desc" name="desc" [(ngModel)]="t.description" /></div>
          <p class="erreur-texte">{{ erreur() }}</p>
          <div class="actions-modale">
            @if (t.id) { <button class="btn danger" type="button" (click)="supprimer(t)">Supprimer</button> }
            <button class="btn" type="button" (click)="edition.set(null)">Annuler</button>
            <button class="btn primaire" type="submit">Enregistrer</button>
          </div>
        </form>
      </app-modale>
    }
  `,
})
export class FinancesComponent implements OnInit {
  private api = inject(ApiService);
  private notif = inject(NotificationService);
  readonly transactions = signal<Transaction[]>([]);
  readonly choix = signal<ListesChoix | null>(null);
  readonly lots = signal<Lot[]>([]);
  readonly edition = signal<Transaction | null>(null);
  readonly erreur = signal('');
  filtres = { type_transaction: '', categorie: '', statut_paiement: '', debut: decalerJours(aujourdHui(), -90), fin: aujourdHui() };

  readonly toutesCategories = computed<Choix[]>(() => [...(this.choix()?.categories_recette ?? []), ...(this.choix()?.categories_depense ?? [])]);
  readonly totaux = computed(() => {
    let recettes = 0;
    let depenses = 0;
    for (const t of this.transactions()) {
      if (t.type_transaction === 'RECETTE') recettes += Number(t.montant_total);
      else depenses += Number(t.montant_total);
    }
    return { recettes, depenses, solde: recettes - depenses };
  });

  async ngOnInit() {
    const [choix, lots] = await Promise.all([this.api.get<ListesChoix>('/api/choix/'), this.api.get<Lot[]>('/api/lots/')]);
    this.choix.set(choix);
    this.lots.set(lots);
    this.charger();
  }

  async charger() {
    try {
      this.transactions.set(await this.api.get<Transaction[]>('/api/transactions/', this.filtres));
    } catch (e) {
      this.notif.erreur(messageErreur(e));
    }
  }

  nouvelle(type: 'RECETTE' | 'DEPENSE') {
    this.erreur.set('');
    this.edition.set({ date: aujourdHui(), type_transaction: type, categorie: type === 'RECETTE' ? 'VENTE_OEUFS' : 'VETERINAIRE',
      quantite: null, montant_total: 0, lot: null, client: '', statut_paiement: 'PAYE', description: '' });
  }

  modifier(t: Transaction) {
    this.erreur.set('');
    this.edition.set({ ...t });
  }

  async enregistrer(t: Transaction) {
    try {
      if (t.id) await this.api.put(`/api/transactions/${t.id}/`, t);
      else await this.api.post('/api/transactions/', t);
      this.edition.set(null);
      this.notif.succes('Transaction enregistrée');
      this.charger();
    } catch (e) {
      this.erreur.set(messageErreur(e));
    }
  }

  async supprimer(t: Transaction) {
    if (!confirm('Supprimer cette transaction ?')) return;
    try {
      await this.api.delete(`/api/transactions/${t.id}/`);
      this.edition.set(null);
      this.charger();
    } catch (e) {
      this.erreur.set(messageErreur(e));
    }
  }
}
