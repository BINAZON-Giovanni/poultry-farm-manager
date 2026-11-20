import { Routes } from '@angular/router';
import { accueilGuard, adminGuard, connecteGuard, inviteGuard } from './core/guards';
import { ShellComponent } from './layout/shell.component';
import { ConnexionComponent } from './pages/connexion.component';

export const routes: Routes = [
  { path: 'connexion', component: ConnexionComponent, canActivate: [inviteGuard], title: 'Connexion · Mon Poulailler' },
  {
    path: '',
    component: ShellComponent,
    canActivate: [connecteGuard],
    children: [
      { path: '', pathMatch: 'full', canActivate: [accueilGuard], children: [] },
      // Vue « Terrain » : exploitant et administrateur
      { path: 'terrain', title: 'Aujourd’hui', loadComponent: () => import('./terrain/terrain-accueil.component').then((m) => m.TerrainAccueilComponent) },
      { path: 'terrain/saisie/:lotId', title: 'Saisie du jour', loadComponent: () => import('./terrain/saisie-jour.component').then((m) => m.SaisieJourComponent) },
      { path: 'terrain/ventes', title: 'Ventes', loadComponent: () => import('./terrain/ventes.component').then((m) => m.VentesComponent) },
      { path: 'terrain/historique', title: 'Historique', loadComponent: () => import('./terrain/historique.component').then((m) => m.HistoriqueComponent) },
      { path: 'compte', title: 'Mon compte', loadComponent: () => import('./pages/compte.component').then((m) => m.CompteComponent) },
      // Vue « Pilotage » et paramétrage : administrateur uniquement
      {
        path: '',
        canActivateChild: [adminGuard],
        children: [
          { path: 'pilotage', title: 'Pilotage', loadComponent: () => import('./admin/pilotage.component').then((m) => m.PilotageComponent) },
          { path: 'lots', title: 'Lots', loadComponent: () => import('./admin/lots.component').then((m) => m.LotsComponent) },
          { path: 'rations', title: 'Rations', loadComponent: () => import('./admin/rations.component').then((m) => m.RationsComponent) },
          { path: 'stock', title: 'Stock', loadComponent: () => import('./admin/stock.component').then((m) => m.StockComponent) },
          { path: 'finances', title: 'Finances', loadComponent: () => import('./admin/finances.component').then((m) => m.FinancesComponent) },
          { path: 'utilisateurs', title: 'Utilisateurs', loadComponent: () => import('./admin/utilisateurs.component').then((m) => m.UtilisateursComponent) },
        ],
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
