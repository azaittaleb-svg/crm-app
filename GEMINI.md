# Production-Ready Design Rules (Sneat Layout)

- **Always Enforce Width Bounds**:
  To ensure perfect alignment across all viewports and adhere to user directives, always maintain exactly `w-full max-w-[1468px] mx-auto px-6 md:px-10` for both the application navbar/header and the main container/content wrapper under `<Layout>`. This ensures a seamless "military grade" grid alignment with exactly `1388px` inner content width.

- **Strictly Avoid Redundant Internal Headers / Navbars**:
  Never duplicate title headers, back buttons, or action button groups (e.g. "Nouvelle Vente", "Copier", "WhatsApp", print buttons, etc.) inside inner pages like `ClientDetailsPage` if they are already present/handled by the global navbar inside `Layout.tsx`. This avoids double navbars, simplifies the DOM, and provides a clean, professional, non-cluttered user interface.

