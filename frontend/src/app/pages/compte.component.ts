import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, messageErreur } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { NotificationService } from '../core/notification.service';

@Component({
  selector: 'app-compte',
  imports: [FormsModule],
  template: `
    <div class="entete-page"><h1>Mon compte</h1></div>
    <div class="carte etroite">
      <p><strong>{{ auth.utilisateur()?.nom }}</strong> ({{ auth.utilisateur()?.username }})<br />
        <span class="muted">{{ auth.estAdmin() ? 'Administrateur' : 'Exploitant / terrain' }}</span></p>
      <h2>Changer de mot de passe</h2>
      <form #f="ngForm" (ngSubmit)="valider(); f.resetForm()">
        <div class="champ"><label for="a">Mot de passe actuel</label>
          <input id="a" name="ancien" type="password" [(ngModel)]="ancien" required autocomplete="current-password" /></div>
        <div class="champ"><label for="n">Nouveau mot de passe (8 caractères minimum)</label>
          <input id="n" name="nouveau" type="password" [(ngModel)]="nouveau" required minlength="8" autocomplete="new-password" /></div>
        <p class="erreur-texte">{{ erreur() }}</p>
        <button class="btn primaire" type="submit">Enregistrer</button>
      </form>
    </div>
  `,
})
export class CompteComponent {
  readonly auth = inject(AuthService);
  private api = inject(ApiService);
  private notif = inject(NotificationService);
  ancien = '';
  nouveau = '';
  readonly erreur = signal('');

  async valider() {
    const corps = { ancien: this.ancien, nouveau: this.nouveau };
    this.erreur.set('');
    try {
      await this.api.post('/api/auth/mot-de-passe/', corps);
      this.notif.succes('Mot de passe modifié');
    } catch (e) {
      this.erreur.set(messageErreur(e));
    }
  }
}
