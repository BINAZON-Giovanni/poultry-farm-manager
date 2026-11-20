import { Component, HostListener, input, output } from '@angular/core';

@Component({
  selector: 'app-modale',
  template: `
    <div class="voile" (click)="fermer.emit()"></div>
    <div class="modale" role="dialog" aria-modal="true" [attr.aria-label]="titre()">
      <div class="ligne-entre"><h2>{{ titre() }}</h2>
        <button type="button" class="btn icone" (click)="fermer.emit()" aria-label="Fermer">✕</button></div>
      <ng-content />
    </div>
  `,
})
export class ModaleComponent {
  readonly titre = input('');
  readonly fermer = output<void>();

  @HostListener('document:keydown.escape')
  echap() {
    this.fermer.emit();
  }
}
