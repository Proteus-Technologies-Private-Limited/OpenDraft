# Translation glossary and style guide

For everyone translating `frontend/src/locales/en/*.json` (people, or an AI
asked to). Read `docs/i18n.md` first for the file format.

## How to translate

* **Translate the meaning for a screenwriter**, not the words. Use the term
  working writers in that language use (table below). When the English is a
  button, keep the translation a button: short, imperative or noun, never a
  sentence.
* **Length.** Translations run 20–50 % longer than English (German is not here,
  Russian and Turkish are). Prefer the shorter correct word; menus and toolbar
  buttons have no room. Never abbreviate to fit unless the language does.
* **Keep exactly:** every `{{placeholder}}` (same name, any position), every
  `<tag>…</tag>` and `<0>…</0>` (same tags; the text between them is
  translated), `…`, keyboard shortcuts, file extensions, product names
  (OpenDraft, Final Draft, Fountain, Fade In, Highland, Celtx, WriterDuet,
  Google, Apple …), font names, and the screenplay vocabulary listed below.
* **Plurals.** Provide every form the language needs: `_one` `_other` for English;
  Spanish/French/Portuguese also `_many` (used only for exact millions — give
  the "de" form: *1 000 000 de escenas*); Russian `_one` `_few` `_many` `_other`;
  Arabic `_zero` `_one` `_two` `_few` `_many` `_other`; Persian and Turkish
  `_one` `_other`. The tests fail if one is missing.
* **Two meanings, two words.** If the same English word is used as a verb and a
  noun in different keys ("Open" the action / "Open" the state), translate each
  for its use.
* **Address.** One register throughout: Spanish *tú*, French *vous*, Portuguese
  *você*, Russian *вы*, Turkish *siz*, Arabic Modern Standard, Persian polite
  standard written (*شما*, not colloquial).
* **Do not translate** error text that is only a code or a technical token.
* **Never leave English** in a value except the names above. The tests catch it.

## Never translated (screenplay vocabulary)

`INT.` `EXT.` `INT./EXT.` `CONT'D` `(MORE)` `V.O.` `O.S.` `O.C.` `FADE IN:`
`FADE OUT.` `CUT TO:` `DISSOLVE TO:` and every other transition keyword — they
are part of the format, are read by other software, and stay as they are in
every interface language and every export. When the UI *talks about* them ("the
MORE and CONT'D labels"), keep the token itself in Latin letters.

## Per-language typography

| Language | Rules |
|---|---|
| Spanish (`es`, neutral Latin-American) | Opening `¿` `¡` as well as closing. Quotes « » or “ ”. No *vosotros*, no regionalisms (*ordenador* → *computadora* is NOT used; prefer *equipo*/*dispositivo* where it can be avoided). |
| French (`fr`) | A **no-break space (U+00A0)** before `:` `;` `!` `?` and inside « ». `œ`, accents on capitals (`À`, `É`). |
| Portuguese (`pt`, Brazil) | Brazilian spelling (*arquivo*, *tela*, *salvar*, *você*). |
| Russian (`ru`) | « » quotes; `ё` may be written `е`. Mind case endings after a placeholder: prefer wording that does not decline it ("Файл: {{name}}" not "Файла {{name}}"). |
| Turkish (`tr`) | Dotted/dotless `İ i` / `I ı` — never `I` for a capital dotted i. Suffixes after a placeholder or a proper name are hard: reword so none is needed ("Dosya: {{name}}"). |
| Arabic (`ar`) | Modern Standard. Arabic punctuation `،` `؛` `؟`. Arabic letters `ي` (U+064A) and `ك` (U+0643) — **not** the Persian `ی` `ک`. Western digits (0-9) as in the rest of the app. Keep Latin words (OpenDraft, PDF) as they are; the display handles mixing. |
| Persian (`fa`) | Persian letters `ی` (U+06CC) and `ک` (U+06A9) — **never** Arabic `ي` `ك`. Half-space (ZWNJ, U+200C) in compounds (*می‌شود*, *پیش‌نویس*). Persian punctuation `،` `؛` `؟`. Western digits (0-9). |

## Terms

Screenplay element names shown in menus/toolbar (stored names never change).
`—` means "keep the English term; it is what writers in that language say".

| English | es | fr | pt-BR | ru | tr | ar | fa |
|---|---|---|---|---|---|---|---|
| Scene Heading | Encabezado de escena | Intitulé de scène | Cabeçalho de cena | Заголовок сцены | Sahne başlığı | عنوان المشهد | عنوان سکانس |
| Action | Acción | Action | Ação | Действие | Aksiyon | الحدث | توصیف |
| Character | Personaje | Personnage | Personagem | Персонаж | Karakter | الشخصية | شخصیت |
| Dialogue | Diálogo | Dialogue | Diálogo | Диалог | Diyalog | الحوار | دیالوگ |
| Parenthetical | Acotación | Parenthèse | Parentético | Ремарка | Parantez | توجيه الأداء | راهنمای بازی |
| Transition | Transición | Transition | Transição | Переход | Geçiş | انتقال | گذار |
| Shot | Plano | Plan | Plano | Кадр | Çekim | لقطة | نما |
| Lyrics | Letra | Paroles | Letra | Текст песни | Şarkı sözü | كلمات الأغنية | متن ترانه |
| New Act / End of Act | Nuevo acto / Fin del acto | Nouvel acte / Fin d'acte | Novo ato / Fim do ato | Новый акт / Конец акта | Yeni perde / Perde sonu | فصل جديد / نهاية الفصل | پرده جدید / پایان پرده |
| Cast List | Reparto | Distribution | Elenco | Список ролей | Oyuncu listesi | قائمة الممثلين | فهرست بازیگران |
| Dual Dialogue | Diálogo simultáneo | Dialogue simultané | Diálogo simultâneo | Параллельный диалог | Çift diyalog | حوار متزامن | دیالوگ همزمان |
| Script / Screenplay | Guion | Scénario | Roteiro | Сценарий | Senaryo | السيناريو | فیلمنامه |
| Title Page | Portada | Page de titre | Página de rosto | Титульная страница | Kapak sayfası | صفحة العنوان | صفحهٔ عنوان |
| Scene | Escena | Scène | Cena | Сцена | Sahne | مشهد | سکانس |
| Act | Acto | Acte | Ato | Акт | Perde | فصل | پرده |
| Beat / Beat Board | Beat / Tablero de beats | Beat / Tableau de beats | Beat / Quadro de beats | Бит / Доска битов | Beat / Beat panosu | نقطة درامية / لوحة النقاط | بیت / تخته بیت‌ها |
| Index Cards | Fichas | Fiches | Fichas | Карточки | Fişler | البطاقات | کارت‌ها |
| Outline | Esquema | Séquencier | Escaleta | План | Ana hat | المخطط | طرح کلی |
| Treatment | Tratamiento | Traitement | Tratamento | Тритмент | Tretman | المعالجة | تریتمنت |
| Synopsis | Sinopsis | Synopsis | Sinopse | Синопсис | Sinopsis | الملخّص | خلاصه داستان |
| Logline | Logline | Logline | Logline | Логлайн | Logline | جملة الفكرة | لاگ‌لاین |
| Draft | Borrador | Version | Rascunho | Черновик | Taslak | مسودة | پیش‌نویس |
| Revision | Revisión | Révision | Revisão | Редакция | Revizyon | مراجعة | بازنگری |
| Locked pages | Páginas bloqueadas | Pages verrouillées | Páginas travadas | Зафиксированные страницы | Kilitli sayfalar | الصفحات المقفلة | صفحه‌های قفل‌شده |
| Character Profile | Ficha de personaje | Fiche personnage | Ficha do personagem | Досье персонажа | Karakter profili | ملف الشخصية | پروفایل شخصیت |
| Location | Localización | Décor / Lieu | Locação | Локация | Mekân | الموقع | لوکیشن |
| Table Read | Lectura de mesa | Lecture à la table | Leitura de mesa | Читка | Masa okuması | قراءة جماعية | خوانش دورمیزی |
| Sides | — (escenas del día) | Sides | Sides | Сайды | Sides | — | — |
| Production / Shooting script | Producción / Guion de rodaje | Production / Scénario de tournage | Produção / Roteiro de filmagem | Производство / Режиссёрский сценарий | Yapım / Çekim senaryosu | الإنتاج / سيناريو التصوير | تولید / فیلمنامه فنی |
| Project | Proyecto | Projet | Projeto | Проект | Proje | مشروع | پروژه |
| Template / Format | Plantilla / Formato | Modèle / Format | Modelo / Formato | Шаблон / Формат | Şablon / Biçim | قالب / تنسيق | قالب / قالب‌بندی |
| Note / Comment | Nota / Comentario | Note / Commentaire | Nota / Comentário | Заметка / Комментарий | Not / Yorum | ملاحظة / تعليق | یادداشت / نظر |
| Suggestion | Sugerencia | Suggestion | Sugestão | Предложение | Öneri | اقتراح | پیشنهاد |
| Collaboration | Colaboración | Collaboration | Colaboração | Совместная работа | İşbirliği | التعاون | همکاری |
| Version History | Historial de versiones | Historique des versions | Histórico de versões | История версий | Sürüm geçmişi | سجل الإصدارات | تاریخچهٔ نسخه‌ها |
| Backup / Recovery | Copia de seguridad / Recuperación | Sauvegarde / Récupération | Backup / Recuperação | Резервная копия / Восстановление | Yedek / Kurtarma | نسخة احتياطية / استعادة | نسخهٔ پشتیبان / بازیابی |
| Spell check / Grammar | Ortografía / Gramática | Orthographe / Grammaire | Ortografia / Gramática | Орфография / Грамматика | Yazım denetimi / Dil bilgisi | التدقيق الإملائي / القواعد | املا / دستور زبان |
| Header / Footer | Encabezado / Pie de página | En-tête / Pied de page | Cabeçalho / Rodapé | Верхний / нижний колонтитул | Üst bilgi / Alt bilgi | رأس / تذييل الصفحة | سرصفحه / پاصفحه |
| Settings / Preferences | Ajustes | Réglages | Configurações | Настройки | Ayarlar | الإعدادات | تنظیمات |
