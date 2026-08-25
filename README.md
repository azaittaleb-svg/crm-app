# Gestionnaire de Crédit Client (Masroufati) - v3.0 Premium

Ce projet est un Cockpit d'Exploitation complet doté d'une architecture backend robuste et modulaire construite avec Node.js, Express, TypeScript, Vite et Gemini AI.

---

## 1. Architecture du Système

Le projet suit une architecture multicouche (N-Tier) standard de l'industrie pour séparer les préoccupations, améliorer la testabilité et faciliter l'évolutivité.

```
Route (Entrée HTTP) -> Controller (Requête/Réponse) -> Service (Logique métier) -> Intégrations / Modèles AI
```

### Avantages de l'Architecture :
- **Sécurisé par défaut** : Clés API et identifiants SMTP isolés côté serveur dans des modules de configuration dédiés.
- **Modulaire** : Gestion des erreurs centralisée et routage découpé par domaine fonctionnel.
- **Type-safe** : Contrats d'interfaces TypeScript rigoureux pour tous les échanges de données.
- **Logs centralisés** : Système de logger hiérarchisé (info, warn, error, debug).

---

## 2. Structure des Dossiers (Backend)

Le backend a été refactorisé dans la structure suivante sous `/server` :

```text
server/
├── app.ts                  # Déclaration de l'application Express et montage des routeurs
├── routes/                 # Définition des routes d'API HTTP
│   ├── email.routes.ts     # Routage des emails
│   ├── gemini.routes.ts    # Routage des appels AI Gemini
│   ├── invoice.routes.ts   # Squelette routage factures
│   ├── supplier.routes.ts  # Squelette routage fournisseurs
│   ├── customer.routes.ts  # Squelette routage clients
│   ├── accounting.routes.ts# Squelette routage comptabilité
│   ├── bank.routes.ts      # Squelette routage transactions bancaires
│   └── dashboard.routes.ts # Squelette routage indicateurs de performance
├── controllers/            # Contrôleurs HTTP de gestion requête/réponse
│   ├── email.controller.ts # Contrôleur pour l'envoi de documents par email
│   ├── gemini.controller.ts# Contrôleur pour le traitement de documents avec Gemini
│   ├── invoice.controller.ts
│   ├── supplier.controller.ts
│   └── customer.controller.ts
├── services/               # Services métiers contenant la logique applicative pure
│   ├── email.service.ts    # Service d'envoi d'emails via Nodemailer
│   ├── gemini.service.ts   # Intégration du SDK Google GenAI (gemini-3.5-flash)
│   ├── pdf.service.ts
│   ├── ocr.service.ts
│   ├── accounting.service.ts
│   ├── supplier.service.ts
│   └── customer.service.ts
├── middleware/             # Middlewares Express réutilisables
│   ├── auth.ts             # Middleware d'autorisation squelette
│   ├── errorHandler.ts     # Gestion centralisée et propre des erreurs Express
│   ├── logger.ts           # Intercepteur HTTP pour journaliser les requêtes entrantes
│   └── rateLimit.ts        # Limiteur de débit squelette
├── config/                 # Centralisation de toutes les configurations de l'application
│   ├── firebase.ts         # Configuration SDK Firebase
│   ├── gemini.ts           # Configuration de l'API Gemini
│   ├── smtp.ts             # Identifiants de serveur de messagerie SMTP
│   └── app.ts              # Variables de portabilité réseau Express
├── utils/                  # Fonctions utilitaires partagées
│   ├── logger.ts           # Système de journalisation standardisé
│   ├── currency.ts         # Formatage de devises
│   ├── vat.ts              # Calculs de TVA
│   ├── similarity.ts       # Comparaison lexicale de chaînes
│   ├── iban.ts             # Validation de coordonnées bancaires (IBAN)
│   ├── validator.ts        # Validation d'emails et formats
│   └── formatter.ts        # Formatage de dates et chaînes
├── constants/              # Valeurs constantes partagées
│   ├── app.ts              # Limites de fichiers, ports par défaut
│   ├── email.ts            # Modèles d'emails et credentials par défaut
│   └── vat.ts              # Taux de taxe et règles d'imposition
└── types/                  # Déclarations de types et interfaces TypeScript
    ├── Invoice.ts          # Modèles de données facturation
    ├── Supplier.ts         # Modèles de données fournisseurs
    ├── Customer.ts         # Modèles de données clients
    ├── Bank.ts             # Modèles de relevés bancaires
    └── Gemini.ts           # Interfaces pour requêtes / réponses AI
```

---

## 3. Variables d'Environnement

Configurez les variables suivantes dans votre fichier `.env` ou configurez-les directement dans les paramètres secrets de la plateforme :

```env
# Clé d'API principale pour l'intelligence artificielle Gemini (Requis)
GEMINI_API_KEY=votre_cle_gemini_api

# Informations d'envoi d'emails par SMTP (Requis pour l'envoi de factures)
SENDER_EMAIL=contact@workstation.ma
SENDER_PASSWORD=skcg bkrb fphc fzpp

# Configuration facultative
PORT=3000
NODE_ENV=development
```

---

## 4. Installation et Démarrage

### Installation des Dépendances
Pour installer toutes les dépendances listées dans `package.json` :
```bash
npm install
```

### Lancement en Mode Développement
Pour démarrer le serveur de développement local avec rechargement à chaud (Hot-Reload) géré par `tsx` :
```bash
npm run dev
```

### Compilation pour la Production
La compilation génère à la fois l'application client (Single Page Application réactive) via Vite et compile le serveur de manière autonome dans un bundle CommonJS optimisé :
```bash
npm run build
```

### Lancement en Mode Production
Pour démarrer le serveur compilé autonome :
```bash
npm run start
```

---

## 5. Déploiement

Le projet est conçu pour être déployé sur des conteneurs Cloud Run :
1. Le build de production assemble l'ensemble statique dans le répertoire `dist`.
2. Le fichier `server.ts` compilé est regroupé par `esbuild` en un fichier optimisé unique `dist/server.cjs` résolvant toutes ses importations de manière autonome.
3. Le serveur de production s'exécute via `node dist/server.cjs`, écoute sur le port `3000` et sert l'interface web tout en exposant les endpoints d'API.
