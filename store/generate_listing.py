# Generates store/LISTING.md: store texts for Firefox (AMO) and the Chrome Web
# Store in every supported language, and syncs the Chrome summary into
# src/_locales/<lang>/messages.json (extDescription = manifest "description").
#
# AMO:  summary = plain text, max 250 chars; description = limited Markdown
#       (bold, italic, links, lists, blockquote, code; no headings).
# CWS:  summary = manifest description, plain text, max 132 chars;
#       description = plain text (line breaks kept, no Markdown).
#
# Usage: python3 store/generate_listing.py
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))

REPO = "https://github.com/teo666/komoot-to-gpx-exporter"

L = {
"en": dict(
 cws_summary="Export Komoot tours to GPX in one click, with a tour history, a persistent saved list and add-by-link. Runs fully in your browser.",
 summary="Export Komoot tours as GPX files in one click. Keeps a history of every tour you open, a saved list that survives reloads, and lets you add tours by ID or link. Works on desktop and Firefox for Android.",
 intro="Komoot GPX Exporter adds a small floating panel to **komoot.com**. Open any public tour and export it as a standard **GPX** file for your Garmin, Wahoo, phone or favourite route app.",
 features_t="Key features",
 features=[
  "**One-click GPX export**: GPX 1.1 files with coordinates, elevation and timestamps when available, named after the tour.",
  "**Follows the tour you are looking at**: detects the open tour on discover maps, tour pages and smart tours, even when Komoot reopens it from its cache.",
  "**Automatic history**: every tour you open is listed in the *History* tab (up to 100), ready to download later.",
  "**Saved list**: collect up to 40 tours and download them one by one or all at once. The list survives page reloads and syncs across open Komoot tabs.",
  "**Add by ID or link**: paste a komoot.com tour link or a tour ID. It is checked with Komoot first, with a clear message if the tour does not exist or is private.",
  "**Compact, draggable panel**: collapse it to a slim bar and drag it anywhere. Position, state and active tab are remembered.",
  "**Desktop and mobile**: Chrome and Firefox on desktop, and Firefox for Android with a touch-friendly panel.",
  "**5 languages**: English, Italiano, Español, Deutsch and Français, following your browser language.",
 ],
 how_t="How it works",
 how=["Open a tour on komoot.com.", "Press **Add Trace** (or use **+ ID** to paste a link).", "Press **Download**, or **Download all** for the whole list."],
 privacy_t="Privacy",
 privacy=[
  "GPX files are built locally in your browser from Komoot's own data.",
  "No account, no analytics, no servers of ours: the extension only talks to komoot.com.",
  "History and saved list stay in your browser's extension storage and never leave your device.",
 ],
 perms_t="Permissions",
 perms=[
  "*Download files*: to save the GPX files.",
  "*Storage*: to keep your history, saved list and panel position.",
  "*Access to komoot.com and api.komoot.de*: to read the tour data you export.",
 ],
 source=f"Source code and issue tracker: [GitHub]({REPO})",
 disclaimer="_Komoot GPX Exporter is an independent project, not affiliated with or endorsed by komoot GmbH._",
),
"it": dict(
 cws_summary="Esporta i tour di Komoot in GPX con un clic, con cronologia, lista salvata persistente e aggiunta via link. Tutto nel browser.",
 summary="Esporta i tour di Komoot in GPX con un clic. Tiene una cronologia di ogni tour che apri, una lista salvata che resta dopo il refresh, e ti permette di aggiungere tour tramite ID o link. Funziona su desktop e su Firefox per Android.",
 intro="Komoot GPX Exporter aggiunge un piccolo pannello flottante su **komoot.com**. Apri un qualsiasi tour pubblico ed esportalo come file **GPX** standard per il tuo Garmin, Wahoo, telefono o la tua app di percorsi preferita.",
 features_t="Funzionalità principali",
 features=[
  "**Esportazione GPX con un clic**: file GPX 1.1 con coordinate, altitudine e orari quando disponibili, con il nome del tour.",
  "**Segue il tour che stai guardando**: riconosce il tour aperto sulle mappe di ricerca, sulle pagine dei tour e sugli smart tour, anche quando Komoot lo riapre dalla sua cache.",
  "**Cronologia automatica**: ogni tour che apri compare nella scheda *Cronologia* (fino a 100), pronto da scaricare in seguito.",
  "**Lista salvata**: raccogli fino a 40 tour e scaricali uno alla volta o tutti insieme. La lista resta dopo il refresh ed è sincronizzata tra le schede di Komoot aperte.",
  "**Aggiunta tramite ID o link**: incolla un link a un tour di komoot.com o un ID. Viene prima verificato con Komoot, con un messaggio chiaro se il tour non esiste o è privato.",
  "**Pannello compatto e trascinabile**: comprimilo in una barra sottile e spostalo dove vuoi. Posizione, stato e scheda attiva vengono ricordati.",
  "**Desktop e mobile**: Chrome e Firefox su desktop, e Firefox per Android con un pannello pensato per il touch.",
  "**5 lingue**: English, Italiano, Español, Deutsch e Français, in base alla lingua del browser.",
 ],
 how_t="Come funziona",
 how=["Apri un tour su komoot.com.", "Premi **Aggiungi traccia** (oppure usa **+ ID** per incollare un link).", "Premi **Scarica**, oppure **Scarica tutte** per l'intera lista."],
 privacy_t="Privacy",
 privacy=[
  "I file GPX vengono creati localmente nel browser a partire dai dati di Komoot.",
  "Nessun account, nessuna statistica, nessun server nostro: l'estensione comunica solo con komoot.com.",
  "Cronologia e lista salvata restano nello spazio dell'estensione nel tuo browser e non lasciano il tuo dispositivo.",
 ],
 perms_t="Permessi",
 perms=[
  "*Scaricare file*: per salvare i file GPX.",
  "*Archiviazione*: per ricordare cronologia, lista salvata e posizione del pannello.",
  "*Accesso a komoot.com e api.komoot.de*: per leggere i dati dei tour che esporti.",
 ],
 source=f"Codice sorgente e segnalazioni: [GitHub]({REPO})",
 disclaimer="_Komoot GPX Exporter è un progetto indipendente, non affiliato né approvato da komoot GmbH._",
),
"es": dict(
 cws_summary="Exporta rutas de Komoot a GPX con un clic, con historial, lista guardada persistente y añadir por enlace. Todo en tu navegador.",
 summary="Exporta las rutas de Komoot a GPX con un clic. Guarda un historial de cada ruta que abres y una lista que se conserva al recargar, y permite añadir rutas por ID o enlace. Funciona en escritorio y en Firefox para Android.",
 intro="Komoot GPX Exporter añade un pequeño panel flotante a **komoot.com**. Abre cualquier ruta pública y expórtala como archivo **GPX** estándar para tu Garmin, Wahoo, móvil o tu app de rutas favorita.",
 features_t="Funciones principales",
 features=[
  "**Exportación GPX con un clic**: archivos GPX 1.1 con coordenadas, altitud y horas cuando están disponibles, con el nombre de la ruta.",
  "**Sigue la ruta que estás viendo**: detecta la ruta abierta en los mapas de búsqueda, en las páginas de rutas y en los smart tours, incluso cuando Komoot la reabre desde su caché.",
  "**Historial automático**: cada ruta que abres aparece en la pestaña *Historial* (hasta 100), lista para descargarla después.",
  "**Lista guardada**: reúne hasta 40 rutas y descárgalas una a una o todas a la vez. La lista se conserva al recargar la página y se sincroniza entre las pestañas de Komoot abiertas.",
  "**Añadir por ID o enlace**: pega un enlace a una ruta de komoot.com o un ID. Antes se comprueba con Komoot, con un mensaje claro si la ruta no existe o es privada.",
  "**Panel compacto y arrastrable**: contráelo en una barra fina y muévelo donde quieras. Se recuerdan la posición, el estado y la pestaña activa.",
  "**Escritorio y móvil**: Chrome y Firefox en escritorio, y Firefox para Android con un panel pensado para pantallas táctiles.",
  "**5 idiomas**: English, Italiano, Español, Deutsch y Français, según el idioma del navegador.",
 ],
 how_t="Cómo funciona",
 how=["Abre una ruta en komoot.com.", "Pulsa **Añadir ruta** (o usa **+ ID** para pegar un enlace).", "Pulsa **Descargar**, o **Descargar todas** para toda la lista."],
 privacy_t="Privacidad",
 privacy=[
  "Los archivos GPX se generan localmente en tu navegador a partir de los datos de Komoot.",
  "Sin cuenta, sin estadísticas, sin servidores propios: la extensión solo se comunica con komoot.com.",
  "El historial y la lista guardada se quedan en el almacenamiento de la extensión en tu navegador y nunca salen de tu dispositivo.",
 ],
 perms_t="Permisos",
 perms=[
  "*Descargar archivos*: para guardar los archivos GPX.",
  "*Almacenamiento*: para recordar el historial, la lista guardada y la posición del panel.",
  "*Acceso a komoot.com y api.komoot.de*: para leer los datos de las rutas que exportas.",
 ],
 source=f"Código fuente y seguimiento de incidencias: [GitHub]({REPO})",
 disclaimer="_Komoot GPX Exporter es un proyecto independiente, no afiliado ni respaldado por komoot GmbH._",
),
"de": dict(
 cws_summary="Komoot-Touren mit einem Klick als GPX exportieren: mit Verlauf, dauerhafter Merkliste und Hinzufügen per Link. Alles lokal.",
 summary="Exportiere Komoot-Touren mit einem Klick als GPX. Mit Verlauf aller geöffneten Touren, einer gespeicherten Liste, die das Neuladen übersteht, und Hinzufügen per ID oder Link. Für Desktop und Firefox für Android.",
 intro="Komoot GPX Exporter fügt **komoot.com** ein kleines schwebendes Panel hinzu. Öffne eine beliebige öffentliche Tour und exportiere sie als Standard-**GPX**-Datei für dein Garmin, Wahoo, Smartphone oder deine liebste Routen-App.",
 features_t="Die wichtigsten Funktionen",
 features=[
  "**GPX-Export mit einem Klick**: GPX-1.1-Dateien mit Koordinaten, Höhe und Zeitstempeln (falls vorhanden), benannt nach der Tour.",
  "**Folgt der Tour, die du ansiehst**: erkennt die geöffnete Tour auf Entdecken-Karten, Tourseiten und Smart Tours, auch wenn Komoot sie aus dem Cache neu öffnet.",
  "**Automatischer Verlauf**: jede geöffnete Tour erscheint im Tab *Verlauf* (bis zu 100) und kann später heruntergeladen werden.",
  "**Gespeicherte Liste**: sammle bis zu 40 Touren und lade sie einzeln oder alle auf einmal herunter. Die Liste bleibt beim Neuladen erhalten und wird zwischen geöffneten Komoot-Tabs synchronisiert.",
  "**Per ID oder Link hinzufügen**: füge einen komoot.com-Tourlink oder eine Tour-ID ein. Sie wird zuerst bei Komoot geprüft, mit einer klaren Meldung, falls die Tour nicht existiert oder privat ist.",
  "**Kompaktes, verschiebbares Panel**: klappe es zu einer schmalen Leiste zu und ziehe es an eine beliebige Stelle. Position, Zustand und aktiver Tab werden gespeichert.",
  "**Desktop und Mobil**: Chrome und Firefox auf dem Desktop sowie Firefox für Android mit einem touchfreundlichen Panel.",
  "**5 Sprachen**: English, Italiano, Español, Deutsch und Français, passend zur Browsersprache.",
 ],
 how_t="So funktioniert es",
 how=["Öffne eine Tour auf komoot.com.", "Tippe auf **Tour hinzufügen** (oder füge mit **+ ID** einen Link ein).", "Tippe auf **Herunterladen** oder auf **Alle herunterladen** für die ganze Liste."],
 privacy_t="Datenschutz",
 privacy=[
  "GPX-Dateien werden lokal in deinem Browser aus den Daten von Komoot erstellt.",
  "Kein Konto, keine Statistiken, keine eigenen Server: die Erweiterung kommuniziert nur mit komoot.com.",
  "Verlauf und gespeicherte Liste bleiben im Erweiterungsspeicher deines Browsers und verlassen nie dein Gerät.",
 ],
 perms_t="Berechtigungen",
 perms=[
  "*Dateien herunterladen*: um die GPX-Dateien zu speichern.",
  "*Speicher*: für Verlauf, gespeicherte Liste und Position des Panels.",
  "*Zugriff auf komoot.com und api.komoot.de*: um die Daten der exportierten Touren zu lesen.",
 ],
 source=f"Quellcode und Fehlermeldungen: [GitHub]({REPO})",
 disclaimer="_Komoot GPX Exporter ist ein unabhängiges Projekt und steht in keiner Verbindung zur komoot GmbH._",
),
"fr": dict(
 cws_summary="Exportez les itinéraires Komoot en GPX en un clic : historique, liste enregistrée persistante et ajout par lien. Tout en local.",
 summary="Exportez les itinéraires Komoot en GPX en un clic. Historique de chaque itinéraire ouvert, liste enregistrée conservée après rechargement, ajout par ID ou lien. Fonctionne sur ordinateur et sur Firefox pour Android.",
 intro="Komoot GPX Exporter ajoute un petit panneau flottant sur **komoot.com**. Ouvrez n’importe quel itinéraire public et exportez-le en fichier **GPX** standard pour votre Garmin, Wahoo, téléphone ou votre application d’itinéraires préférée.",
 features_t="Fonctionnalités principales",
 features=[
  "**Export GPX en un clic** : fichiers GPX 1.1 avec coordonnées, altitude et horodatage quand ils sont disponibles, au nom de l’itinéraire.",
  "**Suit l’itinéraire que vous consultez** : détecte l’itinéraire ouvert sur les cartes de découverte, les pages d’itinéraires et les smart tours, même quand Komoot le rouvre depuis son cache.",
  "**Historique automatique** : chaque itinéraire ouvert apparaît dans l’onglet *Historique* (jusqu’à 100), prêt à être téléchargé plus tard.",
  "**Liste enregistrée** : rassemblez jusqu’à 40 itinéraires et téléchargez-les un par un ou tous ensemble. La liste est conservée après rechargement et synchronisée entre les onglets Komoot ouverts.",
  "**Ajout par ID ou lien** : collez un lien d’itinéraire komoot.com ou un ID. Il est d’abord vérifié auprès de Komoot, avec un message clair si l’itinéraire n’existe pas ou est privé.",
  "**Panneau compact et déplaçable** : réduisez-le en une barre fine et déplacez-le où vous voulez. Position, état et onglet actif sont mémorisés.",
  "**Ordinateur et mobile** : Chrome et Firefox sur ordinateur, et Firefox pour Android avec un panneau adapté au tactile.",
  "**5 langues** : English, Italiano, Español, Deutsch et Français, selon la langue du navigateur.",
 ],
 how_t="Comment ça marche",
 how=["Ouvrez un itinéraire sur komoot.com.", "Appuyez sur **Ajouter la trace** (ou utilisez **+ ID** pour coller un lien).", "Appuyez sur **Télécharger**, ou sur **Tout télécharger** pour toute la liste."],
 privacy_t="Confidentialité",
 privacy=[
  "Les fichiers GPX sont créés localement dans votre navigateur à partir des données de Komoot.",
  "Pas de compte, pas de statistiques, pas de serveurs à nous : l’extension communique uniquement avec komoot.com.",
  "L’historique et la liste enregistrée restent dans le stockage de l’extension de votre navigateur et ne quittent jamais votre appareil.",
 ],
 perms_t="Autorisations",
 perms=[
  "*Télécharger des fichiers* : pour enregistrer les fichiers GPX.",
  "*Stockage* : pour mémoriser l’historique, la liste enregistrée et la position du panneau.",
  "*Accès à komoot.com et api.komoot.de* : pour lire les données des itinéraires exportés.",
 ],
 source=f"Code source et suivi des problèmes : [GitHub]({REPO})",
 disclaimer="_Komoot GPX Exporter est un projet indépendant, non affilié à komoot GmbH ni approuvé par celle-ci._",
),
}

NAMES = {"en": "English", "it": "Italiano", "es": "Español", "de": "Deutsch", "fr": "Français"}

EXTRA = """## Release notes 0.2.0

**English** (AMO "Release notes" / CWS changelog)

```text
• New floating panel: one collapsible, draggable widget instead of the bottom bar and side panel.
• History tab with every tour you open, kept across reloads.
• Saved tracks now survive page reloads and sync across tabs.
• Add a tour by ID or by pasting a komoot.com link.
• Reliable tour detection: fixes reopened tours not being selected, smart tours (numeric IDs) and tours opened on narrow screens.
• Available in English, Italian, Spanish, German and French.
```

**Italiano**

```text
• Nuovo pannello flottante: un unico widget comprimibile e trascinabile al posto della barra in basso e del pannello laterale.
• Scheda Cronologia con ogni tour aperto, conservata dopo il refresh.
• Le tracce salvate ora restano dopo il refresh e si sincronizzano tra le schede.
• Aggiunta di un tour tramite ID o incollando un link di komoot.com.
• Riconoscimento dei tour più affidabile: corretti i tour riaperti che non venivano selezionati, gli smart tour (ID numerici) e i tour aperti su schermi stretti.
• Disponibile in inglese, italiano, spagnolo, tedesco e francese.
```

## Screenshot captions

1. `1-hero.png`: Export any Komoot tour to GPX
2. `2-history.png`: Every tour you open is remembered
3. `3-addById.png`: Add a tour by ID or link
4. `4-compact.png`: Compact, draggable, out of your way
5. `5-mobile.png`: Made for mobile too
6. `6-features.png`: Everything stays in your browser
"""


def amo_markdown(d):
    return "\n".join([
        d["intro"], "",
        f"**{d['features_t']}**", "", *[f"- {x}" for x in d["features"]], "",
        f"**{d['how_t']}**", "", *[f"{i}. {x}" for i, x in enumerate(d["how"], 1)], "",
        f"**{d['privacy_t']}**", "", *[f"- {x}" for x in d["privacy"]], "",
        f"**{d['perms_t']}**", "", *[f"- {x}" for x in d["perms"]], "",
        d["source"], "", d["disclaimer"],
    ])


def plain(text):
    """Strips AMO Markdown for the Chrome Web Store (plain text only)."""
    text = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r"\2", text)
    text = text.replace("**", "")
    text = re.sub(r"(?<![\w])_(.+?)_(?![\w])", r"\1", text)
    text = re.sub(r"(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])", r"\1", text)
    return text


def cws_text(d):
    return "\n".join([
        plain(d["intro"]), "",
        f"★ {d['features_t']}", *[f"• {plain(x)}" for x in d["features"]], "",
        f"★ {d['how_t']}", *[f"{i}. {plain(x)}" for i, x in enumerate(d["how"], 1)], "",
        f"★ {d['privacy_t']}", *[f"• {plain(x)}" for x in d["privacy"]], "",
        f"★ {d['perms_t']}", *[f"• {plain(x)}" for x in d["perms"]], "",
        plain(d["source"]), "", plain(d["disclaimer"]),
    ])


out = []
w = out.append
w("# Store listing — Komoot GPX Exporter")
w("")
w("Generated by `store/generate_listing.py`: edit the texts there and run `python3 store/generate_listing.py`.")
w("")
w("| Store | Field | Format | Limit |")
w("|---|---|---|---|")
w("| Firefox (AMO) | Summary | plain text | 250 chars |")
w("| Firefox (AMO) | Description | limited Markdown: bold, italic, links, lists, blockquote, code (no headings) | — |")
w("| Chrome Web Store | Summary | manifest `description` = `extDescription` in `src/_locales/<lang>/messages.json` (synced by the script) | 132 chars |")
w("| Chrome Web Store | Description | plain text, line breaks kept | 16,000 chars |")
w("")
w("Screenshots: `store/screenshots/en/*.png` (1280×800, valid for both stores; the Chrome Web Store accepts up to 5).")
w("")
w("---")
w("")
w("## Firefox — addons.mozilla.org")
for lang, d in L.items():
    assert len(d["summary"]) <= 250, (lang, len(d["summary"]))
    w("")
    w(f"### {NAMES[lang]} (`{lang}`)")
    w("")
    w(f"**Summary** ({len(d['summary'])}/250)")
    w("")
    w("```text")
    w(d["summary"])
    w("```")
    w("")
    w("**Description** (Markdown)")
    w("")
    w("```markdown")
    w(amo_markdown(d))
    w("```")
w("")
w("---")
w("")
w("## Chrome Web Store")
for lang, d in L.items():
    assert len(d["cws_summary"]) <= 132, (lang, len(d["cws_summary"]))
    txt = cws_text(d)
    assert len(txt) <= 16000
    w("")
    w(f"### {NAMES[lang]} (`{lang}`)")
    w("")
    w(f"**Summary** ({len(d['cws_summary'])}/132, from the manifest `extDescription`)")
    w("")
    w("```text")
    w(d["cws_summary"])
    w("```")
    w("")
    w("**Description** (plain text)")
    w("")
    w("```text")
    w(txt)
    w("```")
    # Keep the manifest description (Chrome's store summary) in sync.
    path = os.path.join(HERE, "..", "src", "_locales", lang, "messages.json")
    with open(path, encoding="utf-8") as f:
        messages = json.load(f)
    messages["extDescription"]["message"] = d["cws_summary"]
    with open(path, "w", encoding="utf-8") as f:
        json.dump(messages, f, ensure_ascii=False, indent=2)
        f.write("\n")

w("")
w("---")
w("")
with open(os.path.join(HERE, "LISTING.md"), "w", encoding="utf-8") as f:
    f.write("\n".join(out) + "\n" + EXTRA)
for lang, d in L.items():
    print(f"{lang}: AMO summary {len(d['summary'])}/250, CWS summary {len(d['cws_summary'])}/132")
