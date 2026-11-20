"""Modèles métier du poulailler (poules pondeuses).

Tables principales du cahier des charges :
Lot, RegleRationnement, SuiviQuotidien, ReformePoule, MouvementStockAliment, TransactionFinanciere.
Tables de paramétrage : Parametres (singleton) et CourbeReference (courbe théorique de ponte de la souche).

Écritures automatiques (pour que la trésorerie et le stock restent cohérents) :
- un Lot avec un prix d'achat crée une dépense « Achat poulettes » ;
- une ReformePoule crée une recette « Vente poules de réforme » ;
- une entrée de stock avec un coût crée une dépense « Aliment » ;
- un SuiviQuotidien avec de l'aliment distribué crée une sortie de stock.
Ces écritures liées sont mises à jour ou supprimées avec leur source.
"""
from datetime import date as date_cls
from decimal import Decimal

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import MinValueValidator
from django.db import models, transaction
from django.db.models import Q, Sum
from django.utils import timezone


def aujourd_hui():
    return timezone.localdate()


class TypeAliment(models.TextChoices):
    DEMARRAGE = "DEMARRAGE", "Démarrage"
    CROISSANCE = "CROISSANCE", "Croissance"
    PRE_PONTE = "PRE_PONTE", "Pré-ponte"
    PONTE = "PONTE", "Ponte"


# ---------------------------------------------------------------- Module A : lots
class Lot(models.Model):
    class Statut(models.TextChoices):
        ACTIF = "ACTIF", "Actif"
        REFORME = "REFORME", "Réformé"

    nom = models.CharField(max_length=100)
    souche = models.CharField(max_length=100, blank=True, help_text="Ex. : ISA Brown, Lohmann…")
    date_arrivee = models.DateField()
    age_arrivee_semaines = models.PositiveIntegerField(default=0)
    effectif_initial = models.PositiveIntegerField(validators=[MinValueValidator(1)])
    prix_achat_total = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0"))
    statut = models.CharField(max_length=10, choices=Statut.choices, default=Statut.ACTIF)
    notes = models.TextField(blank=True)
    cree_le = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["statut", "date_arrivee"]  # actifs d'abord ("ACTIF" < "REFORME")

    def __str__(self):
        return self.nom

    # Âge
    def age_jours(self, a_la_date=None):
        a_la_date = a_la_date or aujourd_hui()
        return max(0, (a_la_date - self.date_arrivee).days + self.age_arrivee_semaines * 7)

    def age_semaines(self, a_la_date=None):
        return self.age_jours(a_la_date) // 7

    # Effectif : initial - Σ décès - Σ réformes
    def total_deces(self, avant=None):
        qs = self.suivis.all()
        if avant:
            qs = qs.filter(date__lt=avant)
        return qs.aggregate(n=Sum("nb_deces"))["n"] or 0

    def total_reformes(self, avant=None):
        qs = self.reformes.all()
        if avant:
            qs = qs.filter(date__lt=avant)
        return qs.aggregate(n=Sum("quantite_vendue"))["n"] or 0

    def effectif_actuel(self):
        return max(0, self.effectif_initial - self.total_deces() - self.total_reformes())

    def effectif_debut_journee(self, jour):
        """Effectif vivant au matin d'un jour (sorties des jours précédents déduites)."""
        return max(0, self.effectif_initial - self.total_deces(avant=jour) - self.total_reformes(avant=jour))

    # Ration
    def regle_ration(self, a_la_date=None):
        return RegleRationnement.pour_semaine(self.age_semaines(a_la_date))

    def ration_du_jour_kg(self, a_la_date=None):
        """Ration (kg) = effectif vivant × grammage prévu pour l'âge / 1000."""
        regle = self.regle_ration(a_la_date)
        if not regle or self.statut != self.Statut.ACTIF:
            return Decimal("0")
        effectif = self.effectif_debut_journee(a_la_date) if a_la_date else self.effectif_actuel()
        return (Decimal(effectif) * regle.grammes_par_poule_jour / 1000).quantize(Decimal("0.01"))

    def save(self, *args, **kwargs):
        with transaction.atomic():
            super().save(*args, **kwargs)
            TransactionFinanciere.synchroniser(
                source={"lot_achat": self},
                actif=self.prix_achat_total > 0,
                valeurs=dict(
                    date=self.date_arrivee,
                    type_transaction=TransactionFinanciere.Type.DEPENSE,
                    categorie=TransactionFinanciere.Categorie.ACHAT_POULETTES,
                    quantite=self.effectif_initial,
                    montant_total=self.prix_achat_total,
                    lot=self,
                    description=f"Achat du lot {self.nom}",
                    statut_paiement=TransactionFinanciere.StatutPaiement.PAYE,
                ),
            )


# ---------------------------------------------------------------- Module B : rations
class RegleRationnement(models.Model):
    semaine_debut = models.PositiveIntegerField()
    semaine_fin = models.PositiveIntegerField(help_text="Incluse")
    type_aliment = models.CharField(max_length=12, choices=TypeAliment.choices)
    grammes_par_poule_jour = models.DecimalField(max_digits=6, decimal_places=1,
                                                 validators=[MinValueValidator(Decimal("0"))])

    class Meta:
        ordering = ["semaine_debut"]
        verbose_name = "règle de rationnement"

    def __str__(self):
        return f"S{self.semaine_debut}-S{self.semaine_fin} : {self.get_type_aliment_display()} {self.grammes_par_poule_jour} g"

    def clean(self):
        if self.semaine_fin < self.semaine_debut:
            raise ValidationError("La semaine de fin doit être après la semaine de début.")
        chevauche = RegleRationnement.objects.exclude(pk=self.pk).filter(
            semaine_debut__lte=self.semaine_fin, semaine_fin__gte=self.semaine_debut)
        if chevauche.exists():
            raise ValidationError(f"Chevauchement avec la règle « {chevauche.first()} ».")

    @classmethod
    def pour_semaine(cls, semaine):
        return cls.objects.filter(semaine_debut__lte=semaine, semaine_fin__gte=semaine).first()


class MouvementStockAliment(models.Model):
    class Type(models.TextChoices):
        ENTREE = "ENTREE", "Entrée"
        SORTIE = "SORTIE", "Sortie"

    date = models.DateField(default=aujourd_hui)
    type_mouvement = models.CharField(max_length=6, choices=Type.choices)
    type_aliment = models.CharField(max_length=12, choices=TypeAliment.choices)
    quantite_kg = models.DecimalField(max_digits=10, decimal_places=2, validators=[MinValueValidator(Decimal("0.01"))])
    nb_sacs = models.PositiveIntegerField(null=True, blank=True)
    cout_achat = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    fournisseur = models.CharField(max_length=100, blank=True)
    commentaire = models.CharField(max_length=255, blank=True)
    # Sortie générée automatiquement par une saisie quotidienne
    suivi = models.OneToOneField("SuiviQuotidien", null=True, blank=True, on_delete=models.CASCADE,
                                 related_name="mouvement_stock")
    saisi_par = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
                                  related_name="+")
    cree_le = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-date", "-id"]
        verbose_name = "mouvement de stock d'aliment"

    def __str__(self):
        return f"{self.get_type_mouvement_display()} {self.quantite_kg} kg ({self.date})"

    @classmethod
    def etat_stock(cls):
        """Stock par type d'aliment et total, en kg."""
        par_type = {}
        for t in TypeAliment.values:
            agg = cls.objects.filter(type_aliment=t).aggregate(
                entrees=Sum("quantite_kg", filter=Q(type_mouvement=cls.Type.ENTREE)),
                sorties=Sum("quantite_kg", filter=Q(type_mouvement=cls.Type.SORTIE)),
            )
            par_type[t] = (agg["entrees"] or Decimal("0")) - (agg["sorties"] or Decimal("0"))
        return par_type

    def save(self, *args, **kwargs):
        with transaction.atomic():
            super().save(*args, **kwargs)
            TransactionFinanciere.synchroniser(
                source={"mouvement_stock": self},
                actif=self.type_mouvement == self.Type.ENTREE and bool(self.cout_achat),
                valeurs=dict(
                    date=self.date,
                    type_transaction=TransactionFinanciere.Type.DEPENSE,
                    categorie=TransactionFinanciere.Categorie.ALIMENT,
                    quantite=self.quantite_kg,
                    montant_total=self.cout_achat or 0,
                    description=f"Achat aliment {self.get_type_aliment_display().lower()}"
                                + (f" – {self.fournisseur}" if self.fournisseur else ""),
                    statut_paiement=TransactionFinanciere.StatutPaiement.PAYE,
                ),
            )


# ---------------------------------------------------------------- Module C : saisie quotidienne
class SuiviQuotidien(models.Model):
    lot = models.ForeignKey(Lot, on_delete=models.CASCADE, related_name="suivis")
    date = models.DateField(default=aujourd_hui)
    oeufs_intacts = models.PositiveIntegerField(default=0)
    oeufs_casses = models.PositiveIntegerField(default=0, help_text="Cassés ou impropres")
    nb_deces = models.PositiveIntegerField(default=0)
    motif_deces = models.CharField(max_length=255, blank=True)
    aliment_distribue_kg = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)
    commentaire = models.TextField(blank=True)
    client_uuid = models.UUIDField(null=True, blank=True, unique=True, editable=False)
    saisi_par = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
                                  related_name="+")
    cree_le = models.DateTimeField(auto_now_add=True)
    modifie_le = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-date", "lot"]
        constraints = [models.UniqueConstraint(fields=["lot", "date"], name="un_suivi_par_lot_et_par_jour")]
        verbose_name = "suivi quotidien"
        verbose_name_plural = "suivis quotidiens"

    def __str__(self):
        return f"{self.lot} – {self.date}"

    @property
    def oeufs_pondus(self):
        return self.oeufs_intacts + self.oeufs_casses

    @property
    def effectif_du_jour(self):
        return self.lot.effectif_debut_journee(self.date)

    @property
    def taux_ponte(self):
        """Taux de ponte journalier (%) = œufs pondus / effectif vivant du jour × 100."""
        eff = self.effectif_du_jour
        return round(self.oeufs_pondus / eff * 100, 1) if eff else None

    def save(self, *args, **kwargs):
        with transaction.atomic():
            super().save(*args, **kwargs)
            qte = self.aliment_distribue_kg or Decimal("0")
            regle = self.lot.regle_ration(self.date)
            existant = MouvementStockAliment.objects.filter(suivi=self).first()
            if qte > 0:
                mvt = existant or MouvementStockAliment(suivi=self)
                mvt.date = self.date
                mvt.type_mouvement = MouvementStockAliment.Type.SORTIE
                mvt.type_aliment = regle.type_aliment if regle else (existant.type_aliment if existant else TypeAliment.PONTE)
                mvt.quantite_kg = qte
                mvt.saisi_par = self.saisi_par
                mvt.commentaire = f"Distribution {self.lot.nom}"
                mvt.save()
            elif existant:
                existant.delete()


class ReformePoule(models.Model):
    lot = models.ForeignKey(Lot, on_delete=models.CASCADE, related_name="reformes")
    date = models.DateField(default=aujourd_hui)
    quantite_vendue = models.PositiveIntegerField(validators=[MinValueValidator(1)])
    prix_total = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0"))
    client = models.CharField(max_length=100, blank=True)
    statut_paiement = models.CharField(max_length=7, default="PAYE",
                                       choices=[("PAYE", "Payé"), ("IMPAYE", "Impayé")])
    client_uuid = models.UUIDField(null=True, blank=True, unique=True, editable=False)
    saisi_par = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
                                  related_name="+")
    cree_le = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-date", "-id"]
        verbose_name = "réforme de poules"
        verbose_name_plural = "réformes de poules"

    def __str__(self):
        return f"{self.quantite_vendue} poules – {self.lot} ({self.date})"

    def save(self, *args, **kwargs):
        with transaction.atomic():
            super().save(*args, **kwargs)
            TransactionFinanciere.synchroniser(
                source={"reforme": self},
                actif=True,
                valeurs=dict(
                    date=self.date,
                    type_transaction=TransactionFinanciere.Type.RECETTE,
                    categorie=TransactionFinanciere.Categorie.VENTE_REFORME,
                    quantite=self.quantite_vendue,
                    montant_total=self.prix_total,
                    lot=self.lot,
                    client=self.client,
                    statut_paiement=self.statut_paiement,
                    description=f"Réforme de {self.quantite_vendue} poules ({self.lot.nom})",
                ),
            )


# ---------------------------------------------------------------- Module D : finances
class TransactionFinanciere(models.Model):
    class Type(models.TextChoices):
        RECETTE = "RECETTE", "Recette"
        DEPENSE = "DEPENSE", "Dépense"

    class Categorie(models.TextChoices):
        VENTE_OEUFS = "VENTE_OEUFS", "Vente œufs"
        VENTE_REFORME = "VENTE_REFORME", "Vente poules de réforme"
        VENTE_FIENTE = "VENTE_FIENTE", "Vente fiente / engrais"
        AUTRE_RECETTE = "AUTRE_RECETTE", "Autre recette"
        ACHAT_POULETTES = "ACHAT_POULETTES", "Achat poulettes"
        ALIMENT = "ALIMENT", "Aliment"
        VETERINAIRE = "VETERINAIRE", "Vétérinaire / vaccins"
        ENERGIE = "ENERGIE", "Eau / électricité"
        MAIN_OEUVRE = "MAIN_OEUVRE", "Main-d'œuvre"
        AUTRE_DEPENSE = "AUTRE_DEPENSE", "Autre dépense"

    CATEGORIES_RECETTE = {"VENTE_OEUFS", "VENTE_REFORME", "VENTE_FIENTE", "AUTRE_RECETTE"}

    class StatutPaiement(models.TextChoices):
        PAYE = "PAYE", "Payé"
        IMPAYE = "IMPAYE", "Impayé"

    date = models.DateField(default=aujourd_hui)
    type_transaction = models.CharField(max_length=7, choices=Type.choices)
    categorie = models.CharField(max_length=20, choices=Categorie.choices)
    quantite = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True,
                                   help_text="Œufs à l'unité pour une vente d'œufs, kg pour l'aliment…")
    montant_total = models.DecimalField(max_digits=12, decimal_places=2, validators=[MinValueValidator(Decimal("0"))])
    lot = models.ForeignKey(Lot, null=True, blank=True, on_delete=models.SET_NULL, related_name="transactions")
    client = models.CharField(max_length=100, blank=True)
    statut_paiement = models.CharField(max_length=7, choices=StatutPaiement.choices, default=StatutPaiement.PAYE)
    description = models.CharField(max_length=255, blank=True)
    # Sources des écritures automatiques
    lot_achat = models.OneToOneField(Lot, null=True, blank=True, on_delete=models.CASCADE, related_name="transaction_achat")
    reforme = models.OneToOneField(ReformePoule, null=True, blank=True, on_delete=models.CASCADE, related_name="transaction")
    mouvement_stock = models.OneToOneField(MouvementStockAliment, null=True, blank=True, on_delete=models.CASCADE,
                                           related_name="transaction")
    client_uuid = models.UUIDField(null=True, blank=True, unique=True, editable=False)
    saisi_par = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
                                  related_name="+")
    cree_le = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-date", "-id"]
        verbose_name = "transaction financière"
        verbose_name_plural = "transactions financières"

    def __str__(self):
        return f"{self.get_categorie_display()} {self.montant_total} € ({self.date})"

    @property
    def automatique(self):
        return bool(self.lot_achat_id or self.reforme_id or self.mouvement_stock_id)

    def clean(self):
        attendu = self.Type.RECETTE if self.categorie in self.CATEGORIES_RECETTE else self.Type.DEPENSE
        if self.type_transaction != attendu:
            raise ValidationError({"categorie": "Cette catégorie ne correspond pas au type de transaction."})

    @classmethod
    def synchroniser(cls, source, actif, valeurs):
        """Crée, met à jour ou supprime l'écriture automatique liée à `source`."""
        existante = cls.objects.filter(**source).first()
        if not actif:
            if existante:
                existante.delete()
            return None
        tr = existante or cls(**source)
        for k, v in valeurs.items():
            setattr(tr, k, v)
        tr.save()
        return tr


# ---------------------------------------------------------------- Paramétrage
class Parametres(models.Model):
    """Paramètres globaux (une seule ligne)."""
    seuil_alerte_stock_kg = models.DecimalField(max_digits=8, decimal_places=2, default=Decimal("100"))
    oeufs_par_plateau = models.PositiveIntegerField(default=30)
    prix_plateau_defaut = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)

    class Meta:
        verbose_name = verbose_name_plural = "paramètres"

    def __str__(self):
        return "Paramètres"

    def save(self, *args, **kwargs):
        self.pk = 1
        super().save(*args, **kwargs)

    @classmethod
    def get(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj


class CourbeReference(models.Model):
    """Courbe théorique de ponte de la souche (taux de ponte attendu par semaine d'âge)."""
    semaine = models.PositiveIntegerField(unique=True)
    taux_ponte_theorique = models.DecimalField(max_digits=5, decimal_places=1)

    class Meta:
        ordering = ["semaine"]
        verbose_name = "point de la courbe de référence"

    def __str__(self):
        return f"S{self.semaine} : {self.taux_ponte_theorique} %"
