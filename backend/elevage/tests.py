import uuid
from datetime import timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from .models import (Lot, MouvementStockAliment, ReformePoule, SuiviQuotidien, TransactionFinanciere,
                     aujourd_hui)

User = get_user_model()


class BaseTest(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_superuser("admin", password="motdepasse-admin")
        self.pere = User.objects.create_user("papa", password="motdepasse-papa")
        self.today = aujourd_hui()
        # Lot arrivé il y a 14 jours à 20 semaines -> 22 semaines aujourd'hui
        self.lot = Lot.objects.create(nom="Bande A", date_arrivee=self.today - timedelta(days=14),
                                      age_arrivee_semaines=20, effectif_initial=100,
                                      prix_achat_total=Decimal("800"))

    def en_admin(self):
        self.client.force_authenticate(self.admin)

    def en_exploitant(self):
        self.client.force_authenticate(self.pere)


class ModuleALotsTests(BaseTest):
    def test_age_calcule(self):
        self.assertEqual(self.lot.age_jours(), 20 * 7 + 14)
        self.assertEqual(self.lot.age_semaines(), 22)

    def test_effectif_initial_moins_deces_moins_reformes(self):
        SuiviQuotidien.objects.create(lot=self.lot, date=self.today - timedelta(days=2), nb_deces=3)
        SuiviQuotidien.objects.create(lot=self.lot, date=self.today - timedelta(days=1), nb_deces=2)
        ReformePoule.objects.create(lot=self.lot, date=self.today, quantite_vendue=10, prix_total=Decimal("50"))
        self.assertEqual(self.lot.effectif_actuel(), 100 - 5 - 10)
        # Effectif au matin d'hier : seuls les décès d'avant-hier sont déduits
        self.assertEqual(self.lot.effectif_debut_journee(self.today - timedelta(days=1)), 97)

    def test_achat_du_lot_cree_une_depense(self):
        tr = TransactionFinanciere.objects.get(lot_achat=self.lot)
        self.assertEqual(tr.categorie, "ACHAT_POULETTES")
        self.assertEqual(tr.montant_total, Decimal("800"))
        self.lot.prix_achat_total = Decimal("900")
        self.lot.save()
        self.assertEqual(TransactionFinanciere.objects.get(lot_achat=self.lot).montant_total, Decimal("900"))

    def test_reforme_alimente_la_tresorerie(self):
        r = ReformePoule.objects.create(lot=self.lot, quantite_vendue=20, prix_total=Decimal("120"))
        tr = TransactionFinanciere.objects.get(reforme=r)
        self.assertEqual((tr.type_transaction, tr.montant_total), ("RECETTE", Decimal("120")))

    def test_reforme_impossible_au_dela_de_l_effectif(self):
        self.en_exploitant()
        r = self.client.post("/api/reformes/", {"lot": self.lot.id, "quantite_vendue": 101, "prix_total": 10})
        self.assertEqual(r.status_code, 400)


class ModuleBAlimentationTests(BaseTest):
    def test_ration_du_jour(self):
        # 22 semaines -> règle Ponte 120 g ; 100 poules -> 12 kg
        self.assertEqual(self.lot.ration_du_jour_kg(), Decimal("12.00"))

    def test_distribution_deduit_le_stock(self):
        MouvementStockAliment.objects.create(type_mouvement="ENTREE", type_aliment="PONTE",
                                             quantite_kg=Decimal("500"), cout_achat=Decimal("250"))
        self.en_exploitant()
        r = self.client.post("/api/suivis/", {"lot": self.lot.id, "date": str(self.today),
                                              "oeufs_intacts": 85, "aliment_distribue_kg": "11.5"})
        self.assertEqual(r.status_code, 201, r.data)
        stock = self.client.get("/api/stock/etat/").data
        self.assertEqual(stock["total_kg"], 488.5)
        # Achat d'aliment -> dépense automatique
        self.assertTrue(TransactionFinanciere.objects.filter(categorie="ALIMENT", montant_total=250).exists())

    def test_alerte_stock_bas(self):
        self.en_admin()
        stock = self.client.get("/api/stock/etat/").data
        self.assertTrue(stock["alerte"])

    def test_regles_sans_chevauchement(self):
        self.en_admin()
        r = self.client.post("/api/regles-rationnement/", {"semaine_debut": 10, "semaine_fin": 12,
                                                           "type_aliment": "CROISSANCE", "grammes_par_poule_jour": 60})
        self.assertEqual(r.status_code, 400)


class ModuleCPonteTests(BaseTest):
    def test_taux_de_ponte(self):
        s = SuiviQuotidien.objects.create(lot=self.lot, date=self.today, oeufs_intacts=88, oeufs_casses=2)
        self.assertEqual(s.taux_ponte, 90.0)

    def test_saisie_unique_par_jour_mise_a_jour(self):
        self.en_exploitant()
        data = {"lot": self.lot.id, "date": str(self.today), "oeufs_intacts": 80}
        self.assertEqual(self.client.post("/api/suivis/", data).status_code, 201)
        r = self.client.post("/api/suivis/", {**data, "oeufs_intacts": 82})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(SuiviQuotidien.objects.get().oeufs_intacts, 82)

    def test_resynchronisation_hors_ligne_idempotente(self):
        self.en_exploitant()
        cid = str(uuid.uuid4())
        vente = {"type_transaction": "RECETTE", "categorie": "VENTE_OEUFS", "quantite": 60,
                 "montant_total": "12", "client_uuid": cid}
        self.assertEqual(self.client.post("/api/transactions/", vente).status_code, 201)
        self.assertEqual(self.client.post("/api/transactions/", vente).status_code, 200)
        self.assertEqual(TransactionFinanciere.objects.filter(categorie="VENTE_OEUFS").count(), 1)


class PermissionsTests(BaseTest):
    def test_exploitant_ne_peut_pas_supprimer(self):
        s = SuiviQuotidien.objects.create(lot=self.lot, date=self.today, oeufs_intacts=10)
        self.en_exploitant()
        self.assertEqual(self.client.delete(f"/api/suivis/{s.id}/").status_code, 403)
        self.assertEqual(self.client.patch(f"/api/suivis/{s.id}/", {"oeufs_intacts": 12}).status_code, 200)

    def test_exploitant_lit_les_lots_sans_les_modifier_ni_voir_les_prix(self):
        self.en_exploitant()
        r = self.client.get("/api/lots/")
        self.assertEqual(r.status_code, 200)
        self.assertNotIn("prix_achat_total", r.data[0])
        self.assertEqual(self.client.patch(f"/api/lots/{self.lot.id}/", {"nom": "X"}).status_code, 403)
        self.assertEqual(self.client.post("/api/regles-rationnement/", {}).status_code, 403)

    def test_exploitant_ne_voit_ni_depenses_ni_pilotage(self):
        self.en_exploitant()
        r = self.client.get("/api/transactions/")
        self.assertTrue(all(t["type_transaction"] == "RECETTE" for t in r.data))
        r = self.client.post("/api/transactions/", {"type_transaction": "DEPENSE", "categorie": "ENERGIE",
                                                     "montant_total": 30})
        self.assertEqual(r.status_code, 400)
        self.assertEqual(self.client.get("/api/tableau-de-bord/pilotage/").status_code, 403)
        self.assertEqual(self.client.get("/api/utilisateurs/").status_code, 403)

    def test_ecriture_automatique_non_modifiable(self):
        self.en_admin()
        tr = TransactionFinanciere.objects.get(lot_achat=self.lot)
        self.assertEqual(self.client.delete(f"/api/transactions/{tr.id}/").status_code, 403)

    def test_categorie_coherente_avec_type(self):
        self.en_admin()
        r = self.client.post("/api/transactions/", {"type_transaction": "DEPENSE", "categorie": "VENTE_OEUFS",
                                                     "montant_total": 30})
        self.assertEqual(r.status_code, 400)


class AuthTests(BaseTest):
    def test_connexion_renvoie_token_et_role(self):
        r = self.client.post("/api/auth/connexion/", {"username": "papa", "password": "motdepasse-papa"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["utilisateur"]["role"], "exploitant")
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {r.data['token']}")
        self.assertEqual(self.client.get("/api/auth/moi/").data["username"], "papa")

    def test_connexion_par_email(self):
        self.pere.email = "papa@example.com"
        self.pere.save()
        r = self.client.post("/api/auth/connexion/", {"username": "Papa@Example.com", "password": "motdepasse-papa"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["utilisateur"]["username"], "papa")

    def test_mauvais_mot_de_passe(self):
        r = self.client.post("/api/auth/connexion/", {"username": "papa", "password": "faux"})
        self.assertEqual(r.status_code, 400)

    def test_admin_cree_un_exploitant(self):
        self.en_admin()
        r = self.client.post("/api/utilisateurs/", {"username": "paul", "password": "Poulailler-2026",
                                                     "role": "exploitant"})
        self.assertEqual(r.status_code, 201, r.data)
        self.assertFalse(User.objects.get(username="paul").is_superuser)


class TableauxDeBordTests(BaseTest):
    def setUp(self):
        super().setUp()
        for i in range(7):
            SuiviQuotidien.objects.create(lot=self.lot, date=self.today - timedelta(days=i),
                                          oeufs_intacts=88, oeufs_casses=2, aliment_distribue_kg=Decimal("12"))
        TransactionFinanciere.objects.create(type_transaction="RECETTE", categorie="VENTE_OEUFS",
                                             montant_total=Decimal("100"), quantite=500)

    def test_terrain(self):
        self.en_exploitant()
        d = self.client.get("/api/tableau-de-bord/terrain/").data
        self.assertEqual(d["effectif_total"], 100)
        self.assertEqual(d["oeufs_du_jour"], 90)
        self.assertEqual(d["saisies_a_faire"], [])

    def test_pilotage(self):
        self.en_admin()
        d = self.client.get("/api/tableau-de-bord/pilotage/").data
        ind = d["indicateurs"]
        self.assertEqual(ind["oeufs_pondus"], 630)
        self.assertEqual(ind["taux_ponte_moyen"], 90.0)
        # 84 kg d'aliment / 630 œufs = 133,3 g par œuf
        self.assertEqual(ind["indice_consommation_g_par_oeuf"], 133.3)
        # Dépenses : 800 € (achat lot) / 616 œufs commercialisables
        self.assertEqual(ind["cout_revient_oeuf"], round(800 / 616, 3))
        self.assertEqual(ind["marge_nette"], -700.0)
        courbe = d["courbes_ponte"][0]["points"]
        self.assertTrue(any(p["reel"] == 90.0 and p["theorique"] is not None for p in courbe))
