import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService, messageErreur } from '../core/api.service';
import { TableauTerrain } from '../core/models';
import { SyncService } from '../core/sync.service';

/** Vue « Terrain » : état immédiat du poulailler et saisies du jour (tablette). */
@Component({
  selector: 'app-terrain-accueil',
  imports: [RouterLink, DecimalPipe, DatePipe],
  template: `
    <div class="entete-page">
      <div>
        <h1>Aujourd’hui</h1>
        <p class="muted">{{ data()?.date | date: 'EEEE d MMMM y' }}</p>
      </div>
      <a class="btn" routerLink="/terrain/ventes">Enregistrer une vente</a>
    </div>

    @if (erreur()) { <p class="carte erreur-texte">{{ erreur() }}</p> }

    @if (data(); as d) {
      <div class="grille stats">
        <div class="carte stat"><div class="libelle">Poules vivantes</div><div class="valeur">{{ d.effectif_total | number }}</div>
          <div class="sous">{{ d.lots.length }} lot(s) actif(s)</div></div>
        <div class="carte stat"><div class="libelle">Œufs ramassés</div><div class="valeur">{{ d.oeufs_du_jour | number }}</div>
          <div class="sous">{{ plateaux(d.oeufs_du_jour, d.parametres.oeufs_par_plateau) }}
            @if (d.taux_ponte_du_jour !== null) { · ponte {{ d.taux_ponte_du_jour | number: '1.0-1' }} % }</div></div>
        <div class="carte stat"><div class="libelle">Ration du jour</div><div class="valeur">{{ d.ration_totale_kg | number: '1.0-1' }} <small>kg</small></div>
          <div class="sous">pour tout le poulailler</div></div>
        <div class="carte stat" [class.alerte]="d.stock.alerte"><div class="libelle">Stock d’aliment</div>
          <div class="valeur">{{ d.stock.total_kg | number: '1.0-0' }} <small>kg</small></div>
          <div class="sous">@if (d.stock.jours_restants !== null) { ≈ {{ d.stock.jours_restants | number: '1.0-0' }} jours }
            @if (d.stock.alerte) { <strong> · Stock bas !</strong> }</div></div>
      </div>

      @if (d.stock.alerte) {
        <div class="carte alerte-stock" role="alert">
          <strong>⚠ Alerte stock d’aliment</strong>
          <ul class="liste-simple">
            @for (t of d.stock.par_type; track t.type_aliment) {
              @if (t.alerte || t.stock_kg <= 0) {
                <li>{{ t.libelle }} : {{ t.stock_kg | number: '1.0-0' }} kg restants
                  @if (t.jours_restants !== null) { (≈ {{ t.jours_restants | number: '1.0-0' }} j) }</li>
              }
            }
            @if (d.stock.total_kg <= d.stock.seuil_alerte_kg) { <li>Stock total sous le seuil de {{ d.stock.seuil_alerte_kg | number }} kg</li> }
          </ul>
        </div>
      }

      <h2 class="titre-section">Saisies du jour</h2>
      @if (d.lots.length === 0) {
        <div class="carte vide">Aucun lot actif. L’administrateur doit d’abord créer un lot.</div>
      }
      <div class="grille lots">
        @for (lot of d.lots; track lot.id) {
          <div class="carte lot-terrain">
            <div class="ligne-entre">
              <h3>{{ lot.nom }}</h3>
              @if (lot.suivi_du_jour) {
                <span class="badge vert">✓ Saisi</span>
              } @else if (sync.suiviEnAttente(lot.id, d.date)) {
                <span class="badge jaune">En attente d’envoi</span>
              } @else {
                <span class="badge accent">À faire</span>
              }
            </div>
            <p class="muted">{{ lot.souche || 'Souche non précisée' }} · {{ lot.age_semaines }} semaines ({{ lot.age_jours }} j)</p>
            <dl class="chiffres">
              <div><dt>Effectif</dt><dd>{{ lot.effectif | number }}</dd></div>
              <div><dt>Ration</dt><dd>{{ lot.ration_kg | number: '1.0-2' }} kg</dd></div>
              <div><dt>Aliment</dt><dd>{{ lot.type_aliment_libelle || '—' }}</dd></div>
            </dl>
            @if (lot.grammes_par_poule_jour) {
              <p class="petit muted">{{ lot.grammes_par_poule_jour }} g par poule et par jour</p>
            }
            @if (lot.suivi_du_jour; as s) {
              <p class="petit">{{ s.oeufs_intacts + s.oeufs_casses }} œufs ({{ s.oeufs_casses }} cassés) · {{ s.nb_deces }} décès ·
                {{ s.aliment_distribue_kg ?? 0 | number: '1.0-2' }} kg distribués</p>
            }
            <a class="btn primaire large" [routerLink]="['/terrain/saisie', lot.id]" [queryParams]="{ date: d.date }">
              {{ lot.suivi_du_jour ? 'Modifier la saisie' : 'Saisir la journée' }}
            </a>
          </div>
        }
      </div>
    } @else if (!erreur()) {
      <p class="muted">Chargement…</p>
    }
  `,
})
export class TerrainAccueilComponent {
  private api = inject(ApiService);
  readonly sync = inject(SyncService);
  readonly data = signal<TableauTerrain | null>(null);
  readonly erreur = signal('');

  constructor() {
    // Recharge après chaque synchronisation de saisies hors-ligne
    effect(() => {
      this.sync.version();
      this.charger();
    });
  }

  async charger() {
    try {
      this.data.set(await this.api.get<TableauTerrain>('/api/tableau-de-bord/terrain/'));
      this.erreur.set('');
    } catch (e) {
      this.erreur.set(messageErreur(e));
    }
  }

  plateaux(oeufs: number, parPlateau: number): string {
    const p = Math.floor(oeufs / parPlateau);
    const u = oeufs % parPlateau;
    return `${p} plateau${p > 1 ? 'x' : ''}${u ? ` + ${u}` : ''}`;
  }
}
