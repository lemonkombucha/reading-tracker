# Marginalia — reading tracker

A static, local-first site for hitting a yearly reading goal: goal pace, daily page target, reading speed, shelves, reviews, quotes and stats. No build step — plain HTML, CSS and JavaScript.

## Publish on GitHub Pages

Repository **Settings → Pages → Build and deployment → Deploy from a branch**, choose `main` and `/ (root)`. The site appears at `https://<user>.github.io/<repo>/`.

## Goodreads

Goodreads retired its public API in December 2020, so no third-party site can sign in to it. Instead:

1. On Goodreads open **My Books → Import and export → Export Library**.
2. In the site, open **Sync & settings** and upload the CSV. Shelves, ratings, reviews and dates come across; re-importing updates rather than duplicates.

You can also export your library back out in Goodreads CSV format.

## Sign in with Google (optional)

Sign-in stores each visitor's library in a private app folder of their own Google Drive, so it syncs across devices. It needs a free OAuth Client ID:

1. In [Google Cloud Console](https://console.cloud.google.com/) create a project, then enable the **Google Drive API**.
2. Configure the OAuth consent screen (External) and add the scope `.../auth/drive.appdata`. Publish the app so people other than test users can sign in.
3. Create **Credentials → OAuth client ID → Web application** and add your site origin (for example `https://<user>.github.io`) under *Authorized JavaScript origins*.
4. Paste the Client ID into `config.js` (applies to every visitor) or into **Sync & settings** (this browser only).

Without sign-in, data stays in the browser's local storage; use **Download backup** in settings.

## Data sources

Book search and covers come from [Open Library](https://openlibrary.org/developers/api).
