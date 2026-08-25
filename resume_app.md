# Résumé de l'Application : Gestionnaire de Crédit Client

## 📝 Présentation Générale
L'application **Gestionnaire de Crédit Client** (CRM/ERP) est un système de gestion complet destiné aux commerçants et aux petites entreprises. Il permet le suivi détaillé des transactions commerciales : achats, créances (crédits), paiements fournisseurs et charges d'exploitation ("Masroufati").

## ✨ Fonctionnalités Principales

### 1. Gestion des Clients et Fournisseurs
- **Annuaire des partenaires :** Enregistrement des informations des clients et des fournisseurs.
- **Suivi des soldes :** Visualisation en temps réel du solde débiteur/créditeur pour chaque partenaire.
- **Comptes liés :** Possibilité de lier un compte client à un compte fournisseur (Partners Balance) pour un calcul exact de la balance nette globale.

### 2. Modèles de Commandes et Achats
- **Création/Édition de Commandes (Achats & Ventes) :** Ajout de détails comme les articles (produit, quantité, prix, description).
- **Consultation Historique :** Vues dédiées pour explorer et filtrer l'historique des opérations de chaque partenaire.

### 3. Trésorerie et Gestion des Paiements
- **Enregistrement des versements :** Saisie des règlements (partiels ou globaux) liés à une commande/achat.
- **Historique de paiement :** Historique détaillé modifiable ou supprimable pour chaque transaction, avec la mise à jour immédiate des dettes/créances.

### 4. Suivi des Dépenses (Masroufati)
- **Modèles de charges :** Création de gabarits de dépenses récurrentes (salaires, loyers, électricité, etc.).
- **Pointage mensuel :** Suivi des charges réglées au cours du mois avec des indicateurs d'état.

### 5. Tableau de Bord & Fonctions Avancées
- **Statistiques en temps réel :** Récapitulatifs sur la page d'accueil avec les derniers mouvements.
- **Export / Sauvegardes :** Système de Backup (`adminService.ts`) pour exporter les données complètes (Clients, fournisseurs, paiements, etc.) de la base Firestore.
- **Impression :** Support pour vues d'impression de factures/reçus.

## 🛠️ Stack Technique
- **Frontend :**
  - React 19 (TypeScript), Vite.
  - React Router DOM pour la navigation (Pages, Vues détaillées).
  - Interface visuelle et design stylisé avec Tailwind CSS et des icônes de Lucide React.
  - Animations avec Framer Motion.
  - Graphiques & Analyses de données : Recharts et D3.
- **Backend / Sécurité :**
  - Firebase Authentication (authentification robuste).
  - Firebase Cloud Firestore (règles strictes basées sur validation RBAC & Zero Trust).

## 💡 Approche
L’application a été optimisée pour la vitesse, la fiabilité du hors ligne via Firebase, et surtout avec des contrôles croisés rigoureux pour garantir que la comptabilité et les caisses tombent toujours justes.
