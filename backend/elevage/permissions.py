"""Deux profils strictement cloisonnés :

- Administrateur (superuser) : tous les droits.
- Exploitant (terrain) : lecture + ajout/modification des saisies courantes, jamais de suppression.
"""
from rest_framework.permissions import SAFE_METHODS, BasePermission

ROLE_ADMIN = "admin"
ROLE_EXPLOITANT = "exploitant"


def est_admin(user):
    return bool(user and user.is_authenticated and user.is_superuser)


def role_de(user):
    return ROLE_ADMIN if est_admin(user) else ROLE_EXPLOITANT


class EstAdmin(BasePermission):
    """Réservé à l'administrateur (gestion des utilisateurs, pilotage financier)."""
    message = "Réservé à l'administrateur."

    def has_permission(self, request, view):
        return est_admin(request.user)


class AdminOuLecture(BasePermission):
    """Paramétrage (lots, rations, stock, paramètres) : l'exploitant ne fait que lire."""
    message = "Seul l'administrateur peut modifier ces données."

    def has_permission(self, request, view):
        if not (request.user and request.user.is_authenticated):
            return False
        return request.method in SAFE_METHODS or est_admin(request.user)


class SaisieTerrain(BasePermission):
    """Saisies courantes : l'exploitant peut ajouter et modifier, mais pas supprimer."""
    message = "La suppression est réservée à l'administrateur."

    def has_permission(self, request, view):
        if not (request.user and request.user.is_authenticated):
            return False
        if request.method == "DELETE":
            return est_admin(request.user)
        return True
