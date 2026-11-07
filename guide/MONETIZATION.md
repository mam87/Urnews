# Monetization readiness

Everything below is built and **switched off**. No paid service is connected and nothing changes for readers until an
editor turns it on in **admin → الإعدادات**. (Migration `20261107000027_monetization_ready.sql`, `assets/js/monetize.js`.)

## 1. Advertising slots — `ads_config`
```json
{ "enabled": false,
  "slots": ["home_side", "article", "sports"],
  "house": [ { "title_ar": "…", "title_en": "…", "text_ar": "…", "text_en": "…",
               "url": "https://…", "image": "https://… (optional)", "sponsor": "Sponsor name (optional)" } ] }
```
* Slots: home page sidebar (`home_side`, below the feed on phones), end of article pages (`article`), bottom of the
  sports centre (`sports`). One ad per slot, picked at random from `house`. No pop-ups, interstitials, auto-playing
  media or ads between a headline and its text.
* Every ad carries a visible **«إعلان / Advertisement»** label (plus «برعاية …» when `sponsor` is set) and its link
  uses `rel="sponsored"`. Only `https://` links and images are accepted. When off, or with an empty list, nothing is
  drawn — no empty boxes, no layout shift.
* **House ads cost nothing** — use them for your own products (e.g. CV Pro, Forsa) or direct sponsors you invoice.
* **Third-party networks (e.g. Google AdSense)** are deliberately not wired in: they need their script on every page,
  a `Content-Security-Policy` change (`script-src`, `frame-src`, `img-src` for their domains), an `ads.txt` file at the
  site root, a consent banner for EU/UK visitors, and account approval. Do this only after approval; then add a provider
  branch to `adSlot()` in `monetize.js`. Note: AdSense policies restrict pages that are mostly third-party excerpts —
  the original full reports and the sports/map pages are the stronger candidates.

## 2. Sponsored sections
Use `sponsor` on a house ad for a labelled sponsorship of a slot (e.g. the sports centre «برعاية …»). Sponsored
*articles* are not supported on purpose: editorial content and advertising stay separate.

## 3. Newsletter — `newsletter_enabled`
* `true` shows a sign-up box (home sidebar, end of article pages) with an explicit consent checkbox.
* `news_newsletter_subscribe(email, language, consent)` validates the address, requires consent, ignores duplicates
  without revealing them, refuses when switched off and caps sign-ups at 20/minute. Addresses are readable only by
  editors (RLS); admin → الإعدادات shows the count and a **CSV export**.
* **Sending is not connected.** To send: pick an e-mail provider (e.g. Brevo, Resend, Mailchimp — free tiers exist),
  import the CSV or sync via an Edge Function holding the provider key as a secret, send a confirmation e-mail
  (double opt-in) and include the unsubscribe link (`unsubscribe_token`). Do not send from the browser.

## 4. Premium features (future)
Possible paid tiers on top of what exists: ad-free reading, e-mail alerts for followed countries/teams, extended
sports statistics from a paid data plan. These need accounts and payments (e.g. Supabase Auth + a payment provider)
and are not built.
