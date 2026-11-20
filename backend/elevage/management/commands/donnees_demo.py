"""Génère des données de démonstration : `python manage.py donnees_demo`.

Crée (si absents) un administrateur « admin » et un exploitant « papa », deux lots,
90 jours de saisies quotidiennes, des achats d'aliment et des ventes.
À NE PAS lancer sur la base de production.
"""
import random
from datetime import timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand
from django.db import transaction

from elevage.models import (CourbeReference, Lot, MouvementStockAliment, Parametres, ReformePoule,
                            SuiviQuotidien, TransactionFinanciere, aujourd_hui)


class Command(BaseCommand):
    help = "Remplit la base avec des données de démonstration."

    def add_arguments(self, parser):
        parser.add_argument("--jours", type=int, default=90)
        parser.add_argument("--mot-de-passe", default="poulailler2026")

    @transaction.atomic
    def handle(self, *args, jours, mot_de_passe, **opts):
        random.seed(42)
        User = get_user_model()
        if not User.objects.filter(username="admin").exists():
            User.objects.create_superuser("admin", first_name="Giovanni", password=mot_de_passe)
        if not User.objects.filter(username="papa").exists():
            User.objects.create_user("papa", first_name="Papa", password=mot_de_passe)
        admin = User.objects.get(username="admin")
        papa = User.objects.get(username="papa")
        if Lot.objects.exists():
            self.stdout.write(self.style.WARNING("Des lots existent déjà : aucune donnée ajoutée."))
            return

        params = Parametres.get()
        params.prix_plateau_defaut = Decimal("6.00")
        params.save()
        ref = {c.semaine: float(c.taux_ponte_theorique) for c in CourbeReference.objects.all()}
        t = aujourd_hui()
        debut = t - timedelta(days=jours)

        lot_a = Lot.objects.create(nom="Bande A – ISA Brown", souche="ISA Brown", date_arrivee=debut,
                                   age_arrivee_semaines=17, effectif_initial=500, prix_achat_total=Decimal("3250"))
        lot_b = Lot.objects.create(nom="Bande B – Lohmann", souche="Lohmann Brown", date_arrivee=t - timedelta(days=30),
                                   age_arrivee_semaines=16, effectif_initial=300, prix_achat_total=Decimal("1950"))

        # Achats d'aliment
        for j in range(0, jours + 1, 14):
            d = debut + timedelta(days=j)
            for lot in (lot_a, lot_b):
                if d < lot.date_arrivee:
                    continue
                regle = lot.regle_ration(d)
                MouvementStockAliment.objects.create(
                    date=d, type_mouvement="ENTREE", type_aliment=regle.type_aliment, nb_sacs=32 if lot == lot_a else 20,
                    quantite_kg=Decimal(800 if lot == lot_a else 500), cout_achat=Decimal(360 if lot == lot_a else 230),
                    fournisseur="Coopérative agricole", saisi_par=admin)

        # Saisies quotidiennes (pas aujourd'hui, pour montrer les « saisies à faire »)
        for j in range(jours):
            d = debut + timedelta(days=j)
            for lot in (lot_a, lot_b):
                if d < lot.date_arrivee:
                    continue
                effectif = lot.effectif_debut_journee(d)
                taux = ref.get(lot.age_semaines(d), 0) * random.uniform(0.92, 1.01) / 100
                pondus = int(effectif * taux)
                casses = int(pondus * random.uniform(0.01, 0.03))
                deces = 1 if random.random() < 0.12 else 0
                SuiviQuotidien.objects.create(
                    lot=lot, date=d, oeufs_intacts=pondus - casses, oeufs_casses=casses, nb_deces=deces,
                    motif_deces=random.choice(["Maladie", "Picage", "Inconnu", "Étouffement"]) if deces else "",
                    aliment_distribue_kg=(lot.ration_du_jour_kg(d) * Decimal(str(round(random.uniform(.97, 1.03), 2)))).quantize(Decimal("0.1")),
                    saisi_par=papa)

        # Ventes d'œufs (2 par semaine) et charges mensuelles
        for j in range(0, jours, 3):
            d = debut + timedelta(days=j)
            plateaux = random.randint(25, 60)
            if d > debut + timedelta(days=25):
                TransactionFinanciere.objects.create(
                    date=d, type_transaction="RECETTE", categorie="VENTE_OEUFS", quantite=plateaux * 30,
                    montant_total=Decimal(plateaux * 6), client=random.choice(["Épicerie du village", "Marché", "Restaurant Le Coq"]),
                    statut_paiement="IMPAYE" if random.random() < 0.08 else "PAYE", description=f"{plateaux} plateaux", saisi_par=papa)
        for j in range(0, jours, 30):
            d = debut + timedelta(days=j)
            TransactionFinanciere.objects.create(date=d, type_transaction="DEPENSE", categorie="ENERGIE",
                                                 montant_total=Decimal("85"), description="Eau et électricité", saisi_par=admin)
            TransactionFinanciere.objects.create(date=d, type_transaction="DEPENSE", categorie="MAIN_OEUVRE",
                                                 montant_total=Decimal("300"), description="Aide ponctuelle", saisi_par=admin)
        TransactionFinanciere.objects.create(date=debut + timedelta(days=3), type_transaction="DEPENSE", categorie="VETERINAIRE",
                                             montant_total=Decimal("140"), lot=lot_a, description="Vaccin + visite", saisi_par=admin)
        TransactionFinanciere.objects.create(date=t - timedelta(days=10), type_transaction="RECETTE", categorie="VENTE_FIENTE",
                                             quantite=20, montant_total=Decimal("60"), client="Maraîcher voisin", saisi_par=papa)
        ReformePoule.objects.create(lot=lot_a, date=t - timedelta(days=5), quantite_vendue=12, prix_total=Decimal("48"),
                                    client="Particulier", saisi_par=papa)

        self.stdout.write(self.style.SUCCESS(
            f"Données de démonstration créées. Connexion : admin / papa — mot de passe « {mot_de_passe} »."))
