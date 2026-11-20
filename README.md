# Mon Poulailler – gestion d'un élevage de poules pondeuses

Application de gestion d'un poulailler : lots, ponte, alimentation et stock, finances et rentabilité.

- **Backend** : Django + Django REST Framework (`backend/`)
- **Frontend** : Angular, installable en PWA, utilisable hors-ligne (`frontend/`)

## Deux profils

| Profil | Qui | Droits | Écrans |
|---|---|---|---|
| **Administrateur** (superuser) | toi | Tout : création, modification, suppression, paramétrage | Pilotage, Terrain, Lots, Rations, Stock, Finances, Utilisateurs |
| **Exploitant** (terrain) | ton père | Ajout + modification des saisies du jour et des ventes. **Pas de suppression**, pas d'accès aux finances | Aujourd'hui, Ventes, Historique |

Les droits sont vérifiés côté serveur (`backend/elevage/permissions.py`) et dans l'interface (guards Angular, `frontend/src/app/core/guards.ts`).

## Modules

- **A. Lots et cheptel** : âge en jours et en semaines, effectif vivant = initial − Σ décès − Σ réformes. Le prix d'achat crée automatiquement une dépense.
- **B. Alimentation et stock** : une grille de rationnement par tranche d'âge. Ration du jour (kg) = effectif × g/poule ÷ 1000. Un achat de sacs entre dans le stock et crée une dépense. La distribution saisie chaque jour sort automatiquement du stock (ajustable). Une alerte s'affiche si le stock passe sous le seuil ou couvre moins de 7 jours.
- **C. Ponte** : une saisie par lot et par jour (plateaux de 30 + unités convertis automatiquement, œufs cassés, mortalité, aliment). On y trouve le taux de ponte et l'indice de consommation (g d'aliment par œuf).
- **D. Finances** : ventes d'œufs, réformes et fiente, avec suivi payé/impayé. Les dépenses sont classées par catégorie. Indicateurs : coût de revient d'un œuf et marge globale et par lot.
- **E. Tableaux de bord** : vue Terrain (tablette) et vue Pilotage. Le Pilotage montre la courbe de ponte réelle comparée à la courbe théorique de la souche, la mortalité et le bilan mensuel.

## Lancer en développement

Prérequis : Python 3.12+ et Node.js 22.

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python manage.py migrate
.venv/bin/python manage.py createsuperuser        # ton compte administrateur
.venv/bin/python manage.py runserver 0.0.0.0:8000
```

Dans un second terminal :

```bash
cd frontend
npm install
npx ng serve --host 0.0.0.0     # http://localhost:4200 (les appels /api sont relayés vers Django)
```

Le compte de ton père se crée ensuite dans l'application (menu **Utilisateurs**, profil « Exploitant »).

**Données de démonstration** (base de test uniquement) : `.venv/bin/python manage.py donnees_demo`
crée les comptes `admin` et `papa` (mot de passe `poulailler2026`), deux lots et 90 jours de saisies.

**Tests backend** : `.venv/bin/python manage.py test elevage`

## Mise en production (un seul serveur)

Django sert à la fois l'API et le build Angular (via WhiteNoise) :

```bash
cd frontend && npm ci && npx ng build
cd ../backend
export DJANGO_DEBUG=0 DJANGO_SECRET_KEY='<longue-chaine-aleatoire>' \
       DJANGO_ALLOWED_HOSTS='poulailler.mondomaine.fr' \
       DJANGO_CSRF_TRUSTED_ORIGINS='https://poulailler.mondomaine.fr' \
       DATABASE_URL='postgres://user:mdp@localhost/poulailler'   # facultatif, SQLite par défaut
.venv/bin/python manage.py migrate
.venv/bin/python manage.py collectstatic --noinput
.venv/bin/pip install gunicorn && .venv/bin/gunicorn config.wsgi -b 0.0.0.0:8000
```

Mets un reverse proxy HTTPS devant (Caddy ou nginx). **HTTPS est obligatoire** pour installer la PWA sur la tablette et pour activer le mode hors-ligne.

## Installer sur la tablette

Ouvre l'adresse du site dans Chrome (Android) ou Safari (iPad), puis choisis **« Ajouter à l'écran d'accueil »**. L'application s'ouvre alors en plein écran.

**Hors-ligne :** l'application et les dernières données consultées restent disponibles sans réseau. Les saisies faites pendant une coupure sont gardées sur la tablette. Elles partent automatiquement au retour du réseau. Chaque saisie porte un identifiant unique, le serveur ne l'enregistre donc jamais deux fois.

Pour une application native (Play Store / App Store) plus tard, on peut encapsuler le même code Angular avec Capacitor (`npm i @capacitor/core @capacitor/cli && npx cap init`).

## Structure

```
backend/
  config/            réglages Django (variables d'environnement)
  elevage/
    models.py        Lot, RegleRationnement, SuiviQuotidien, ReformePoule,
                     MouvementStockAliment, TransactionFinanciere, Parametres, CourbeReference
    services.py      calculs : tableaux de bord, indicateurs, stock
    permissions.py   profils Administrateur / Exploitant
    views.py, urls.py, serializers.py   API REST (/api/…)
    migrations/0002_donnees_initiales.py  grille de rations et courbe de ponte par défaut
    tests.py
frontend/src/app/
  core/      auth, intercepteur, guards, API, synchronisation hors-ligne
  terrain/   vue tablette : accueil, saisie du jour, ventes, historique
  admin/     pilotage, lots, rations, stock, finances, utilisateurs
  shared/    graphique SVG, compteur tactile, modale
```

Les valeurs par défaut des rations et de la courbe de ponte sont indicatives (souche brune type ISA Brown). Adapte-les au guide de ta souche dans l'écran **Rations**.
