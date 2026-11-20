from django.contrib import admin
from django.urls import include, path, re_path

from elevage.views import application_angular

admin.site.site_header = "Administration du poulailler"

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/", include("elevage.urls")),
    # Toute autre URL est une route du frontend Angular (en production)
    re_path(r"^(?!api/|admin/|static/).*$", application_angular),
]
