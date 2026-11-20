import { DecimalPipe } from '@angular/common';
import { Component, computed, inject, input, numberAttribute, signal, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ApiService, messageErreur } from '../core/api.service';
import { LotTerrain, SuiviQuotidien, TableauTerrain } from '../core/models';
import { NotificationService, aujourdHui } from '../core/notification.service';
import { SyncService } from '../core/sync.service';
import { CompteurComponent } from '../shared/compteur.component';

const MOTIFS = ['Maladie', 'Étouffement', 'Prédateur', 'Picage', 'Chaleur', 'Accident', 'Inconnu'];

/** Saisie quotidienne d'un lot : ramassage, mortalité, alimentation. Fonctionne hors-ligne. */
@Component({
  selector: 'app-saisie-jour',
  imports: [FormsModule, RouterLink, DecimalPipe, CompteurComponent],
  template: `
    <div class="entete-page">
      <div>
        <a routerLink="/terrain" class="lien-retour">← Retour</a>
        <h1>{{ lot()?.nom ?? 'Saisie' }}</h1>
        @if (lot(); as l) {
          <p class="muted">{{ l.age_semaines }} semaines · {{ l.effectif | number }} poules</p>
        }
      </div>
      <div class="champ sans-marge">
        <label for="date">Date</label>
         <input id="date" type="date" [max]="dateMax()" [ngModel]="date()" (ngModelChange)="changerDate($event)" />
      </div>
    </div>

    @if (existant()) {
      <p class="bandeau">Une saisie existe déjà pour ce jour{{ existant()!.saisi_par_nom ? ' (par ' + existant()!.saisi_par_nom + ')' : '' }} : vous la modifiez.</p>
    }

    <form (ngSubmit)="enregistrer()">
      <section class="carte">
        <h2>🥚 Œufs ramassés</h2>
        <div class="grille deux">
          <div>
            <label>Plateaux de {{ parPlateau() }}</label>
            <app-compteur [(valeur)]="plateaux" libelle="plateaux" />
          </div>
          <div>
            <label>Œufs en plus (unités)</label>
            <app-compteur [(valeur)]="unites" libelle="unités" />
          </div>
        </div>
        <p class="total">= <strong>{{ intacts() | number }}</strong> œufs intacts</p>
        <div class="grille deux">
          <div>
            <label>Œufs cassés / impropres</label>
            <app-compteur [(valeur)]="casses" libelle="œufs cassés" />
          </div>
          <div class="indicateur">
            @if (tauxPonte() !== null) {
              <span class="muted">Taux de ponte</span>
              <strong class="grand">{{ tauxPonte() | number: '1.0-1' }} %</strong>
            }
          </div>
        </div>
      </section>

      <section class="carte">
        <h2>Mortalité</h2>
        <div class="grille deux">
          <div>
            <label>Poules mortes</label>
            <app-compteur [(valeur)]="deces" libelle="décès" />
          </div>
          @if (deces() > 0) {
            <div>
              <label for="motif">Motif</label>
              <select id="motif" name="motif" [(ngModel)]="motif">
                <option value="">— Choisir —</option>
                @for (m of motifs; track m) { <option [value]="m">{{ m }}</option> }
              </select>
            </div>
          }
        </div>
      </section>

      <section class="carte">
        <h2>Alimentation</h2>
        <p>Ration prévue : <strong>{{ rationTheorique() | number: '1.0-2' }} kg</strong>
          @if (lot()?.type_aliment_libelle) { d’aliment {{ lot()!.type_aliment_libelle!.toLowerCase() }} }
          @if (lot()?.grammes_par_poule_jour) { ({{ lot()!.grammes_par_poule_jour }} g/poule) }</p>
        <label>Quantité réellement distribuée (kg)</label>
        <app-compteur [(valeur)]="aliment" [pas]="0.5" libelle="kg d'aliment distribués" />
        @if (ecartAliment(); as e) {
          <p class="petit muted">Écart avec la ration prévue : {{ e > 0 ? '+' : '' }}{{ e | number: '1.0-2' }} kg</p>
        }
      </section>

      <section class="carte">
        <label for="com">Remarque (facultatif)</label>
        <textarea id="com" name="commentaire" [(ngModel)]="commentaire" rows="2" placeholder="Comportement, météo, observation…"></textarea>
      </section>

      <p class="erreur-texte" role="alert">{{ erreur() }}</p>
      <div class="actions-bas">
        <button class="btn primaire tres-large" type="submit" [disabled]="enCours() || !lot()">
          {{ enCours() ? 'Enregistrement…' : 'Valider la saisie' }}
        </button>
      </div>
    </form>
  `,
})
export class SaisieJourComponent implements OnInit {
  readonly lotId = input.required({ transform: numberAttribute });
  readonly dateParam = input<string | undefined>(undefined, { alias: 'date' });

  private api = inject(ApiService);
  private sync = inject(SyncService);
  private router = inject(Router);
  private notif = inject(NotificationService);

  readonly motifs = MOTIFS;
  readonly lot = signal<LotTerrain | null>(null);
  readonly existant = signal<SuiviQuotidien | null>(null);
  readonly date = signal(aujourdHui());
  readonly parPlateau = signal(30);
  readonly plateaux = signal(0);
  readonly unites = signal(0);
  readonly casses = signal(0);
  readonly deces = signal(0);
  readonly aliment = signal(0);
  motif = '';
  commentaire = '';
  readonly erreur = signal('');
  readonly enCours = signal(false);
  private rationExistante = signal<number | null>(null);

  readonly intacts = computed(() => this.plateaux() * this.parPlateau() + this.unites());
  readonly rationTheorique = computed(() => this.rationExistante() ?? this.lot()?.ration_kg ?? 0);
  readonly tauxPonte = computed(() => {
    const eff = this.existant()?.effectif_du_jour ?? this.lot()?.effectif_matin;
    const total = this.intacts() + this.casses();
    return eff && total ? (total / eff) * 100 : null;
  });
  readonly ecartAliment = computed(() => {
    const e = Math.round((this.aliment() - this.rationTheorique()) * 100) / 100;
    return e === 0 ? null : e;
  });

  /** La date du serveur (transmise par l'écran d'accueil) fait foi, même si l'horloge de la tablette diffère. */
  readonly dateMax = computed(() => {
    const p = this.dateParam();
    return p && p > aujourdHui() ? p : aujourdHui();
  });

  async ngOnInit() {
    if (this.dateParam()) this.date.set(this.dateParam()!);
    try {
      // Le tableau de bord terrain est en cache sur la tablette : la saisie fonctionne même hors-ligne
      const tableau = await this.api.get<TableauTerrain>('/api/tableau-de-bord/terrain/');
      const lot = tableau.lots.find((l) => l.id === this.lotId());
      if (!lot) {
        this.erreur.set('Ce lot n’est plus actif : saisie impossible.');
        return;
      }
      this.lot.set(lot);
      this.parPlateau.set(tableau.parametres.oeufs_par_plateau || 30);
      await this.chargerJour();
    } catch (e) {
      this.erreur.set(messageErreur(e));
    }
  }

  async changerDate(d: string) {
    if (!d) return;
    this.date.set(d);
    await this.chargerJour();
  }

  private async chargerJour() {
    let s: SuiviQuotidien | null = null;
    try {
      const liste = await this.api.get<SuiviQuotidien[]>('/api/suivis/', { lot: this.lotId(), debut: this.date(), fin: this.date() });
      s = liste[0] ?? null;
    } catch {
      /* hors-ligne sans cache : nouvelle saisie */
    }
    // Une saisie en attente d'envoi est plus récente que celle du serveur
    const attente = this.sync.suiviEnAttente(this.lotId(), this.date());
    const source = (attente?.corps as Partial<SuiviQuotidien> | undefined) ?? s;
    this.existant.set(s);
    this.rationExistante.set(s?.ration_theorique_kg ?? null);
    const intacts = source?.oeufs_intacts ?? 0;
    this.plateaux.set(Math.floor(intacts / this.parPlateau()));
    this.unites.set(intacts % this.parPlateau());
    this.casses.set(source?.oeufs_casses ?? 0);
    this.deces.set(source?.nb_deces ?? 0);
    this.motif = source?.motif_deces ?? '';
    this.commentaire = source?.commentaire ?? '';
    this.aliment.set(source?.aliment_distribue_kg != null ? Number(source.aliment_distribue_kg) : this.rationTheorique());
  }

  async enregistrer() {
    this.erreur.set('');
    this.enCours.set(true);
    const corps = {
      lot: this.lotId(),
      date: this.date(),
      oeufs_intacts: this.intacts(),
      oeufs_casses: this.casses(),
      nb_deces: this.deces(),
      motif_deces: this.deces() > 0 ? this.motif : '',
      aliment_distribue_kg: this.aliment(),
      commentaire: this.commentaire,
    };
    try {
      const r = await this.sync.envoyer('POST', '/api/suivis/', corps, `Saisie ${this.lot()?.nom} du ${this.date()}`);
      if (r.enLigne) this.notif.succes('Saisie enregistrée ✓');
      else this.notif.info('Hors-ligne : saisie gardée sur la tablette, elle sera envoyée automatiquement.');
      this.router.navigateByUrl('/terrain');
    } catch (e) {
      this.erreur.set(messageErreur(e));
    } finally {
      this.enCours.set(false);
    }
  }
}
