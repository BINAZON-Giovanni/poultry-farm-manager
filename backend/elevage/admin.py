from django.contrib import admin

from .models import (CourbeReference, Lot, MouvementStockAliment, Parametres, ReformePoule,
                     RegleRationnement, SuiviQuotidien, TransactionFinanciere)


@admin.register(Lot)
class LotAdmin(admin.ModelAdmin):
    list_display = ("nom", "souche", "date_arrivee", "age_arrivee_semaines", "effectif_initial", "statut")
    list_filter = ("statut",)


@admin.register(RegleRationnement)
class RegleAdmin(admin.ModelAdmin):
    list_display = ("semaine_debut", "semaine_fin", "type_aliment", "grammes_par_poule_jour")


@admin.register(SuiviQuotidien)
class SuiviAdmin(admin.ModelAdmin):
    list_display = ("date", "lot", "oeufs_intacts", "oeufs_casses", "nb_deces", "aliment_distribue_kg", "saisi_par")
    list_filter = ("lot",)
    date_hierarchy = "date"


@admin.register(ReformePoule)
class ReformeAdmin(admin.ModelAdmin):
    list_display = ("date", "lot", "quantite_vendue", "prix_total", "client")


@admin.register(MouvementStockAliment)
class StockAdmin(admin.ModelAdmin):
    list_display = ("date", "type_mouvement", "type_aliment", "quantite_kg", "cout_achat")
    list_filter = ("type_mouvement", "type_aliment")


@admin.register(TransactionFinanciere)
class TransactionAdmin(admin.ModelAdmin):
    list_display = ("date", "type_transaction", "categorie", "montant_total", "lot", "statut_paiement")
    list_filter = ("type_transaction", "categorie", "statut_paiement")
    date_hierarchy = "date"


admin.site.register(Parametres)
admin.site.register(CourbeReference)
