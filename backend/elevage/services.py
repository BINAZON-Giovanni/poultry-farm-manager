"""Calculs des indicateurs et des tableaux de bord (Module E)."""
from collections import defaultdict
from datetime import timedelta
from decimal import Decimal

from django.db.models import Q, Sum
from django.db.models.functions import TruncMonth

from .models import (CourbeReference, Lot, MouvementStockAliment, Parametres, SuiviQuotidien,
                     TransactionFinanciere, TypeAliment, aujourd_hui)

D0 = Decimal("0")


def _r(x, n=2):
    return None if x is None else round(float(x), n)


def serie_lot(lot, debut=None, fin=None):
    """Suivis d'un lot avec l'effectif vivant au matin de chaque jour (calcul en mémoire, sans N requêtes)."""
    suivis = list(lot.suivis.order_by("date"))
    reformes = list(lot.reformes.order_by("date").values("date", "quantite_vendue"))
    sorties = defaultdict(int)  # sorties par date
    for s in suivis:
        sorties[s.date] += s.nb_deces
    for r in reformes:
        sorties[r["date"]] += r["quantite_vendue"]
    dates_sorties = sorted(sorties)
    resultat, cumul, i = [], 0, 0
    for s in suivis:
        while i < len(dates_sorties) and dates_sorties[i] < s.date:
            cumul += sorties[dates_sorties[i]]
            i += 1
        if (debut and s.date < debut) or (fin and s.date > fin):
            continue
        effectif = max(0, lot.effectif_initial - cumul)
        resultat.append({
            "date": s.date, "effectif": effectif, "pondus": s.oeufs_pondus, "intacts": s.oeufs_intacts,
            "casses": s.oeufs_casses, "deces": s.nb_deces, "motif": s.motif_deces,
            "aliment_kg": s.aliment_distribue_kg or D0, "age_semaines": lot.age_semaines(s.date),
        })
    return resultat


def etat_stock():
    par_type = MouvementStockAliment.etat_stock()
    seuil = Parametres.get().seuil_alerte_stock_kg
    total = sum(par_type.values(), D0)
    ration_par_type = defaultdict(lambda: D0)
    for lot in Lot.objects.filter(statut=Lot.Statut.ACTIF):
        regle = lot.regle_ration()
        if regle:
            ration_par_type[regle.type_aliment] += lot.ration_du_jour_kg()
    ration_totale = sum(ration_par_type.values(), D0)
    types = []
    for t, label in TypeAliment.choices:
        stock, ration = par_type[t], ration_par_type[t]
        if stock == 0 and ration == 0:
            continue
        jours = _r(stock / ration, 1) if ration > 0 else None
        types.append({
            "type_aliment": t, "libelle": label, "stock_kg": _r(stock), "ration_jour_kg": _r(ration),
            "jours_restants": jours,
            # Alerte si l'aliment utilisé en ce moment couvre moins d'une semaine
            "alerte": ration > 0 and stock < ration * 7,
        })
    return {
        "total_kg": _r(total), "seuil_alerte_kg": _r(seuil), "ration_totale_jour_kg": _r(ration_totale),
        "jours_restants": _r(total / ration_totale, 1) if ration_totale > 0 else None,
        "alerte": total <= seuil or any(t["alerte"] for t in types),
        "par_type": types,
    }


def tableau_de_bord_terrain():
    """Vue « Terrain » (tablette) : état immédiat du poulailler et saisies du jour."""
    jour = aujourd_hui()
    lots = []
    for lot in Lot.objects.filter(statut=Lot.Statut.ACTIF):
        regle = lot.regle_ration()
        suivi = lot.suivis.filter(date=jour).first()
        lots.append({
            "id": lot.id, "nom": lot.nom, "souche": lot.souche,
            "age_semaines": lot.age_semaines(), "age_jours": lot.age_jours(),
            "effectif": lot.effectif_actuel(), "effectif_matin": lot.effectif_debut_journee(jour),
            "ration_kg": _r(lot.ration_du_jour_kg(jour)),
            "type_aliment": regle.type_aliment if regle else None,
            "type_aliment_libelle": regle.get_type_aliment_display() if regle else None,
            "grammes_par_poule_jour": _r(regle.grammes_par_poule_jour, 1) if regle else None,
            "suivi_du_jour": {
                "id": suivi.id, "oeufs_intacts": suivi.oeufs_intacts, "oeufs_casses": suivi.oeufs_casses,
                "nb_deces": suivi.nb_deces, "aliment_distribue_kg": _r(suivi.aliment_distribue_kg),
                "taux_ponte": suivi.taux_ponte,
            } if suivi else None,
        })
    oeufs = sum(l["suivi_du_jour"]["oeufs_intacts"] + l["suivi_du_jour"]["oeufs_casses"]
                for l in lots if l["suivi_du_jour"])
    effectif_saisi = sum(l["effectif_matin"] for l in lots if l["suivi_du_jour"])
    return {
        "date": jour,
        "effectif_total": sum(l["effectif"] for l in lots),
        "ration_totale_kg": _r(sum((Decimal(str(l["ration_kg"] or 0)) for l in lots), D0)),
        "oeufs_du_jour": oeufs,
        "taux_ponte_du_jour": round(oeufs / effectif_saisi * 100, 1) if effectif_saisi else None,
        "saisies_a_faire": [l["nom"] for l in lots if not l["suivi_du_jour"]],
        "lots": lots,
        "stock": etat_stock(),
        "parametres": {"oeufs_par_plateau": Parametres.get().oeufs_par_plateau,
                       "prix_plateau_defaut": _r(Parametres.get().prix_plateau_defaut)},
    }


def _repartition(montant, poids, total_poids):
    return montant * Decimal(poids) / Decimal(total_poids) if total_poids else D0


def tableau_de_bord_pilotage(debut, fin, lot_id=None):
    """Vue « Pilotage » (admin) : production, mortalité, finances et rentabilité par lot."""
    lots_qs = Lot.objects.all()
    lots_periode = [l for l in lots_qs if l.date_arrivee <= fin]
    courbe_ref = {c.semaine: float(c.taux_ponte_theorique) for c in CourbeReference.objects.all()}

    # --- Production & mortalité sur la période
    stats_lot = {}
    jours = defaultdict(lambda: {"pondus": 0, "intacts": 0, "effectif": 0, "deces": 0, "aliment_kg": D0})
    motifs = defaultdict(int)
    for lot in lots_periode:
        serie = serie_lot(lot, debut, fin)
        st = {"pondus": 0, "intacts": 0, "effectif_jours": 0, "deces": 0, "aliment_kg": D0}
        for p in serie:
            j = jours[p["date"]]
            for k in ("pondus", "intacts", "deces"):
                j[k] += p[k]
                st[k] += p[k]
            j["effectif"] += p["effectif"]
            j["aliment_kg"] += p["aliment_kg"]
            st["effectif_jours"] += p["effectif"]
            st["aliment_kg"] += p["aliment_kg"]
            if p["deces"]:
                motifs[p["motif"].strip() or "Non précisé"] += p["deces"]
        stats_lot[lot.id] = st

    pondus = sum(s["pondus"] for s in stats_lot.values())
    intacts = sum(s["intacts"] for s in stats_lot.values())
    effectif_jours = sum(s["effectif_jours"] for s in stats_lot.values())
    aliment = sum((s["aliment_kg"] for s in stats_lot.values()), D0)
    deces = sum(s["deces"] for s in stats_lot.values())

    serie_jours = []
    d = debut
    while d <= fin:
        j = jours.get(d)
        serie_jours.append({
            "date": d, "oeufs": j["pondus"] if j else 0, "deces": j["deces"] if j else 0,
            "taux_ponte": round(j["pondus"] / j["effectif"] * 100, 1) if j and j["effectif"] else None,
        })
        d += timedelta(days=1)

    # --- Courbe de ponte réelle vs théorique, par semaine d'âge, sur toute la vie du lot
    courbes = []
    lots_courbe = [l for l in lots_qs if (l.id == lot_id if lot_id else l.statut == Lot.Statut.ACTIF)]
    for lot in lots_courbe:
        semaines = defaultdict(lambda: [0, 0])
        for p in serie_lot(lot):
            semaines[p["age_semaines"]][0] += p["pondus"]
            semaines[p["age_semaines"]][1] += p["effectif"]
        pts = sorted(semaines.items())
        sem_min = min([s for s, _ in pts] + [lot.age_semaines()]) if pts else lot.age_arrivee_semaines
        sem_max = max([s for s, _ in pts] + [lot.age_semaines()])
        courbes.append({
            "lot_id": lot.id, "lot": lot.nom, "age_actuel_semaines": lot.age_semaines(),
            "points": [{
                "semaine": s,
                "reel": round(semaines[s][0] / semaines[s][1] * 100, 1) if s in semaines and semaines[s][1] else None,
                "theorique": courbe_ref.get(s),
            } for s in range(sem_min, sem_max + 1)],
        })

    # --- Finances
    tr = TransactionFinanciere.objects.filter(date__gte=debut, date__lte=fin)
    agg = tr.aggregate(
        recettes=Sum("montant_total", filter=Q(type_transaction="RECETTE")),
        depenses=Sum("montant_total", filter=Q(type_transaction="DEPENSE")),
        impayes=Sum("montant_total", filter=Q(type_transaction="RECETTE", statut_paiement="IMPAYE")),
    )
    recettes, depenses = agg["recettes"] or D0, agg["depenses"] or D0

    par_categorie = [
        {"categorie": r["categorie"], "libelle": TransactionFinanciere.Categorie(r["categorie"]).label,
         "type": r["type_transaction"], "total": _r(r["total"])}
        for r in tr.values("categorie", "type_transaction").annotate(total=Sum("montant_total")).order_by("-total")
    ]

    debut_12m = (fin.replace(day=1) - timedelta(days=335)).replace(day=1)
    mois = defaultdict(lambda: {"recettes": D0, "depenses": D0})
    for r in (TransactionFinanciere.objects.filter(date__gte=debut_12m, date__lte=fin)
              .annotate(mois=TruncMonth("date")).values("mois", "type_transaction")
              .annotate(total=Sum("montant_total"))):
        cle = "recettes" if r["type_transaction"] == "RECETTE" else "depenses"
        mois[r["mois"].strftime("%Y-%m")][cle] += r["total"]
    bilan_mensuel = []
    m = debut_12m
    while m <= fin:
        k = m.strftime("%Y-%m")
        bilan_mensuel.append({"mois": k, "chiffre_affaires": _r(mois[k]["recettes"]), "charges": _r(mois[k]["depenses"]),
                              "benefice": _r(mois[k]["recettes"] - mois[k]["depenses"])})
        m = (m + timedelta(days=32)).replace(day=1)

    # --- Marge par lot (directe + répartition des montants non affectés)
    non_aff = tr.filter(lot__isnull=True).aggregate(
        r=Sum("montant_total", filter=Q(type_transaction="RECETTE")),
        d=Sum("montant_total", filter=Q(type_transaction="DEPENSE")))
    rec_na, dep_na = non_aff["r"] or D0, non_aff["d"] or D0
    marges = []
    for lot in lots_periode:
        direct = tr.filter(lot=lot).aggregate(
            r=Sum("montant_total", filter=Q(type_transaction="RECETTE")),
            d=Sum("montant_total", filter=Q(type_transaction="DEPENSE")))
        st = stats_lot.get(lot.id, {})
        if not st.get("effectif_jours") and not direct["r"] and not direct["d"]:
            continue
        r_lot = (direct["r"] or D0) + _repartition(rec_na, st.get("intacts", 0), intacts)
        d_lot = (direct["d"] or D0) + _repartition(dep_na, st.get("aliment_kg", D0), aliment)
        marges.append({
            "lot_id": lot.id, "lot": lot.nom, "statut": lot.statut,
            "oeufs_pondus": st.get("pondus", 0),
            "taux_ponte_moyen": round(st["pondus"] / st["effectif_jours"] * 100, 1) if st.get("effectif_jours") else None,
            "recettes": _r(r_lot), "depenses": _r(d_lot), "marge": _r(r_lot - d_lot),
            "cout_revient_oeuf": _r(d_lot / st["intacts"], 3) if st.get("intacts") else None,
        })

    effectif_actuel = sum(l.effectif_actuel() for l in lots_qs if l.statut == Lot.Statut.ACTIF)
    return {
        "periode": {"debut": debut, "fin": fin},
        "indicateurs": {
            "effectif_actuel": effectif_actuel,
            "oeufs_pondus": pondus, "oeufs_commercialisables": intacts, "oeufs_casses": pondus - intacts,
            "taux_ponte_moyen": round(pondus / effectif_jours * 100, 1) if effectif_jours else None,
            "aliment_consomme_kg": _r(aliment),
            # Indice de consommation : aliment consommé par œuf produit
            "indice_consommation_g_par_oeuf": _r(aliment * 1000 / pondus, 1) if pondus else None,
            "deces": deces,
            "taux_mortalite": round(deces / (effectif_actuel + deces) * 100, 2) if (effectif_actuel + deces) else None,
            "recettes": _r(recettes), "depenses": _r(depenses), "marge_nette": _r(recettes - depenses),
            "impayes": _r(agg["impayes"] or D0),
            # Coût de revient d'un œuf = dépenses de la période / œufs commercialisables
            "cout_revient_oeuf": _r(depenses / intacts, 3) if intacts else None,
        },
        "serie_jours": serie_jours,
        "mortalite_par_motif": sorted(({"motif": k, "deces": v} for k, v in motifs.items()), key=lambda x: -x["deces"]),
        "courbes_ponte": courbes,
        "finances_par_categorie": par_categorie,
        "bilan_mensuel": bilan_mensuel,
        "marges_par_lot": marges,
        "methode_repartition": "Recettes non affectées à un lot réparties au prorata des œufs commercialisables ; "
                               "dépenses non affectées au prorata de l'aliment distribué.",
        "stock": etat_stock(),
    }
