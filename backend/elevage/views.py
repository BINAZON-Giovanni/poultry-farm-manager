from datetime import date, timedelta

from django.contrib.auth import authenticate, get_user_model
from django.db import transaction
from django.http import FileResponse, Http404
from django.conf import settings
from rest_framework import status, viewsets
from rest_framework.authtoken.models import Token
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle
from rest_framework.views import APIView

from . import services
from .models import (CourbeReference, Lot, MouvementStockAliment, Parametres, ReformePoule,
                     RegleRationnement, SuiviQuotidien, TransactionFinanciere, TypeAliment)
from .permissions import AdminOuLecture, EstAdmin, SaisieTerrain, est_admin, role_de
from .serializers import (CourbeReferenceSerializer, LotSerializer, MouvementStockSerializer,
                          ParametresSerializer, ReformePouleSerializer, RegleRationnementSerializer,
                          SuiviQuotidienSerializer, TransactionSerializer, UtilisateurSerializer,
                          nom_utilisateur)

User = get_user_model()


def _date_param(request, nom, defaut=None):
    v = request.query_params.get(nom)
    if not v:
        return defaut
    try:
        return date.fromisoformat(v)
    except ValueError:
        raise ValidationError({nom: "Date invalide (format AAAA-MM-JJ)."})


def _infos_utilisateur(user):
    return {"id": user.id, "username": user.username, "nom": nom_utilisateur(user), "role": role_de(user)}


# ---------------------------------------------------------------- authentification
class ConnexionThrottle(AnonRateThrottle):
    rate = "10/min"


@api_view(["POST"])
@permission_classes([AllowAny])
def connexion(request):
    # Limitation des tentatives (anti force brute) sauf en test
    if not getattr(settings, "TESTING", False):
        throttle = ConnexionThrottle()
        if not throttle.allow_request(request, None):
            return Response({"detail": "Trop de tentatives, réessayez dans une minute."}, status=429)
    identifiant = str(request.data.get("username", "")).strip()
    password = request.data.get("password", "")
    user = authenticate(request, username=identifiant, password=password)
    if user is None and "@" in identifiant:
        # Connexion possible aussi avec l'adresse email du compte
        for candidat in User.objects.filter(email__iexact=identifiant, is_active=True):
            user = authenticate(request, username=candidat.username, password=password)
            if user:
                break
    if not user or not user.is_active:
        return Response({"detail": "Identifiant ou mot de passe incorrect."}, status=status.HTTP_400_BAD_REQUEST)
    token, _ = Token.objects.get_or_create(user=user)
    return Response({"token": token.key, "utilisateur": _infos_utilisateur(user)})


@api_view(["POST"])
def deconnexion(request):
    Token.objects.filter(user=request.user).delete()
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(["GET"])
def moi(request):
    return Response(_infos_utilisateur(request.user))


@api_view(["POST"])
def changer_mot_de_passe(request):
    from django.contrib.auth.password_validation import validate_password
    user = request.user
    if not user.check_password(request.data.get("ancien", "")):
        raise ValidationError({"ancien": "Mot de passe actuel incorrect."})
    nouveau = request.data.get("nouveau", "")
    try:
        validate_password(nouveau, user)
    except Exception as e:  # noqa: BLE001
        raise ValidationError({"nouveau": list(getattr(e, "messages", [str(e)]))})
    user.set_password(nouveau)
    user.save()
    return Response(status=status.HTTP_204_NO_CONTENT)


class UtilisateurViewSet(viewsets.ModelViewSet):
    queryset = User.objects.order_by("username")
    serializer_class = UtilisateurSerializer
    permission_classes = [EstAdmin]

    def perform_destroy(self, instance):
        if instance == self.request.user:
            raise ValidationError("Vous ne pouvez pas supprimer votre propre compte.")
        instance.delete()


# ---------------------------------------------------------------- mixins
class IdempotentCreateMixin:
    """Une saisie hors-ligne rejouée deux fois (même client_uuid) n'est créée qu'une fois."""

    def create(self, request, *args, **kwargs):
        cid = request.data.get("client_uuid")
        if cid:
            existant = self.get_queryset().model.objects.filter(client_uuid=cid).first()
            if existant:
                return Response(self.get_serializer(existant).data, status=status.HTTP_200_OK)
        return super().create(request, *args, **kwargs)

    def perform_create(self, serializer):
        serializer.save(saisi_par=self.request.user)


class PeriodeMixin:
    def filtrer_periode(self, qs):
        debut = _date_param(self.request, "debut")
        fin = _date_param(self.request, "fin")
        if debut:
            qs = qs.filter(date__gte=debut)
        if fin:
            qs = qs.filter(date__lte=fin)
        lot = self.request.query_params.get("lot")
        if lot and hasattr(qs.model, "lot"):
            qs = qs.filter(lot_id=lot)
        return qs


# ---------------------------------------------------------------- lots & rations
class LotViewSet(viewsets.ModelViewSet):
    serializer_class = LotSerializer
    permission_classes = [AdminOuLecture]

    def get_queryset(self):
        qs = Lot.objects.all()
        statut = self.request.query_params.get("statut")
        return qs.filter(statut=statut) if statut else qs


class RegleRationnementViewSet(viewsets.ModelViewSet):
    queryset = RegleRationnement.objects.all()
    serializer_class = RegleRationnementSerializer
    permission_classes = [AdminOuLecture]


# ---------------------------------------------------------------- saisies terrain
class SuiviQuotidienViewSet(IdempotentCreateMixin, PeriodeMixin, viewsets.ModelViewSet):
    serializer_class = SuiviQuotidienSerializer
    permission_classes = [SaisieTerrain]

    def get_queryset(self):
        qs = SuiviQuotidien.objects.select_related("lot", "saisi_par")
        if self.action == "list" and not any(k in self.request.query_params for k in ("debut", "fin")):
            qs = qs.filter(date__gte=services.aujourd_hui() - timedelta(days=30))
        return self.filtrer_periode(qs)

    def create(self, request, *args, **kwargs):
        # Une seule saisie par lot et par jour : si elle existe déjà, on la met à jour.
        lot, jour = request.data.get("lot"), request.data.get("date") or services.aujourd_hui().isoformat()
        existant = SuiviQuotidien.objects.filter(lot_id=lot, date=jour).first() if lot else None
        if existant and not (request.data.get("client_uuid") and str(existant.client_uuid) == str(request.data["client_uuid"])):
            serializer = self.get_serializer(existant, data=request.data, partial=True)
            serializer.is_valid(raise_exception=True)
            serializer.save(saisi_par=request.user)
            return Response(serializer.data, status=status.HTTP_200_OK)
        return super().create(request, *args, **kwargs)

    def perform_update(self, serializer):
        serializer.save(saisi_par=self.request.user)


class ReformePouleViewSet(IdempotentCreateMixin, PeriodeMixin, viewsets.ModelViewSet):
    serializer_class = ReformePouleSerializer
    permission_classes = [SaisieTerrain]

    def get_queryset(self):
        return self.filtrer_periode(ReformePoule.objects.select_related("lot", "saisi_par"))


class TransactionViewSet(IdempotentCreateMixin, PeriodeMixin, viewsets.ModelViewSet):
    serializer_class = TransactionSerializer
    permission_classes = [SaisieTerrain]

    def get_queryset(self):
        qs = TransactionFinanciere.objects.select_related("lot", "saisi_par")
        if not est_admin(self.request.user):
            qs = qs.filter(type_transaction=TransactionFinanciere.Type.RECETTE)
        for champ in ("type_transaction", "categorie", "statut_paiement"):
            v = self.request.query_params.get(champ)
            if v:
                qs = qs.filter(**{champ: v})
        return self.filtrer_periode(qs)

    def _verifier_manuelle(self, instance):
        if instance.automatique:
            raise PermissionDenied("Écriture automatique : modifiez la source (lot, réforme ou achat d'aliment).")

    def perform_update(self, serializer):
        self._verifier_manuelle(serializer.instance)
        serializer.save()

    def perform_destroy(self, instance):
        self._verifier_manuelle(instance)
        instance.delete()


class MouvementStockViewSet(PeriodeMixin, viewsets.ModelViewSet):
    serializer_class = MouvementStockSerializer
    permission_classes = [AdminOuLecture]

    def get_queryset(self):
        qs = MouvementStockAliment.objects.select_related("saisi_par")
        for champ in ("type_mouvement", "type_aliment"):
            v = self.request.query_params.get(champ)
            if v:
                qs = qs.filter(**{champ: v})
        return self.filtrer_periode(qs)

    def perform_create(self, serializer):
        serializer.save(saisi_par=self.request.user)

    def _verifier_manuel(self, instance):
        if instance.suivi_id:
            raise PermissionDenied("Sortie liée à une saisie quotidienne : modifiez la saisie du jour.")

    def perform_update(self, serializer):
        self._verifier_manuel(serializer.instance)
        serializer.save()

    def perform_destroy(self, instance):
        self._verifier_manuel(instance)
        instance.delete()

    @action(detail=False, methods=["get"], permission_classes=[IsAuthenticated])
    def etat(self, request):
        return Response(services.etat_stock())


# ---------------------------------------------------------------- paramétrage
class ParametresView(APIView):
    permission_classes = [AdminOuLecture]

    def get(self, request):
        return Response(ParametresSerializer(Parametres.get()).data)

    def put(self, request):
        s = ParametresSerializer(Parametres.get(), data=request.data, partial=True)
        s.is_valid(raise_exception=True)
        s.save()
        return Response(s.data)

    patch = put


class CourbeReferenceViewSet(viewsets.ModelViewSet):
    queryset = CourbeReference.objects.all()
    serializer_class = CourbeReferenceSerializer
    permission_classes = [AdminOuLecture]
    pagination_class = None

    @action(detail=False, methods=["put"], permission_classes=[EstAdmin])
    def remplacer(self, request):
        """Remplace toute la courbe : [{semaine, taux_ponte_theorique}, …]."""
        s = CourbeReferenceSerializer(data=request.data, many=True)
        s.is_valid(raise_exception=True)
        with transaction.atomic():
            CourbeReference.objects.all().delete()
            s.save()
        return Response(s.data)


@api_view(["GET"])
def choix(request):
    """Listes de valeurs pour les formulaires."""
    cats = TransactionFinanciere.Categorie
    return Response({
        "types_aliment": [{"value": v, "label": l} for v, l in TypeAliment.choices],
        "categories_recette": [{"value": v, "label": l} for v, l in cats.choices if v in TransactionFinanciere.CATEGORIES_RECETTE],
        "categories_depense": [{"value": v, "label": l} for v, l in cats.choices if v not in TransactionFinanciere.CATEGORIES_RECETTE],
    })


# ---------------------------------------------------------------- tableaux de bord
@api_view(["GET"])
def tableau_terrain(request):
    return Response(services.tableau_de_bord_terrain())


@api_view(["GET"])
@permission_classes([EstAdmin])
def tableau_pilotage(request):
    fin = _date_param(request, "fin", services.aujourd_hui())
    debut = _date_param(request, "debut", fin - timedelta(days=29))
    if debut > fin:
        raise ValidationError("La date de début doit précéder la date de fin.")
    if (fin - debut).days > 731:
        raise ValidationError("Période limitée à 2 ans.")
    lot = request.query_params.get("lot")
    return Response(services.tableau_de_bord_pilotage(debut, fin, int(lot) if lot and lot.isdigit() else None))


# ---------------------------------------------------------------- application Angular (production)
def application_angular(request, chemin=""):
    """Renvoie index.html du build Angular pour toutes les routes du frontend."""
    index = settings.FRONTEND_DIST / "index.html"
    if not index.exists():
        raise Http404("Frontend non compilé : lancez `npm run build` dans frontend/.")
    return FileResponse(open(index, "rb"), content_type="text/html")
