import { CurrencyPipe, DecimalPipe } from '@angular/common';
import { Component, computed, inject, signal, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, messageErreur } from '../core/api.service';
import { TableauPilotage } from '../core/models';
import { aujourdHui, decalerJours } from '../core/notification.service';
import { GraphiqueComponent, Serie } from '../shared/graphique.component';

const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

/** Vue « Pilotage » (admin) : production, courbe de ponte vs souche, mortalité, bilan financier. */
@Component({
  selector: 'app-pilotage',
  imports: [FormsModule, DecimalPipe, CurrencyPipe, GraphiqueComponent],
  template: `
    <div class="entete-page">
      <h1>Pilotage</h1>
      <div class="filtres">
        <div class="choix-boutons">
          @for (p of periodes; track p.jours) {
            <button type="button" class="btn petit" [class.selection]="jours() === p.jours" (click)="choisirPeriode(p.jours)">{{ p.libelle }}</button>
          }
        </div>
        <input type="date" [(ngModel)]="debut" (change)="perso()" aria-label="Début" />
        <input type="date" [(ngModel)]="fin" (change)="perso()" aria-label="Fin" />
      </div>
    </div>
    @if (erreur()) { <p class="carte erreur-texte">{{ erreur() }}</p> }

    @if (data(); as d) {
      <div class="grille stats">
        <div class="carte stat"><div class="libelle">Poules vivantes</div><div class="valeur">{{ d.indicateurs.effectif_actuel | number }}</div>
          <div class="sous">{{ d.indicateurs.deces }} décès sur la période
            @if (d.indicateurs.taux_mortalite !== null) { ({{ d.indicateurs.taux_mortalite | number: '1.0-2' }} %) }</div></div>
        <div class="carte stat"><div class="libelle">Taux de ponte moyen</div>
          <div class="valeur">{{ d.indicateurs.taux_ponte_moyen ?? '—' }}<small> %</small></div>
          <div class="sous">{{ d.indicateurs.oeufs_pondus | number }} œufs dont {{ d.indicateurs.oeufs_casses | number }} cassés</div></div>
        <div class="carte stat"><div class="libelle">Indice de consommation</div>
          <div class="valeur">{{ d.indicateurs.indice_consommation_g_par_oeuf ?? '—' }}<small> g/œuf</small></div>
          <div class="sous">{{ d.indicateurs.aliment_consomme_kg | number: '1.0-0' }} kg d’aliment consommés</div></div>
        <div class="carte stat"><div class="libelle">Coût de revient d’un œuf</div>
          <div class="valeur">{{ d.indicateurs.cout_revient_oeuf !== null ? (d.indicateurs.cout_revient_oeuf | currency: 'EUR':'symbol':'1.3-3') : '—' }}</div>
          <div class="sous">{{ d.indicateurs.oeufs_commercialisables | number }} œufs commercialisables</div></div>
        <div class="carte stat"><div class="libelle">Chiffre d’affaires</div><div class="valeur">{{ d.indicateurs.recettes | currency: 'EUR':'symbol':'1.0-0' }}</div>
          <div class="sous">@if (d.indicateurs.impayes) { dont {{ d.indicateurs.impayes | currency: 'EUR' }} impayés } @else { tout est encaissé }</div></div>
        <div class="carte stat"><div class="libelle">Marge nette</div>
          <div class="valeur" [class.negatif]="d.indicateurs.marge_nette < 0" [class.positif]="d.indicateurs.marge_nette > 0">{{ d.indicateurs.marge_nette | currency: 'EUR':'symbol':'1.0-0' }}</div>
          <div class="sous">{{ d.indicateurs.depenses | currency: 'EUR':'symbol':'1.0-0' }} de charges</div></div>
      </div>

      <div class="carte">
        <div class="ligne-entre">
          <h2>Courbe de ponte : réel vs théorique (souche)</h2>
          @if (d.courbes_ponte.length > 1) {
            <select [ngModel]="lotCourbe()" (ngModelChange)="lotCourbe.set($event)" aria-label="Lot">
              @for (c of d.courbes_ponte; track c.lot_id) { <option [ngValue]="c.lot_id">{{ c.lot }}</option> }
            </select>
          }
        </div>
        @if (courbe(); as c) {
          <app-graphique [labels]="c.labels" [series]="c.series" unite=" %" [maxFixe]="100" titre="Taux de ponte par semaine d'âge" />
          <p class="petit muted">En abscisse : âge du lot en semaines (actuellement S{{ c.age }}). Un écart durable sous la courbe théorique,
            ou un taux qui passe sous ~65-70 %, aide à décider du moment de la réforme.</p>
        } @else {
          <p class="vide">Pas encore de saisie pour tracer la courbe.</p>
        }
      </div>

      <div class="grille deux">
        <div class="carte">
          <h2>Œufs pondus par jour</h2>
          <app-graphique type="barres" [labels]="joursLabels()" [series]="[{ nom: 'Œufs', valeurs: oeufsParJour(), couleur: 'var(--serie-2)' }]" titre="Œufs par jour" />
        </div>
        <div class="carte">
          <h2>Mortalité</h2>
          <app-graphique type="barres" [labels]="joursLabels()" [series]="[{ nom: 'Décès', valeurs: decesParJour(), couleur: 'var(--danger)' }]" titre="Décès par jour" />
          @if (d.mortalite_par_motif.length) {
            <ul class="liste">
              @for (m of d.mortalite_par_motif; track m.motif) { <li><span>{{ m.motif }}</span><strong>{{ m.deces }}</strong></li> }
            </ul>
          }
        </div>
      </div>

      <div class="carte">
        <h2>Bilan financier mensuel (12 mois)</h2>
        <app-graphique type="barres" [labels]="moisLabels()" [series]="bilanSeries()" unite=" €" titre="Chiffre d'affaires et charges par mois" />
        <div class="tableau-defile">
          <table>
            <thead><tr><th>Mois</th><th class="droite">Chiffre d’affaires</th><th class="droite">Charges</th><th class="droite">Bénéfice net</th></tr></thead>
            <tbody>
              @for (m of bilanNonVide(); track m.mois) {
                <tr><td>{{ libelleMois(m.mois) }}</td><td class="droite">{{ m.chiffre_affaires | currency: 'EUR' }}</td>
                  <td class="droite">{{ m.charges | currency: 'EUR' }}</td>
                  <td class="droite" [class.negatif]="m.benefice < 0" [class.positif]="m.benefice > 0">{{ m.benefice | currency: 'EUR' }}</td></tr>
              }
            </tbody>
          </table>
        </div>
      </div>

      <div class="grille deux">
        <div class="carte">
          <h2>Rentabilité par lot</h2>
          @if (d.marges_par_lot.length === 0) { <p class="vide">Aucune donnée.</p> } @else {
            <div class="tableau-defile">
              <table>
                <thead><tr><th>Lot</th><th class="droite">Ponte</th><th class="droite">Recettes</th><th class="droite">Dépenses</th><th class="droite">Marge</th><th class="droite">Coût/œuf</th></tr></thead>
                <tbody>
                  @for (m of d.marges_par_lot; track m.lot_id) {
                    <tr><td>{{ m.lot }}</td><td class="droite">{{ m.taux_ponte_moyen ?? '—' }} %</td>
                      <td class="droite">{{ m.recettes | currency: 'EUR':'symbol':'1.0-0' }}</td><td class="droite">{{ m.depenses | currency: 'EUR':'symbol':'1.0-0' }}</td>
                      <td class="droite" [class.negatif]="m.marge < 0" [class.positif]="m.marge > 0">{{ m.marge | currency: 'EUR':'symbol':'1.0-0' }}</td>
                      <td class="droite">{{ m.cout_revient_oeuf !== null ? (m.cout_revient_oeuf | currency: 'EUR':'symbol':'1.3-3') : '—' }}</td></tr>
                  }
                </tbody>
              </table>
            </div>
            <p class="petit muted">{{ d.methode_repartition }}</p>
          }
        </div>
        <div class="carte">
          <h2>Recettes et dépenses par catégorie</h2>
          @for (c of d.finances_par_categorie; track c.categorie) {
            <div class="barre-h">
              <span>{{ c.libelle }}</span>
              <div class="piste"><div class="rempli" [class.recette]="c.type === 'RECETTE'" [style.width.%]="(c.total / maxCategorie()) * 100"></div></div>
              <span class="droite">{{ c.total | currency: 'EUR':'symbol':'1.0-0' }}</span>
            </div>
          } @empty { <p class="vide">Aucune transaction sur la période.</p> }
        </div>
      </div>
    } @else if (!erreur()) {
      <p class="muted">Chargement…</p>
    }
  `,
})
export class PilotageComponent implements OnInit {
  private api = inject(ApiService);
  readonly periodes = [
    { jours: 30, libelle: '30 j' },
    { jours: 90, libelle: '3 mois' },
    { jours: 365, libelle: '12 mois' },
  ];
  readonly jours = signal<number | null>(30);
  fin = aujourdHui();
  debut = decalerJours(this.fin, -29);
  readonly data = signal<TableauPilotage | null>(null);
  readonly erreur = signal('');
  readonly lotCourbe = signal<number | null>(null);

  readonly joursLabels = computed(() => (this.data()?.serie_jours ?? []).map((j) => j.date.slice(8, 10) + '/' + j.date.slice(5, 7)));
  readonly oeufsParJour = computed(() => (this.data()?.serie_jours ?? []).map((j) => j.oeufs));
  readonly decesParJour = computed(() => (this.data()?.serie_jours ?? []).map((j) => j.deces));
  readonly moisLabels = computed(() => (this.data()?.bilan_mensuel ?? []).map((m) => MOIS[+m.mois.slice(5, 7) - 1]));
  readonly bilanSeries = computed<Serie[]>(() => {
    const b = this.data()?.bilan_mensuel ?? [];
    return [
      { nom: 'Chiffre d’affaires', valeurs: b.map((m) => m.chiffre_affaires), couleur: 'var(--serie-1)' },
      { nom: 'Charges', valeurs: b.map((m) => m.charges), couleur: 'var(--serie-3)' },
    ];
  });
  readonly bilanNonVide = computed(() => (this.data()?.bilan_mensuel ?? []).filter((m) => m.chiffre_affaires || m.charges).reverse());
  readonly maxCategorie = computed(() => Math.max(1, ...(this.data()?.finances_par_categorie ?? []).map((c) => c.total)));
  readonly courbe = computed(() => {
    const d = this.data();
    if (!d?.courbes_ponte.length) return null;
    const c = d.courbes_ponte.find((x) => x.lot_id === this.lotCourbe()) ?? d.courbes_ponte[0];
    if (!c.points.some((p) => p.reel !== null)) return null;
    return {
      age: c.age_actuel_semaines,
      labels: c.points.map((p) => 'S' + p.semaine),
      series: [
        { nom: 'Réel', valeurs: c.points.map((p) => p.reel), couleur: 'var(--serie-1)' },
        { nom: 'Théorique (souche)', valeurs: c.points.map((p) => p.theorique), couleur: 'var(--muted)', pointilles: true },
      ] as Serie[],
    };
  });

  ngOnInit() {
    this.charger();
  }

  choisirPeriode(jours: number) {
    this.jours.set(jours);
    this.fin = aujourdHui();
    this.debut = decalerJours(this.fin, -(jours - 1));
    this.charger();
  }

  perso() {
    this.jours.set(null);
    if (this.debut && this.fin) this.charger();
  }

  async charger() {
    try {
      const d = await this.api.get<TableauPilotage>('/api/tableau-de-bord/pilotage/', { debut: this.debut, fin: this.fin });
      if (!d.courbes_ponte.some((c) => c.lot_id === this.lotCourbe())) this.lotCourbe.set(d.courbes_ponte[0]?.lot_id ?? null);
      this.data.set(d);
      this.erreur.set('');
    } catch (e) {
      this.erreur.set(messageErreur(e));
    }
  }

  libelleMois(m: string): string {
    return `${MOIS[+m.slice(5, 7) - 1]} ${m.slice(0, 4)}`;
  }
}
