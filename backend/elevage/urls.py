from django.urls import path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register("utilisateurs", views.UtilisateurViewSet, basename="utilisateur")
router.register("lots", views.LotViewSet, basename="lot")
router.register("regles-rationnement", views.RegleRationnementViewSet, basename="regle")
router.register("suivis", views.SuiviQuotidienViewSet, basename="suivi")
router.register("reformes", views.ReformePouleViewSet, basename="reforme")
router.register("stock", views.MouvementStockViewSet, basename="stock")
router.register("transactions", views.TransactionViewSet, basename="transaction")
router.register("courbe-reference", views.CourbeReferenceViewSet, basename="courbe")

urlpatterns = [
    path("auth/connexion/", views.connexion),
    path("auth/deconnexion/", views.deconnexion),
    path("auth/moi/", views.moi),
    path("auth/mot-de-passe/", views.changer_mot_de_passe),
    path("parametres/", views.ParametresView.as_view()),
    path("choix/", views.choix),
    path("tableau-de-bord/terrain/", views.tableau_terrain),
    path("tableau-de-bord/pilotage/", views.tableau_pilotage),
] + router.urls
