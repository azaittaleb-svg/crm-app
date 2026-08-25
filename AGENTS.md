# Directives de Design et Ergonomie - Cockpit d'Exploitation (Style Sneat)

Ce document définit les directives de design, d'ergonomie et de développement pour préserver l'alignement visuel, la typographie élancée et l'esthétique épurée inspirée du thème Sneat.

## 1. Structure Spatiale & Alignements (Layout)
- **Alignement de Grille Militaire** : Ne jamais appliquer de padding horizontal (`px-*` ou `p-*`) sur le conteneur principal `<main>` ou le wrapper direct qui enveloppe le contenu de la page sous le Header. Utilisez exclusivement du padding vertical (`py-6 md:py-10`) combiné à la classe :
  `w-full max-w-[1468px] mx-auto px-6 md:px-10`
  Ceci garantit que tous les éléments (KPIs, Grilles, Saisie) s'alignent parfaitement au pixel près avec les limites gauche et droite du Header de la page d'accueil et du menu de navigation.
- **Zéro Double Padding** : Les pages et sous-pages rendues sous `<Layout>` ne doivent jamais re-déclarer de conteneur avec `px-6 md:px-10 max-w-[1468px]`, sous peine de doubler le retrait visuel et d'introduire des décalages avec le Header. L'alignement et la largeur maximale sont gérés au niveau de la structure globale.
- **Alignement du Header & Scrollbar** : Pour aligner le Header de navigation aux pixels près avec le contenu, il est placé en `sticky top-0` à l'intérieur du conteneur de défilement `<main id="main-scroll-container">`. Cela garantit que sa largeur droite s'adapte automatiquement à la présence ou non de la barre de défilement verticale, évitant tout dépassement inesthétique ou asymétrie.
- **Zéro Clutter d'En-tête** : Sur le Tableau de Bord (Home), évitez les headers massifs redondants ou les gros boutons d'action rapide comme "Nouvelle Vente". L'action de vente doit rester accessible depuis sa page dédiée ou les profils clients.

## 2. Bords, Arrondis & Conteneurs (Esthétique Sneat des Cartes)
- **Bordures Subtiles** : Utiliser systématiquement une bordure très fine `border border-slate-205` ou `border border-slate-200/60` pour tous les conteneurs (Cartes, KPIs, Tableaux).
- **Rayon de Courbure Modéré (Rounding - Coins rabaissés)** : Appliquer un arrondi compact et élégant de type **`rounded-lg` (8px)** ou **`rounded-xl` (12px)** sur tous les blocs de contenu principaux, fenêtres modales et sections d'actions. L'utilisation d'angles géants de type `rounded-[2rem]` ou `rounded-3xl` est interdite afin de respecter la finesse géométrique de Sneat et éviter un rendu enfantin.
- **Tableaux et Filtres Unifiés** : Les tableaux de données et leurs filtres (barre de recherche, onglets d'état) doivent être regroupés dans un seul grand conteneur commun (`bg-white border-slate-200/60 rounded-lg overflow-hidden`). La barre de recherche est intégrée dans le header du tableau (`border-b border-slate-100 py-3 px-5`), et l'en-tête dynamique du tableau `thead` doit être assombri à gris niveau 2 (`bg-slate-100/70`). Le padding interne des cellules `td` et `th` doit être serré (`px-5 py-3` minimum).

## 3. Palette de Couleurs Douces & États Pastel Épurés
Toutes les pastilles d'état, boutons secondaires et indicateurs doivent arborer un rendu doux (fat7) :
- **Orange / Ambre Doux (Créance / Partiel)** :
  - Classes : `bg-orange-50/70 text-orange-400 border border-orange-100` ou `bg-orange-100/50 text-orange-400`
  - Cas d'usage : Statuts "Partiel", focus recouvrement, alertes Zakat, en-cours clients.
- **Rouge / Rose Doux (Charges / Dues / Impayés)** :
  - Classes : `bg-rose-50/70 text-rose-400 border border-rose-100` ou `bg-rose-100/50 text-rose-400`
  - Cas d'usage : Statuts "Non payé", charges à liquider, dépenses critiques.
- **Vert Pastel (Régularisé / Validé)** :
  - Classes : `bg-emerald-50/70 text-emerald-600 border border-emerald-100`
  - Cas d'usage : Paiements complets, trésorerie collectée, comptes en règle.
- **Vert Succès (Tendances, KPIs, Textes)** :
  - Classes : `text-[#4fb922] dark:text-[#71dd37]` (vert assombri en light pour contraster, jaune/vert fluo Sneat en dark).
- **Zéro Couleur de Fond pour les Badges (Ghost Badges)** : Ne JAMAIS utiliser de background color (couleur d'arrière plan) pour les badges ou étiquettes textuelles de statut. Utilisez uniquement la couleur du texte pour indiquer l'état (ex: garder juste la couleur du texte verte ou rouge).


## 4. Typographie & Contrastes (Aérodynamisme Sneat)
- **Police Centrale Finexy** : Utiliser exclusivement la police **Public Sans** pour toute l'interface (corps de texte et titres) afin d'assurer l'esthétique ultra-pro, épurée et élancée de Sneat.
- **Échelle Typographique Proportionnelle** : Le texte courant de l'application utilise une taille de base compacte à **14px** (équivalent à `text-sm` ou `text-[14px]`). Ne pas utiliser de police trop grande. Les titres principaux conservent un aspect modéré (taille moyenne, semi-bold `font-semibold` à poids 600, sans excès de graisses de type black/extrabold).
- **Séparateurs & Chiffres Monos** : "JetBrains Mono" reste réservé exclusivement aux montants monétaires de l'application (DH) pour un alignement idéal des chiffres comptables. Les chiffres des KPIs globaux doivent toujours être très visibles, avec une graisse **`font-bold`** ou **`font-black`** et de couleur très sombre (ex: `text-[#222222]`) plutôt que grise, tout en préservant les couleurs fonctionnelles (vert, rouge, etc.) là où elles existent. Les petits textes descriptifs et les labels utilisent un gris plus sombre pour le contraste (ex: `text-[#566a7f]`).
- **Ombres Ultra-Légères** : Privilégier des ombres légères et diffuses (`shadow-[0_2px_12px_rgba(15,23,42,0.04)]` ou `shadow-2xs` ou `shadow-xs`) pour donner une infime profondeur sans alourdir le cockpit.

## 5. Navigation & Navbar (Accessibilité Contextuelle)
- **Header Épuré par Page** : Le Header (Navbar) principal supérieur doit s'adapter à la page courante :
  - Sur toutes les pages d'application métier (ex: Clients, Ventes), masquer les utilitaires globaux (Sélecteur de langue, Raccourcis, Notifications, Compte Google, Recherche globale). Afficher uniquement le bouton latéral pour ouvrir le menu et le titre complet de la page à gauche.
  - Seules la **page d'accueil (Dashboard)** et la **page Paramètres (Configuration)** sont autorisées à afficher l'intégration complète des fonctions utilitaires dans la navbar (Barre de recherche, cloche de notifications, avatar de compte, etc.).
- **Zéro En-tête Interne Redondant (Pas de Double Navbar)** : Ne jamais déclarer ou répéter de div d'en-tête, de titre de page, de bouton de retour ou de boutons d'action d'en-tête à l'intérieur d'une page (ex: `ClientDetailsPage` ou d'autres pages de détails) si la Navbar globale dans `<Layout>` gère déjà ces éléments d'en-tête (tels que le bouton retour, le titre, ou les boutons d'action comme "Nouvelle Vente", "Copier", "WhatsApp", etc.). Cela élimine les doubles barres d'en-tête inutiles et désencombre l'espace visuel.