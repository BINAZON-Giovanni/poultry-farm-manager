import { CurrencyPipe, DatePipe, DecimalPipe } from '@angular/common';
import { Component, OnInit, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, messageErreur } from '../core/api.service';
import { Lot, Parametres, Transaction } from '../core/models';
import { NotificationService, aujourdHui, decalerJours } from '../core/notification.service';
import { SyncService } from '../core/sync.service';
import { CompteurComponent } from '../shared/compteur.component';

type Onglet = 'oeufs' | 'reforme' | 'fiente';

/** Ventes saisies sur le terrain : œufs (plateaux + unités), poules de réforme, fiente. */
@Component({
  selector: 'app-ventes',
  imports: [FormsModule, DecimalPipe, CurrencyPipe, DatePipe, CompteurComponent],
  template: `
    <div class="entete-page"><h1>Ventes</h1></div>

    <div class="onglets" role="tablist">
      <button type="button" role="tab" [class.actif]="onglet() === 'oeufs'" (click)="onglet.set('oeufs')">🥚 Œufs</button>
      <button type="button" role="tab" [class.actif]="onglet() === 'reforme'" (click)="onglet.set('reforme')">🐔 Poules de réforme</button>
      <button type="button" role="tab" [class.actif]="onglet() === 'fiente'" (click)="onglet.set('fiente')">Fiente / engrais</button>
    </div>

    <form class="carte" (ngSubmit)="enregistrer()">
      <div class="grille deux">
        <div class="champ"><label for="d">Date</label><input id="d" name="date" type="date" [(ngModel)]="date" [max]="aujourdHui" required /></div>
        <div class="champ"><label for="c">Client</label><input id="c" name="client" [(ngModel)]="client" placeholder="Nom du client" /></div>
      </div>

      @switch (onglet()) {
        @case ('oeufs') {
          <div class="grille deux">
            <div><label>Plateaux de {{ parPlateau() }}</label><app-compteur [(valeur)]="plateaux" libelle="plateaux vendus" /></div>
            <div><label>Œufs à l’unité</label><app-compteur [(valeur)]="unites" libelle="œufs vendus à l'unité" /></div>
          </div>
          <p class="total">= <strong>{{ nbOeufs() | number }}</strong> œufs</p>
        }
        @case ('reforme') {
          <div class="grille deux">
            <div class="champ"><label for="lot">Lot</label>
              <select id="lot" name="lot" [(ngModel)]="lotId" required>
                @for (l of lots(); track l.id) { <option [ngValue]="l.id">{{ l.nom }} ({{ l.effectif_actuel }} poules)</option> }
              </select></div>
            <div><label>Nombre de poules vendues</label><app-compteur [(valeur)]="nbPoules" [min]="1" libelle="poules vendues" /></div>
          </div>
        }
        @case ('fiente') {
          <div><label>Quantité (sacs ou kg, facultatif)</label><app-compteur [(valeur)]="quantite" libelle="quantité" /></div>
        }
      }

      <div class="grille deux">
        <div class="champ">
          <label for="m">Montant total (€)</label>
          <input id="m" name="montant" type="number" inputmode="decimal" min="0" step="0.01" [(ngModel)]="montant" required class="grand-champ" />
          @if (onglet() === 'oeufs' && prixSuggere() !== null) {
            <button type="button" class="lien petit" (click)="montant = prixSuggere()!">Prix habituel : {{ prixSuggere() | currency: 'EUR' }}</button>
          }
        </div>
        <div class="champ">
          <label>Paiement</label>
          <div class="choix-boutons">
            <button type="button" class="btn" [class.selection]="paye" (click)="paye = true">Payé</button>
            <button type="button" class="btn" [class.selection]="!paye" (click)="paye = false">Pas encore payé</button>
          </div>
        </div>
      </div>
      <p class="erreur-texte" role="alert">{{ erreur() }}</p>
      <button class="btn primaire tres-large" type="submit" [disabled]="enCours()">Enregistrer la vente</button>
    </form>

    <div class="carte">
      <h2>Ventes des 30 derniers jours</h2>
      @if (ventes().length === 0) {
        <p class="vide">Aucune vente enregistrée.</p>
      } @else {
        <div class="tableau-defile">
          <table>
            <thead><tr><th>Date</th><th>Vente</th><th>Client</th><th class="droite">Montant</th><th>Paiement</th></tr></thead>
            <tbody>
              @for (v of ventes(); track v.id) {
                <tr>
                  <td>{{ v.date | date: 'dd/MM' }}</td>
                  <td>{{ v.categorie_libelle }}@if (v.quantite) { · {{ v.quantite | number }} }</td>
                  <td>{{ v.client || '—' }}</td>
                  <td class="droite">{{ v.montant_total | currency: 'EUR' }}</td>
                  <td>
                    @if (v.statut_paiement === 'IMPAYE') {
                      <button class="btn petit" type="button" (click)="marquerPaye(v)">Marquer payé</button>
                    } @else { <span class="badge vert">Payé</span> }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </div>
  `,
})
export class VentesComponent implements OnInit {
  private api = inject(ApiService);
  private sync = inject(SyncService);
  private notif = inject(NotificationService);

  readonly aujourdHui = aujourdHui();
  readonly onglet = signal<Onglet>('oeufs');
  readonly lots = signal<Lot[]>([]);
  readonly ventes = signal<Transaction[]>([]);
  readonly parPlateau = signal(30);
  readonly prixPlateau = signal<number | null>(null);
  readonly plateaux = signal(0);
  readonly unites = signal(0);
  readonly nbPoules = signal(1);
  readonly quantite = signal(0);
  date = aujourdHui();
  client = '';
  montant: number | null = null;
  paye = true;
  lotId: number | null = null;
  readonly erreur = signal('');
  readonly enCours = signal(false);

  readonly nbOeufs = computed(() => this.plateaux() * this.parPlateau() + this.unites());
  readonly prixSuggere = computed(() => {
    const p = this.prixPlateau();
    return p && this.nbOeufs() ? Math.round(((this.nbOeufs() / this.parPlateau()) * p) * 100) / 100 : null;
  });

  constructor() {
    effect(() => {
      this.sync.version();
      this.chargerVentes();
    });
  }

  async ngOnInit() {
    try {
      const [params, lots] = await Promise.all([
        this.api.get<Parametres>('/api/parametres/'),
        this.api.get<Lot[]>('/api/lots/', { statut: 'ACTIF' }),
      ]);
      this.parPlateau.set(params.oeufs_par_plateau || 30);
      this.prixPlateau.set(params.prix_plateau_defaut);
      this.lots.set(lots);
      this.lotId = lots[0]?.id ?? null;
    } catch (e) {
      this.erreur.set(messageErreur(e));
    }
  }

  async chargerVentes() {
    try {
      this.ventes.set(await this.api.get<Transaction[]>('/api/transactions/', { type_transaction: 'RECETTE', debut: decalerJours(aujourdHui(), -30) }));
    } catch {
      /* hors-ligne sans cache */
    }
  }

  async enregistrer() {
    this.erreur.set('');
    if (this.montant === null || this.montant < 0) return this.erreur.set('Indiquez le montant.');
    const statut_paiement = this.paye ? 'PAYE' : 'IMPAYE';
    let url: string, corps: Record<string, unknown>, libelle: string;
    switch (this.onglet()) {
      case 'oeufs':
        if (!this.nbOeufs()) return this.erreur.set('Indiquez le nombre d’œufs vendus.');
        url = '/api/transactions/';
        corps = { date: this.date, type_transaction: 'RECETTE', categorie: 'VENTE_OEUFS', quantite: this.nbOeufs(),
          montant_total: this.montant, client: this.client, statut_paiement,
          description: `${this.plateaux()} plateau(x) + ${this.unites()} œuf(s)` };
        libelle = `Vente de ${this.nbOeufs()} œufs`;
        break;
      case 'reforme':
        if (!this.lotId) return this.erreur.set('Choisissez le lot.');
        url = '/api/reformes/';
        corps = { date: this.date, lot: this.lotId, quantite_vendue: this.nbPoules(), prix_total: this.montant, client: this.client, statut_paiement };
        libelle = `Réforme de ${this.nbPoules()} poules`;
        break;
      default:
        url = '/api/transactions/';
        corps = { date: this.date, type_transaction: 'RECETTE', categorie: 'VENTE_FIENTE', quantite: this.quantite() || null,
          montant_total: this.montant, client: this.client, statut_paiement };
        libelle = 'Vente de fiente';
    }
    this.enCours.set(true);
    try {
      const r = await this.sync.envoyer('POST', url, corps, libelle);
      this.notif[r.enLigne ? 'succes' : 'info'](r.enLigne ? 'Vente enregistrée ✓' : 'Hors-ligne : vente gardée, envoi automatique au retour du réseau.');
      this.plateaux.set(0);
      this.unites.set(0);
      this.nbPoules.set(1);
      this.quantite.set(0);
      this.montant = null;
      this.client = '';
      this.paye = true;
      if (r.enLigne) this.chargerVentes();
    } catch (e) {
      this.erreur.set(messageErreur(e));
    } finally {
      this.enCours.set(false);
    }
  }

  async marquerPaye(v: Transaction) {
    try {
      if (v.automatique) {
        // Vente de réforme : on modifie la réforme d'origine
        this.notif.info('Pour une vente de réforme, demandez à l’administrateur.');
        return;
      }
      await this.api.patch(`/api/transactions/${v.id}/`, { statut_paiement: 'PAYE' });
      this.notif.succes('Vente marquée comme payée');
      this.chargerVentes();
    } catch (e) {
      this.notif.erreur(messageErreur(e));
    }
  }
}
