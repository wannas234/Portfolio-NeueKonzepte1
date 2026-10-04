# Public page artwork

`public/brand/auth-mountains.png` is shared by the landing and authentication pages. Generated with the built-in image generation tool; no external image service is needed at runtime.

Generation prompt:

> Create a decorative background asset for a light university study web app login screen, wide landscape 1536x1024. NOT a UI screenshot. No text, no logos, no people, no buildings. Refined hand-painted digital illustration of alpine snowy mountains and dark blue teal evergreen trees only in the bottom left corner, occupying bottom 30 percent, with a few pale lavender distant mountain peaks along the bottom edge fading toward right. Upper 70 percent is almost-white #f8faff empty space, with extremely subtle broad translucent pale cyan and lavender curved ribbons. Airy, calm, polished, delicate low-poly painted alpine illustration, like a modern premium educational website. Keep center and right almost entirely empty white for overlaying form fields. Dark pine silhouettes at far bottom left, mountain heights gradually slope down towards middle, atmospheric pale blue distance. Full bleed background.

The landing dashboard is a static, labelled example built with HTML and CSS and existing brand assets. Its sample data is not used by authenticated pages.

Google sign-in is visibly unavailable: the inspected backend configuration has no enabled Google provider. Email/password authentication, registration and password recovery continue to use the existing integrations. Enabling Google OAuth and configuring its provider credentials and redirect allowlist remain backend configuration tasks. No placeholder legal destinations were added.
