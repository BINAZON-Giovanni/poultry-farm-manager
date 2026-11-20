import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { messageErreur } from '../core/api.service';
import { AuthService } from '../core/auth.service';

@Component({
  selector: 'app-connexion',
  imports: [FormsModule],
  template: `
    <div class="page-auth">
      <form class="carte" (ngSubmit)="valider()">
        <div class="marque centre"><img src="icons/icon-96x96.png" alt="" width="44" height="44" /> Mon Poulailler</div>
        <p class="muted centre">Gestion du poulailler et de l'alimentation</p>
        <div class="champ">
          <label for="u">Identifiant</label>
          <input id="u" name="username" [(ngModel)]="username" autocomplete="username" autocapitalize="none" required />
        </div>
        <div class="champ">
          <label for="p">Mot de passe</label>
          <input id="p" name="password" type="password" [(ngModel)]="password" autocomplete="current-password" required />
        </div>
        <p class="erreur-texte" role="alert">{{ erreur() }}</p>
        <button class="btn primaire large" type="submit" [disabled]="enCours()">{{ enCours() ? 'Connexion…' : 'Se connecter' }}</button>
      </form>
    </div>
  `,
})
export class ConnexionComponent {
  private auth = inject(AuthService);
  private router = inject(Router);
  username = '';
  password = '';
  readonly erreur = signal('');
  readonly enCours = signal(false);

  async valider() {
    this.erreur.set('');
    this.enCours.set(true);
    try {
      await this.auth.connexion(this.username.trim(), this.password);
      this.router.navigateByUrl(this.auth.accueil());
    } catch (e) {
      this.erreur.set(messageErreur(e));
    } finally {
      this.enCours.set(false);
    }
  }
}
