import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';

/** Compteur tactile : gros boutons − / + autour d'un champ numérique. */
@Component({
  selector: 'app-compteur',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="compteur">
      <button type="button" class="btn rond" (click)="changer(-pas())" [disabled]="valeur() <= min()" [attr.aria-label]="'Diminuer ' + libelle()">−</button>
      <input type="number" inputmode="decimal" [attr.aria-label]="libelle()" [min]="min()" [step]="pas()"
             [value]="valeur()" (input)="saisir($any($event.target).value)" (focus)="$any($event.target).select()" />
      <button type="button" class="btn rond" (click)="changer(pas())" [attr.aria-label]="'Augmenter ' + libelle()">+</button>
    </div>
  `,
})
export class CompteurComponent {
  readonly valeur = model(0);
  readonly min = input(0);
  readonly pas = input(1);
  readonly libelle = input('');

  changer(delta: number) {
    this.valeur.set(Math.max(this.min(), Math.round((this.valeur() + delta) * 100) / 100));
  }

  saisir(v: string) {
    const n = Number(v.replace(',', '.'));
    this.valeur.set(Number.isFinite(n) ? Math.max(this.min(), n) : this.min());
  }
}
