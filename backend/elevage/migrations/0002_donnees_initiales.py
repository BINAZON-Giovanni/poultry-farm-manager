"""Données initiales : grille de rationnement, courbe de ponte de référence et paramètres.

Valeurs indicatives pour une souche pondeuse brune (type ISA Brown / Lohmann Brown),
à ajuster depuis l'application (écran Rations / Paramètres) selon le guide de la souche.
"""
from decimal import Decimal

from django.db import migrations

RATIONS = [  # (semaine_debut, semaine_fin, type, g/poule/jour)
    (0, 5, "DEMARRAGE", "30"),
    (6, 10, "CROISSANCE", "55"),
    (11, 16, "CROISSANCE", "75"),
    (17, 18, "PRE_PONTE", "95"),
    (19, 120, "PONTE", "120"),
]


def courbe_theorique():
    montee = {18: 5, 19: 20, 20: 45, 21: 70, 22: 85, 23: 90, 24: 93, 25: 94}
    points = dict(montee)
    for s in range(26, 31):  # plateau
        points[s] = 94.5
    taux = 94.5
    for s in range(31, 91):  # décroissance lente après le pic
        taux -= 0.35
        points[s] = round(taux, 1)
    return points


def charger(apps, schema_editor):
    Regle = apps.get_model("elevage", "RegleRationnement")
    Courbe = apps.get_model("elevage", "CourbeReference")
    Parametres = apps.get_model("elevage", "Parametres")
    for debut, fin, type_aliment, g in RATIONS:
        Regle.objects.create(semaine_debut=debut, semaine_fin=fin, type_aliment=type_aliment,
                             grammes_par_poule_jour=Decimal(g))
    for semaine, taux in courbe_theorique().items():
        Courbe.objects.create(semaine=semaine, taux_ponte_theorique=Decimal(str(taux)))
    Parametres.objects.get_or_create(pk=1)


def vider(apps, schema_editor):
    apps.get_model("elevage", "RegleRationnement").objects.all().delete()
    apps.get_model("elevage", "CourbeReference").objects.all().delete()


class Migration(migrations.Migration):
    dependencies = [("elevage", "0001_initial")]
    operations = [migrations.RunPython(charger, vider)]
