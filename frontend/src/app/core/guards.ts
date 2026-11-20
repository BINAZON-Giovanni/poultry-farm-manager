import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

/** Utilisateur connecté (admin ou exploitant). */
export const connecteGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  return auth.estConnecte() || inject(Router).parseUrl('/connexion');
};

/** Écrans réservés à l'administrateur : l'exploitant est renvoyé vers la vue terrain. */
export const adminGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  if (!auth.estConnecte()) return inject(Router).parseUrl('/connexion');
  return auth.estAdmin() || inject(Router).parseUrl('/terrain');
};

/** Page de connexion : inutile si déjà connecté. */
export const inviteGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  return !auth.estConnecte() || inject(Router).parseUrl(auth.accueil());
};

/** Redirige la racine vers l'accueil du profil. */
export const accueilGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  return inject(Router).parseUrl(auth.estConnecte() ? auth.accueil() : '/connexion');
};
