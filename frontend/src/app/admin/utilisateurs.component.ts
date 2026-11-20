import { DatePipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, messageErreur } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { UtilisateurAdmin } from '../core/models';
import { NotificationService } from '../core/notification.service';
import { ModaleComponent } from '../shared/modale.component';

@Component({
  selector: 'app-utilisateurs',
  imports: [FormsModule, DatePipe, ModaleComponent],
  template: `
    <div class="entete-page">
      <h1>Utilisateurs</h1>
      <button class="btn primaire" type="button" (click)="nouveau()">+ Nouvel utilisateur</button>
    </div>
    <div class="carte">
      <div class="tableau-defile">
        <table>
          <thead><tr><th>Nom</th><th>Identifiant</th><th>Profil</th><th>Dernière connexion</th><th>État</th><th></th></tr></thead>
          <tbody>
            @for (u of utilisateurs(); track u.id) {
              <tr>
                <td>{{ u.nom_affiche }}</td>
                <td>{{ u.username }}</td>
                <td><span class="badge" [class.accent]="u.role === 'admin'">{{ u.role === 'admin' ? 'Administrateur' : 'Exploitant' }}</span></td>
                <td class="muted">{{ u.last_login ? (u.last_login | date: 'dd/MM/y HH:mm') : 'jamais' }}</td>
                <td>@if (!u.is_active) { <span class="badge">Désactivé</span> }</td>
                <td class="actions"><button class="btn petit" type="button" (click)="modifier(u)">Modifier</button></td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      <p class="petit muted">L’exploitant (terrain) peut ajouter et modifier les saisies du jour et les ventes, sans jamais rien supprimer ni voir les finances.</p>
    </div>

    @if (edition(); as u) {
      <app-modale [titre]="u.id ? 'Modifier ' + u.username : 'Nouvel utilisateur'" (fermer)="edition.set(null)">
        <form (ngSubmit)="enregistrer(u)">
          <div class="grille deux">
            <div class="champ"><label for="p">Prénom</label><input id="p" name="prenom" [(ngModel)]="u.first_name" /></div>
            <div class="champ"><label for="n">Nom</label><input id="n" name="nom" [(ngModel)]="u.last_name" /></div>
            <div class="champ"><label for="u">Identifiant de connexion</label><input id="u" name="username" [(ngModel)]="u.username" required autocapitalize="none" /></div>
            <div class="champ"><label for="e">Email (facultatif)</label><input id="e" name="email" type="email" [(ngModel)]="u.email" /></div>
            <div class="champ"><label for="r">Profil</label>
              <select id="r" name="role" [(ngModel)]="u.role" [disabled]="u.id === auth.utilisateur()?.id">
                <option value="exploitant">Exploitant / terrain</option><option value="admin">Administrateur</option></select></div>
            <div class="champ"><label for="pw">{{ u.id ? 'Nouveau mot de passe (laisser vide)' : 'Mot de passe' }}</label>
              <input id="pw" name="password" type="password" [(ngModel)]="u.password" [required]="!u.id" autocomplete="new-password" /></div>
          </div>
          @if (u.id && u.id !== auth.utilisateur()?.id) {
            <label class="case"><input type="checkbox" name="actif" [(ngModel)]="u.is_active" /> Compte actif</label>
          }
          <p class="erreur-texte">{{ erreur() }}</p>
          <div class="actions-modale">
            @if (u.id && u.id !== auth.utilisateur()?.id) { <button class="btn danger" type="button" (click)="supprimer(u)">Supprimer</button> }
            <button class="btn" type="button" (click)="edition.set(null)">Annuler</button>
            <button class="btn primaire" type="submit">Enregistrer</button>
          </div>
        </form>
      </app-modale>
    }
  `,
})
export class UtilisateursComponent implements OnInit {
  private api = inject(ApiService);
  private notif = inject(NotificationService);
  readonly auth = inject(AuthService);
  readonly utilisateurs = signal<UtilisateurAdmin[]>([]);
  readonly edition = signal<UtilisateurAdmin | null>(null);
  readonly erreur = signal('');

  ngOnInit() {
    this.charger();
  }

  async charger() {
    this.utilisateurs.set(await this.api.get<UtilisateurAdmin[]>('/api/utilisateurs/'));
  }

  nouveau() {
    this.erreur.set('');
    this.edition.set({ username: '', first_name: '', last_name: '', email: '', is_active: true, role: 'exploitant', password: '' });
  }

  modifier(u: UtilisateurAdmin) {
    this.erreur.set('');
    this.edition.set({ ...u, password: '' });
  }

  async enregistrer(u: UtilisateurAdmin) {
    const corps: Partial<UtilisateurAdmin> = { ...u };
    if (!corps.password) delete corps.password;
    try {
      if (u.id) await this.api.patch(`/api/utilisateurs/${u.id}/`, corps);
      else await this.api.post('/api/utilisateurs/', corps);
      this.edition.set(null);
      this.notif.succes('Utilisateur enregistré');
      this.charger();
    } catch (e) {
      this.erreur.set(messageErreur(e));
    }
  }

  async supprimer(u: UtilisateurAdmin) {
    if (!confirm(`Supprimer le compte « ${u.username} » ? (Vous pouvez aussi simplement le désactiver.)`)) return;
    try {
      await this.api.delete(`/api/utilisateurs/${u.id}/`);
      this.edition.set(null);
      this.charger();
    } catch (e) {
      this.erreur.set(messageErreur(e));
    }
  }
}
