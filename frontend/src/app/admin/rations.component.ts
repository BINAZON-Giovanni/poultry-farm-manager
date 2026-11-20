import { DecimalPipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, messageErreur } from '../core/api.service';
import { Choix, ListesChoix, Parametres, PointCourbe, RegleRationnement } from '../core/models';
import { NotificationService } from '../core/notification.service';
import { GraphiqueComponent } from '../shared/graphique.component';
import { ModaleComponent } from '../shared/modale.component';

/** Module B (paramétrage) : grille de rationnement, paramètres et courbe théorique de la souche. */
@Component({
  selector: 'app-rations',
  imports: [FormsModule, DecimalPipe, ModaleComponent, GraphiqueComponent],
  template: `
    <div class="entete-page"><h1>Rations & paramètres</h1></div>

    <div class="carte">
      <div class="ligne-entre">
        <h2>Grille de rationnement</h2>
        <button class="btn primaire petit" type="button" (click)="nouvelleRegle()">+ Ajouter une tranche</button>
      </div>
      <p class="muted petit">Ration du jour (kg) = effectif vivant × grammage prévu pour l’âge ÷ 1000. Valeurs indicatives : ajustez-les selon le guide de votre souche.</p>
      <div class="tableau-defile">
        <table>
          <thead><tr><th>Âge (semaines)</th><th>Type d’aliment</th><th class="droite">g / poule / jour</th><th class="droite">Pour 100 poules</th><th></th></tr></thead>
          <tbody>
            @for (r of regles(); track r.id) {
              <tr>
                <td>S{{ r.semaine_debut }} à S{{ r.semaine_fin }}</td>
                <td>{{ r.type_aliment_libelle }}</td>
                <td class="droite">{{ r.grammes_par_poule_jour | number: '1.0-1' }} g</td>
                <td class="droite muted">{{ r.grammes_par_poule_jour / 10 | number: '1.0-1' }} kg/j</td>
                <td class="actions"><button class="btn petit" type="button" (click)="editionRegle.set({ ...r })">Modifier</button></td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </div>

    <div class="grille deux">
      <form class="carte" (ngSubmit)="enregistrerParametres()">
        <h2>Paramètres</h2>
        @if (parametres(); as p) {
          <div class="champ"><label for="seuil">Seuil d’alerte du stock d’aliment (kg)</label>
            <input id="seuil" name="seuil" type="number" min="0" step="1" [(ngModel)]="p.seuil_alerte_stock_kg" /></div>
          <div class="champ"><label for="plat">Œufs par plateau</label>
            <input id="plat" name="plat" type="number" min="1" [(ngModel)]="p.oeufs_par_plateau" /></div>
          <div class="champ"><label for="prix">Prix habituel d’un plateau (€)</label>
            <input id="prix" name="prix" type="number" min="0" step="0.01" [(ngModel)]="p.prix_plateau_defaut" /></div>
          <button class="btn primaire" type="submit">Enregistrer</button>
        }
      </form>

      <div class="carte">
        <div class="ligne-entre">
          <h2>Courbe de ponte théorique</h2>
          <button class="btn petit" type="button" (click)="ouvrirCourbe()">Modifier</button>
        </div>
        @if (courbe().length) {
          <app-graphique [labels]="courbeLabels()" [series]="[{ nom: 'Théorique', valeurs: courbeValeurs(), couleur: 'var(--serie-1)' }]"
                         unite=" %" [maxFixe]="100" titre="Courbe de ponte théorique" />
        }
        <p class="petit muted">Taux de ponte attendu par semaine d’âge, comparé au réel dans « Pilotage ».</p>
      </div>
    </div>

    @if (editionRegle(); as r) {
      <app-modale [titre]="r.id ? 'Modifier la tranche' : 'Nouvelle tranche'" (fermer)="editionRegle.set(null)">
        <form (ngSubmit)="enregistrerRegle(r)">
          <div class="grille deux">
            <div class="champ"><label for="sd">Semaine de début</label><input id="sd" name="sd" type="number" min="0" [(ngModel)]="r.semaine_debut" required /></div>
            <div class="champ"><label for="sf">Semaine de fin (incluse)</label><input id="sf" name="sf" type="number" min="0" [(ngModel)]="r.semaine_fin" required /></div>
            <div class="champ"><label for="ta">Type d’aliment</label>
              <select id="ta" name="ta" [(ngModel)]="r.type_aliment" required>
                @for (t of typesAliment(); track t.value) { <option [value]="t.value">{{ t.label }}</option> }
              </select></div>
            <div class="champ"><label for="g">Grammes / poule / jour</label><input id="g" name="g" type="number" min="0" step="0.5" [(ngModel)]="r.grammes_par_poule_jour" required /></div>
          </div>
          <p class="erreur-texte">{{ erreur() }}</p>
          <div class="actions-modale">
            @if (r.id) { <button class="btn danger" type="button" (click)="supprimerRegle(r)">Supprimer</button> }
            <button class="btn" type="button" (click)="editionRegle.set(null)">Annuler</button>
            <button class="btn primaire" type="submit">Enregistrer</button>
          </div>
        </form>
      </app-modale>
    }

    @if (texteCourbe() !== null) {
      <app-modale titre="Courbe théorique de la souche" (fermer)="texteCourbe.set(null)">
        <p class="petit muted">Une ligne par semaine : <code>semaine;taux</code> (ex. <code>25;94</code>). Reprenez les valeurs du guide d’élevage de votre souche.</p>
        <textarea rows="14" class="monospace" [ngModel]="texteCourbe()" (ngModelChange)="texteCourbe.set($event)" aria-label="Courbe"></textarea>
        <p class="erreur-texte">{{ erreur() }}</p>
        <div class="actions-modale">
          <button class="btn" type="button" (click)="texteCourbe.set(null)">Annuler</button>
          <button class="btn primaire" type="button" (click)="enregistrerCourbe()">Enregistrer</button>
        </div>
      </app-modale>
    }
  `,
})
export class RationsComponent implements OnInit {
  private api = inject(ApiService);
  private notif = inject(NotificationService);
  readonly regles = signal<RegleRationnement[]>([]);
  readonly typesAliment = signal<Choix[]>([]);
  readonly parametres = signal<Parametres | null>(null);
  readonly courbe = signal<PointCourbe[]>([]);
  readonly editionRegle = signal<RegleRationnement | null>(null);
  readonly texteCourbe = signal<string | null>(null);
  readonly erreur = signal('');
  readonly courbeLabels = computed(() => this.courbe().map((p) => 'S' + p.semaine));
  readonly courbeValeurs = computed(() => this.courbe().map((p) => Number(p.taux_ponte_theorique)));

  async ngOnInit() {
    try {
      const [regles, choix, params, courbe] = await Promise.all([
        this.api.get<RegleRationnement[]>('/api/regles-rationnement/'),
        this.api.get<ListesChoix>('/api/choix/'),
        this.api.get<Parametres>('/api/parametres/'),
        this.api.get<PointCourbe[]>('/api/courbe-reference/'),
      ]);
      this.regles.set(regles);
      this.typesAliment.set(choix.types_aliment);
      this.parametres.set(params);
      this.courbe.set(courbe);
    } catch (e) {
      this.notif.erreur(messageErreur(e));
    }
  }

  nouvelleRegle() {
    const derniere = this.regles().at(-1);
    this.erreur.set('');
    this.editionRegle.set({ semaine_debut: derniere ? derniere.semaine_fin + 1 : 0, semaine_fin: (derniere?.semaine_fin ?? 0) + 5,
      type_aliment: 'PONTE', grammes_par_poule_jour: 120 });
  }

  async enregistrerRegle(r: RegleRationnement) {
    try {
      if (r.id) await this.api.put(`/api/regles-rationnement/${r.id}/`, r);
      else await this.api.post('/api/regles-rationnement/', r);
      this.editionRegle.set(null);
      this.regles.set(await this.api.get<RegleRationnement[]>('/api/regles-rationnement/'));
      this.notif.succes('Grille mise à jour');
    } catch (e) {
      this.erreur.set(messageErreur(e));
    }
  }

  async supprimerRegle(r: RegleRationnement) {
    if (!confirm('Supprimer cette tranche de la grille ?')) return;
    await this.api.delete(`/api/regles-rationnement/${r.id}/`);
    this.editionRegle.set(null);
    this.regles.set(await this.api.get<RegleRationnement[]>('/api/regles-rationnement/'));
  }

  async enregistrerParametres() {
    try {
      this.parametres.set(await this.api.put<Parametres>('/api/parametres/', this.parametres()));
      this.notif.succes('Paramètres enregistrés');
    } catch (e) {
      this.notif.erreur(messageErreur(e));
    }
  }

  ouvrirCourbe() {
    this.erreur.set('');
    this.texteCourbe.set(this.courbe().map((p) => `${p.semaine};${p.taux_ponte_theorique}`).join('\n'));
  }

  async enregistrerCourbe() {
    const points: PointCourbe[] = [];
    for (const [i, ligne] of (this.texteCourbe() ?? '').split('\n').entries()) {
      if (!ligne.trim()) continue;
      const [s, t] = ligne.split(/[;,\t ]+/).map((x) => Number(x.replace(',', '.')));
      if (!Number.isInteger(s) || !Number.isFinite(t) || t < 0 || t > 100) {
        this.erreur.set(`Ligne ${i + 1} invalide : « ${ligne} »`);
        return;
      }
      points.push({ semaine: s, taux_ponte_theorique: t });
    }
    try {
      this.courbe.set(await this.api.put<PointCourbe[]>('/api/courbe-reference/remplacer/', points));
      this.texteCourbe.set(null);
      this.notif.succes('Courbe enregistrée');
    } catch (e) {
      this.erreur.set(messageErreur(e));
    }
  }
}
