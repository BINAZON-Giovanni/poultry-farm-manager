from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers

from .models import (CourbeReference, Lot, MouvementStockAliment, Parametres, ReformePoule,
                     RegleRationnement, SuiviQuotidien, TransactionFinanciere)
from .permissions import ROLE_ADMIN, est_admin, role_de

User = get_user_model()


def nom_utilisateur(u):
    return (u.get_full_name() or u.username) if u else None


class ModelCleanMixin:
    """Applique Model.clean() (règles métier) lors de la validation DRF."""

    def validate(self, attrs):
        attrs = super().validate(attrs)
        instance = self.instance or self.Meta.model()
        for k, v in attrs.items():
            setattr(instance, k, v)
        try:
            instance.clean()
        except DjangoValidationError as e:
            raise serializers.ValidationError(e.message_dict if hasattr(e, "error_dict") else e.messages)
        return attrs


# ---------------------------------------------------------------- utilisateurs
class UtilisateurSerializer(serializers.ModelSerializer):
    role = serializers.ChoiceField(choices=["admin", "exploitant"], default="exploitant")
    password = serializers.CharField(write_only=True, required=False, style={"input_type": "password"})
    nom_affiche = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ["id", "username", "first_name", "last_name", "email", "is_active", "role", "password",
                  "nom_affiche", "last_login"]
        read_only_fields = ["last_login"]

    def get_nom_affiche(self, obj):
        return nom_utilisateur(obj)

    def to_representation(self, instance):
        data = super().to_representation(instance)
        data["role"] = role_de(instance)
        return data

    def validate_password(self, value):
        validate_password(value)
        return value

    def validate(self, attrs):
        if not self.instance and not attrs.get("password"):
            raise serializers.ValidationError({"password": "Mot de passe requis."})
        return attrs

    def _appliquer(self, user, validated):
        role = validated.pop("role", None)
        password = validated.pop("password", None)
        for k, v in validated.items():
            setattr(user, k, v)
        if role is not None:
            user.is_superuser = user.is_staff = role == ROLE_ADMIN
        if password:
            user.set_password(password)
        user.save()
        return user

    def create(self, validated):
        return self._appliquer(User(), validated)

    def update(self, instance, validated):
        request = self.context.get("request")
        if request and instance == request.user and validated.get("role") not in (None, ROLE_ADMIN):
            raise serializers.ValidationError({"role": "Vous ne pouvez pas retirer vos propres droits d'administrateur."})
        return self._appliquer(instance, validated)


# ---------------------------------------------------------------- lots & rations
class LotSerializer(serializers.ModelSerializer):
    age_jours = serializers.SerializerMethodField()
    age_semaines = serializers.SerializerMethodField()
    effectif_actuel = serializers.SerializerMethodField()
    total_deces = serializers.SerializerMethodField()
    total_reformes = serializers.SerializerMethodField()
    ration = serializers.SerializerMethodField()

    class Meta:
        model = Lot
        fields = ["id", "nom", "souche", "date_arrivee", "age_arrivee_semaines", "effectif_initial",
                  "prix_achat_total", "statut", "notes", "age_jours", "age_semaines", "effectif_actuel",
                  "total_deces", "total_reformes", "ration"]

    def get_age_jours(self, obj):
        return obj.age_jours()

    def get_age_semaines(self, obj):
        return obj.age_semaines()

    def get_effectif_actuel(self, obj):
        return obj.effectif_actuel()

    def get_total_deces(self, obj):
        return obj.total_deces()

    def get_total_reformes(self, obj):
        return obj.total_reformes()

    def get_ration(self, obj):
        regle = obj.regle_ration()
        return {
            "kg": obj.ration_du_jour_kg(),
            "type_aliment": regle.type_aliment if regle else None,
            "type_aliment_libelle": regle.get_type_aliment_display() if regle else None,
            "grammes_par_poule_jour": regle.grammes_par_poule_jour if regle else None,
        }

    def to_representation(self, instance):
        data = super().to_representation(instance)
        request = self.context.get("request")
        if request and not est_admin(request.user):
            data.pop("prix_achat_total", None)  # données financières réservées à l'admin
        return data


class RegleRationnementSerializer(ModelCleanMixin, serializers.ModelSerializer):
    type_aliment_libelle = serializers.CharField(source="get_type_aliment_display", read_only=True)

    class Meta:
        model = RegleRationnement
        fields = ["id", "semaine_debut", "semaine_fin", "type_aliment", "type_aliment_libelle", "grammes_par_poule_jour"]


# ---------------------------------------------------------------- saisies terrain
class SuiviQuotidienSerializer(serializers.ModelSerializer):
    client_uuid = serializers.UUIDField(required=False, allow_null=True, write_only=True)
    lot_nom = serializers.CharField(source="lot.nom", read_only=True)
    oeufs_pondus = serializers.IntegerField(read_only=True)
    effectif_du_jour = serializers.IntegerField(read_only=True)
    taux_ponte = serializers.FloatField(read_only=True)
    ration_theorique_kg = serializers.SerializerMethodField()
    saisi_par_nom = serializers.SerializerMethodField()

    class Meta:
        model = SuiviQuotidien
        fields = ["id", "lot", "lot_nom", "date", "oeufs_intacts", "oeufs_casses", "oeufs_pondus", "nb_deces",
                  "motif_deces", "aliment_distribue_kg", "commentaire", "effectif_du_jour", "taux_ponte",
                  "ration_theorique_kg", "saisi_par_nom", "modifie_le", "client_uuid"]
        read_only_fields = ["modifie_le"]
        validators = []  # l'unicité (lot, date) est gérée par une mise à jour automatique (upsert)

    def get_ration_theorique_kg(self, obj):
        return obj.lot.ration_du_jour_kg(obj.date)

    def get_saisi_par_nom(self, obj):
        return nom_utilisateur(obj.saisi_par)

    def validate(self, attrs):
        lot = attrs.get("lot") or self.instance.lot
        jour = attrs.get("date") or self.instance.date
        if lot.statut != Lot.Statut.ACTIF:
            raise serializers.ValidationError({"lot": "Ce lot est réformé : plus de saisie possible."})
        deces = attrs.get("nb_deces", self.instance.nb_deces if self.instance else 0)
        effectif = lot.effectif_debut_journee(jour)
        if deces > effectif:
            raise serializers.ValidationError({"nb_deces": f"Le lot ne compte que {effectif} poules ce jour-là."})
        if jour < lot.date_arrivee:
            raise serializers.ValidationError({"date": "Date antérieure à l'arrivée du lot."})
        return attrs


class ReformePouleSerializer(serializers.ModelSerializer):
    client_uuid = serializers.UUIDField(required=False, allow_null=True, write_only=True)
    lot_nom = serializers.CharField(source="lot.nom", read_only=True)
    saisi_par_nom = serializers.SerializerMethodField()

    class Meta:
        model = ReformePoule
        fields = ["id", "lot", "lot_nom", "date", "quantite_vendue", "prix_total", "client", "statut_paiement",
                  "saisi_par_nom", "client_uuid"]

    def get_saisi_par_nom(self, obj):
        return nom_utilisateur(obj.saisi_par)

    def validate(self, attrs):
        lot = attrs.get("lot") or self.instance.lot
        qte = attrs.get("quantite_vendue", self.instance.quantite_vendue if self.instance else 0)
        dispo = lot.effectif_actuel() + (self.instance.quantite_vendue if self.instance else 0)
        if qte > dispo:
            raise serializers.ValidationError({"quantite_vendue": f"Il ne reste que {dispo} poules dans ce lot."})
        return attrs


class MouvementStockSerializer(serializers.ModelSerializer):
    type_aliment_libelle = serializers.CharField(source="get_type_aliment_display", read_only=True)
    automatique = serializers.SerializerMethodField()
    saisi_par_nom = serializers.SerializerMethodField()

    class Meta:
        model = MouvementStockAliment
        fields = ["id", "date", "type_mouvement", "type_aliment", "type_aliment_libelle", "quantite_kg", "nb_sacs",
                  "cout_achat", "fournisseur", "commentaire", "suivi", "automatique", "saisi_par_nom"]
        read_only_fields = ["suivi"]

    def get_automatique(self, obj):
        return obj.suivi_id is not None

    def get_saisi_par_nom(self, obj):
        return nom_utilisateur(obj.saisi_par)


class TransactionSerializer(ModelCleanMixin, serializers.ModelSerializer):
    client_uuid = serializers.UUIDField(required=False, allow_null=True, write_only=True)
    categorie_libelle = serializers.CharField(source="get_categorie_display", read_only=True)
    lot_nom = serializers.CharField(source="lot.nom", read_only=True, default=None)
    automatique = serializers.BooleanField(read_only=True)
    saisi_par_nom = serializers.SerializerMethodField()

    class Meta:
        model = TransactionFinanciere
        fields = ["id", "date", "type_transaction", "categorie", "categorie_libelle", "quantite", "montant_total",
                  "lot", "lot_nom", "client", "statut_paiement", "description", "automatique", "saisi_par_nom",
                  "client_uuid"]

    def get_saisi_par_nom(self, obj):
        return nom_utilisateur(obj.saisi_par)

    def validate(self, attrs):
        request = self.context.get("request")
        type_tr = attrs.get("type_transaction") or getattr(self.instance, "type_transaction", None)
        if request and not est_admin(request.user) and type_tr != TransactionFinanciere.Type.RECETTE:
            raise serializers.ValidationError("L'exploitant ne peut saisir que des ventes.")
        return super().validate(attrs)


# ---------------------------------------------------------------- paramétrage
class ParametresSerializer(serializers.ModelSerializer):
    class Meta:
        model = Parametres
        fields = ["seuil_alerte_stock_kg", "oeufs_par_plateau", "prix_plateau_defaut"]


class CourbeReferenceSerializer(serializers.ModelSerializer):
    class Meta:
        model = CourbeReference
        fields = ["id", "semaine", "taux_ponte_theorique"]
