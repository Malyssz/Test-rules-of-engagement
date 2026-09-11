# Workflow: Cotygodniowy news o Rules of Engagement: The Grey State

## Cel
Co tydzień sprawdzić, czy twórcy gry "Rules of Engagement: The Grey State" (Grey State Studio /
Tencent) opublikowali coś nowego — szczególnie datę bety, datę pełnej premiery, lub inne istotne
info o postępie prac — i dostarczyć użytkownikowi krótki digest jako plik.

## Źródła
- Steam News RSS (appid 3978820): `https://store.steampowered.com/feeds/news/app/3978820/`
- YouTube RSS (@Play_ROE): `https://www.youtube.com/feeds/videos.xml?channel_id=UCzxH3ovfNamSg2w046MG_HA`

Discord i X/Twitter nie są objęte tym workflow (brak darmowego RSS) — jeśli w przyszłości trzeba
je dodać, wymaga to bota/klucza API i osobnej decyzji.

## Narzędzie
`tools/fetch_game_news.py` w tym projekcie. Pobiera oba feedy, porównuje ze stanem zapisanym w
`state.json` (katalog główny projektu) i zwraca tylko nowe wpisy.

## Kroki
1. Uruchom tool z zapisem wyniku:
   ```
   python tools/fetch_game_news.py --output .tmp/fetch_result_<YYYY-MM-DD>.json
   ```
2. Wczytaj wynikowy JSON (`steam.status`, `steam.new_items`, `youtube.status`,
   `youtube.new_items`, `total_new`, `is_first_run`).
3. Zbuduj czytelny digest w Markdown i zapisz go jako
   `.tmp/grey_state_digest_<YYYY-MM-DD>.md` wg formatu:

   ```markdown
   # Grey State — Cotygodniowy digest (YYYY-MM-DD)

   ## TL;DR
   [Najpierw wzmianki o dacie bety/premiery, jeśli są w nowych wpisach.
   Jeśli total_new == 0: "Brak nowych informacji w tym tygodniu."]

   ## Steam News
   - [tytuł](link) — data
   (albo: "Steam feed niedostępny w tym uruchomieniu: <błąd>" jeśli status == "error")

   ## YouTube
   - [tytuł](link) — data
   (albo informacja o błędzie analogicznie)

   ---
   Źródła: Steam News RSS, YouTube RSS (@Play_ROE).
   ```

   Jeśli `is_first_run` jest `true`, dodaj na początku digestu adnotację, że to pierwszy
   przebieg (baseline) i pokazane wpisy to bieżący stan feedów, a nie "nowości" w ścisłym sensie.

4. Wyślij plik `.tmp/grey_state_digest_<YYYY-MM-DD>.md` do użytkownika (mechanizm przesyłania
   pliku do sesji użytkownika).
5. Zostaw krótkie podsumowanie na czacie (1-2 zdania: czy było coś nowego, i czy dotyczyło bety/premiery).

## Obsługa przypadków brzegowych
- **Feed niedostępny** (`status == "error"`) — nie przerywaj całego runu; zaznacz to wyraźnie w
  sekcji danego źródła w digeście i kontynuuj z drugim źródłem.
- **Brak nowych wpisów w obu źródłach** — nadal wygeneruj i wyślij digest, z jasnym komunikatem
  "Brak nowych informacji w tym tygodniu" w TL;DR.
- **Wpis bez tytułu/daty** — tool już pomija takie wpisy przy parsowaniu; nie powinno się zdarzyć
  po stronie workflow.
- **Pierwsze uruchomienie** (brak `state.json` przed startem, `is_first_run == true`) — potraktuj
  wszystkie wpisy jako baseline informacyjny, nie jako "newsy tygodnia".

## Notatki / rzeczy do zaktualizowania w przyszłości
- Gra nie ma jeszcze potwierdzonej daty bety ani premiery (stan na wrzesień 2026). Gdy się pojawi,
  ten workflow powinien to wychwycić automatycznie przez Steam News.
- Jeśli w przyszłości trzeba dodać Discord/X, opisać tu nowy krok i zaktualizować tool.
