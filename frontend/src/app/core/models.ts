export type Role = 'admin' | 'exploitant';

export interface Utilisateur {
  id: number;
  username: string;
  nom: string;
  role: Role;
}

export interface UtilisateurAdmin {
  id?: number;
  username: string;
  first_name: string;
  last_name: string;
  email: string;
  is_active: boolean;
  role: Role;
  password?: string;
  nom_affiche?: string;
  last_login?: string | null;
}

export interface Choix {
  value: string;
  label: string;
}
export interface ListesChoix {
  types_aliment: Choix[];
  categories_recette: Choix[];
  categories_depense: Choix[];
}

export interface Lot {
  id?: number;
  nom: string;
  souche: string;
  date_arrivee: string;
  age_arrivee_semaines: number;
  effectif_initial: number;
  prix_achat_total?: number;
  statut: 'ACTIF' | 'REFORME';
  notes: string;
  age_jours?: number;
  age_semaines?: number;
  effectif_actuel?: number;
  total_deces?: number;
  total_reformes?: number;
  ration?: { kg: number; type_aliment: string | null; type_aliment_libelle: string | null; grammes_par_poule_jour: number | null };
}

export interface RegleRationnement {
  id?: number;
  semaine_debut: number;
  semaine_fin: number;
  type_aliment: string;
  type_aliment_libelle?: string;
  grammes_par_poule_jour: number;
}

export interface SuiviQuotidien {
  id?: number;
  lot: number;
  lot_nom?: string;
  date: string;
  oeufs_intacts: number;
  oeufs_casses: number;
  oeufs_pondus?: number;
  nb_deces: number;
  motif_deces: string;
  aliment_distribue_kg: number | null;
  commentaire: string;
  effectif_du_jour?: number;
  taux_ponte?: number | null;
  ration_theorique_kg?: number;
  saisi_par_nom?: string | null;
  modifie_le?: string;
  client_uuid?: string;
}

export interface ReformePoule {
  id?: number;
  lot: number;
  lot_nom?: string;
  date: string;
  quantite_vendue: number;
  prix_total: number;
  client: string;
  statut_paiement: 'PAYE' | 'IMPAYE';
  client_uuid?: string;
}

export interface MouvementStock {
  id?: number;
  date: string;
  type_mouvement: 'ENTREE' | 'SORTIE';
  type_aliment: string;
  type_aliment_libelle?: string;
  quantite_kg: number;
  nb_sacs: number | null;
  cout_achat: number | null;
  fournisseur: string;
  commentaire: string;
  automatique?: boolean;
  saisi_par_nom?: string | null;
}

export interface Transaction {
  id?: number;
  date: string;
  type_transaction: 'RECETTE' | 'DEPENSE';
  categorie: string;
  categorie_libelle?: string;
  quantite: number | null;
  montant_total: number;
  lot: number | null;
  lot_nom?: string | null;
  client: string;
  statut_paiement: 'PAYE' | 'IMPAYE';
  description: string;
  automatique?: boolean;
  saisi_par_nom?: string | null;
  client_uuid?: string;
}

export interface Parametres {
  seuil_alerte_stock_kg: number;
  oeufs_par_plateau: number;
  prix_plateau_defaut: number | null;
}

export interface PointCourbe {
  id?: number;
  semaine: number;
  taux_ponte_theorique: number;
}

export interface EtatStock {
  total_kg: number;
  seuil_alerte_kg: number;
  ration_totale_jour_kg: number;
  jours_restants: number | null;
  alerte: boolean;
  par_type: { type_aliment: string; libelle: string; stock_kg: number; ration_jour_kg: number; jours_restants: number | null; alerte: boolean }[];
}

export interface LotTerrain {
  id: number;
  nom: string;
  souche: string;
  age_semaines: number;
  age_jours: number;
  effectif: number;
  effectif_matin: number;
  ration_kg: number;
  type_aliment: string | null;
  type_aliment_libelle: string | null;
  grammes_par_poule_jour: number | null;
  suivi_du_jour: {
    id: number;
    oeufs_intacts: number;
    oeufs_casses: number;
    nb_deces: number;
    aliment_distribue_kg: number | null;
    taux_ponte: number | null;
  } | null;
}

export interface TableauTerrain {
  date: string;
  effectif_total: number;
  ration_totale_kg: number;
  oeufs_du_jour: number;
  taux_ponte_du_jour: number | null;
  saisies_a_faire: string[];
  lots: LotTerrain[];
  stock: EtatStock;
  parametres: { oeufs_par_plateau: number; prix_plateau_defaut: number | null };
}

export interface TableauPilotage {
  periode: { debut: string; fin: string };
  indicateurs: {
    effectif_actuel: number;
    oeufs_pondus: number;
    oeufs_commercialisables: number;
    oeufs_casses: number;
    taux_ponte_moyen: number | null;
    aliment_consomme_kg: number;
    indice_consommation_g_par_oeuf: number | null;
    deces: number;
    taux_mortalite: number | null;
    recettes: number;
    depenses: number;
    marge_nette: number;
    impayes: number;
    cout_revient_oeuf: number | null;
  };
  serie_jours: { date: string; oeufs: number; deces: number; taux_ponte: number | null }[];
  mortalite_par_motif: { motif: string; deces: number }[];
  courbes_ponte: {
    lot_id: number;
    lot: string;
    age_actuel_semaines: number;
    points: { semaine: number; reel: number | null; theorique: number | null }[];
  }[];
  finances_par_categorie: { categorie: string; libelle: string; type: string; total: number }[];
  bilan_mensuel: { mois: string; chiffre_affaires: number; charges: number; benefice: number }[];
  marges_par_lot: {
    lot_id: number;
    lot: string;
    statut: string;
    oeufs_pondus: number;
    taux_ponte_moyen: number | null;
    recettes: number;
    depenses: number;
    marge: number;
    cout_revient_oeuf: number | null;
  }[];
  methode_repartition: string;
  stock: EtatStock;
}
