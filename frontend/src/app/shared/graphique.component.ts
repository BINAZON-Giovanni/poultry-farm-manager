import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';

export interface Serie {
  nom: string;
  valeurs: (number | null)[];
  /** Variable CSS de couleur, ex. 'var(--serie-1)' */
  couleur: string;
  /** Courbe en pointillés (ex. théorique) */
  pointilles?: boolean;
}

/**
 * Graphique SVG léger (courbes ou barres groupées), responsive, adapté au tactile.
 * Les valeurs nulles créent une coupure dans la courbe.
 */
@Component({
  selector: 'app-graphique',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (series().length > 1) {
      <div class="legende">
        @for (s of series(); track s.nom) {
          <span><i [style.background]="s.couleur" [class.pointilles]="s.pointilles"></i>{{ s.nom }}</span>
        }
      </div>
    }
    <div class="graphique-zone">
      <svg [attr.viewBox]="'0 0 ' + L + ' ' + H" preserveAspectRatio="none" class="graphique" role="img" [attr.aria-label]="titre()"
           (pointerleave)="survol.set(null)">
        @for (g of graduations(); track g.v) {
          <line [attr.x1]="M.g" [attr.x2]="L - M.d" [attr.y1]="g.y" [attr.y2]="g.y" class="ligne-grille" />
        }
        @if (type() === 'barres') {
          @for (b of barres(); track $index) {
            <rect [attr.x]="b.x" [attr.y]="b.y" [attr.width]="b.l" [attr.height]="b.h" [attr.fill]="b.couleur" rx="2" />
          }
        } @else {
          @for (c of courbes(); track c.nom) {
            <path [attr.d]="c.d" fill="none" [attr.stroke]="c.couleur" stroke-width="2.5" vector-effect="non-scaling-stroke"
                  stroke-linejoin="round" stroke-linecap="round" [attr.stroke-dasharray]="c.pointilles ? '6 5' : null" />
          }
        }
        @if (survol() !== null) {
          <line [attr.x1]="xCentre(survol()!)" [attr.x2]="xCentre(survol()!)" [attr.y1]="M.h" [attr.y2]="H - M.b" class="curseur" />
        }
        @for (e of etiquettes(); track e.cle; let i = $index) {
          <rect [attr.x]="xCentre(e.i) - pas() / 2" [attr.y]="M.h" [attr.width]="pas()" [attr.height]="H - M.h - M.b"
                fill="transparent" (pointerenter)="survol.set(e.i)" (click)="survol.set(e.i)" />
        }
      </svg>
      <div class="axe-y">
        @for (g of graduations(); track g.v) {
          <span [style.top.%]="(g.y / H) * 100">{{ g.v }}{{ unite() }}</span>
        }
      </div>
      <div class="axe-x">
        @for (e of etiquettesAxe(); track e.cle) {
          <span [style.left.%]="(xCentre(e.i) / L) * 100">{{ e.texte }}</span>
        }
      </div>
      @if (survol() !== null) {
        <div class="infobulle" [style.left.%]="(xCentre(survol()!) / L) * 100" [class.droite]="survol()! > etiquettes().length / 2">
          <strong>{{ etiquettes()[survol()!].texte }}</strong>
          @for (s of series(); track s.nom) {
            <div><i [style.background]="s.couleur"></i>{{ s.nom }} : {{ format(s.valeurs[survol()!]) }}</div>
          }
        </div>
      }
    </div>
  `,
})
export class GraphiqueComponent {
  readonly type = input<'courbes' | 'barres'>('courbes');
  readonly labels = input.required<string[]>();
  readonly series = input.required<Serie[]>();
  readonly unite = input('');
  readonly titre = input('Graphique');
  readonly maxFixe = input<number | null>(null);

  readonly L = 600;
  readonly H = 220;
  readonly M = { h: 10, d: 8, b: 26, g: 8 };
  readonly survol = signal<number | null>(null);

  readonly max = computed(() => {
    const vals = this.series().flatMap((s) => s.valeurs.filter((v): v is number => v !== null));
    // Au moins 4 pour garder des graduations entières sur les petites valeurs (ex. décès)
    const m = this.maxFixe() ?? Math.max(4, ...vals);
    return arrondiHaut(m);
  });
  readonly min = computed(() => {
    const vals = this.series().flatMap((s) => s.valeurs.filter((v): v is number => v !== null));
    return Math.min(0, ...vals);
  });
  readonly pas = computed(() => (this.L - this.M.g - this.M.d) / Math.max(1, this.labels().length));

  xCentre(i: number): number {
    return this.M.g + this.pas() * (i + 0.5);
  }
  private y(v: number): number {
    const zone = this.H - this.M.h - this.M.b;
    return this.M.h + zone - ((v - this.min()) / (this.max() - this.min() || 1)) * zone;
  }

  readonly graduations = computed(() => {
    const n = 4;
    return Array.from({ length: n + 1 }, (_, k) => {
      const v = this.min() + ((this.max() - this.min()) * k) / n;
      return { v: Math.round(v * 10) / 10, y: this.y(v) };
    });
  });

  readonly courbes = computed(() =>
    this.series().map((s) => {
      let d = '';
      let enCours = false;
      s.valeurs.forEach((v, i) => {
        if (v === null || v === undefined) {
          enCours = false;
          return;
        }
        d += `${enCours ? 'L' : 'M'}${this.xCentre(i).toFixed(1)},${this.y(v).toFixed(1)}`;
        enCours = true;
      });
      return { nom: s.nom, d, couleur: s.couleur, pointilles: s.pointilles };
    }),
  );

  readonly barres = computed(() => {
    const n = this.series().length;
    const groupe = this.pas() * 0.75;
    const l = groupe / n;
    const zero = this.y(0);
    return this.series().flatMap((s, k) =>
      s.valeurs.map((v, i) => {
        const val = v ?? 0;
        const y = this.y(val);
        return { x: this.xCentre(i) - groupe / 2 + k * l, y: Math.min(y, zero), l: Math.max(1, l - 1), h: Math.abs(zero - y), couleur: s.couleur };
      }),
    );
  });

  readonly etiquettes = computed(() => this.labels().map((texte, i) => ({ texte, i, cle: i + texte })));
  readonly etiquettesAxe = computed(() => {
    const e = this.etiquettes();
    const tous = Math.max(1, Math.ceil(e.length / 8));
    return e.filter((x) => x.i % tous === 0);
  });

  format(v: number | null | undefined): string {
    return v === null || v === undefined ? '—' : `${v.toLocaleString('fr-FR')}${this.unite()}`;
  }
}

function arrondiHaut(m: number): number {
  if (m <= 10) return Math.ceil(m);
  const p = Math.pow(10, Math.floor(Math.log10(m)) - 1);
  return Math.ceil(m / p / 5) * 5 * p;
}
