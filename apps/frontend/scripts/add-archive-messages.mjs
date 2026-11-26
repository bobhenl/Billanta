// Adds the document archive strings (Settings → Zálohy and the quarterly
// reminder) to every messages/*.json that exists. Safe to re-run, e.g. after
// more locale files are added: it only sets these keys.
//   node apps/frontend/scripts/add-archive-messages.mjs
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'messages');

const T = {
  cs: {
    archive: {
      title: 'Archiv dokladů',
      description: 'Všechny vydané faktury a dobropisy jako PDF a ISDOC, přílohy, přijaté e-faktury a seznam nákladů v jednom ZIPu, srovnané podle roků.',
      empty: 'Zatím tu nejsou žádné vystavené doklady ani náklady.',
      yearLabel: 'Rok',
      allYears: 'Všechny roky',
      download: 'Stáhnout archiv',
      contents: 'Doklady musíte uchovávat 10 let. Archiv si stáhněte aspoň jednou za čtvrtletí, nebo zapněte automatickou zálohu na vlastní SFTP či Google Disk.',
      badge: 'Archiv dokladů',
      turnOn: 'Zapnout archiv',
      turnOff: 'Vypnout archiv',
      toggleHint: 'Kromě datové zálohy nahrává i čitelné PDF a ISDOC do složky Billanta/{year}/. Nahrávají se jen nové a změněné doklady.'
    },
    event: { label: 'Připomenutí archivu', hint: 'Jednou za čtvrtletí připomene majiteli stažení archivu dokladů, pokud nemá automatickou zálohu.' },
    unsubscribe: 'připomenutí ke stažení archivu dokladů'
  },
  sk: {
    archive: {
      title: 'Archív dokladov',
      description: 'Všetky vydané faktúry a dobropisy ako PDF a ISDOC, prílohy, prijaté e-faktúry a zoznam nákladov v jednom ZIPe, zoradené podľa rokov.',
      empty: 'Zatiaľ tu nie sú žiadne vystavené doklady ani náklady.',
      yearLabel: 'Rok',
      allYears: 'Všetky roky',
      download: 'Stiahnuť archív',
      contents: 'Doklady musíte uchovávať 10 rokov. Archív si stiahnite aspoň raz za štvrťrok alebo zapnite automatickú zálohu na vlastné SFTP či Google Disk.',
      badge: 'Archív dokladov',
      turnOn: 'Zapnúť archív',
      turnOff: 'Vypnúť archív',
      toggleHint: 'Okrem dátovej zálohy nahráva aj čitateľné PDF a ISDOC do priečinka Billanta/{year}/. Nahrávajú sa len nové a zmenené doklady.'
    },
    event: { label: 'Pripomienka archívu', hint: 'Raz za štvrťrok pripomenie majiteľovi stiahnutie archívu dokladov, ak nemá automatickú zálohu.' },
    unsubscribe: 'pripomienky na stiahnutie archívu dokladov'
  },
  en: {
    archive: {
      title: 'Document archive',
      description: 'All issued invoices and credit notes as PDF and ISDOC, attachments, received e-invoices and the expense list in one ZIP, sorted by year.',
      empty: 'There are no issued documents or expenses yet.',
      yearLabel: 'Year',
      allYears: 'All years',
      download: 'Download archive',
      contents: 'Documents have to be kept for 10 years. Download the archive at least once a quarter, or turn on an automatic backup to your own SFTP or Google Drive.',
      badge: 'Document archive',
      turnOn: 'Turn archive on',
      turnOff: 'Turn archive off',
      toggleHint: 'Besides the data backup, also uploads readable PDF and ISDOC files to the Billanta/{year}/ folder. Only new and changed documents are uploaded.'
    },
    event: { label: 'Archive reminder', hint: 'Once a quarter, reminds the owner to download the document archive when there is no automatic backup.' },
    unsubscribe: 'reminders to download the document archive'
  },
  de: {
    archive: {
      title: 'Belegarchiv',
      description: 'Alle ausgestellten Rechnungen und Gutschriften als PDF und ISDOC, Anhänge, empfangene E-Rechnungen und die Ausgabenliste in einer ZIP-Datei, nach Jahren sortiert.',
      empty: 'Noch keine ausgestellten Belege oder Ausgaben.',
      yearLabel: 'Jahr',
      allYears: 'Alle Jahre',
      download: 'Archiv herunterladen',
      contents: 'Belege müssen 10 Jahre aufbewahrt werden. Laden Sie das Archiv mindestens einmal im Quartal herunter oder aktivieren Sie eine automatische Sicherung auf Ihren eigenen SFTP-Server oder Google Drive.',
      badge: 'Belegarchiv',
      turnOn: 'Archiv einschalten',
      turnOff: 'Archiv ausschalten',
      toggleHint: 'Lädt neben der Datensicherung auch lesbare PDF- und ISDOC-Dateien in den Ordner Billanta/{year}/ hoch. Nur neue und geänderte Belege werden hochgeladen.'
    },
    event: { label: 'Archiv-Erinnerung', hint: 'Erinnert den Inhaber einmal im Quartal daran, das Belegarchiv herunterzuladen, wenn keine automatische Sicherung eingerichtet ist.' },
    unsubscribe: 'Erinnerungen zum Herunterladen des Belegarchivs'
  },
  es: {
    archive: {
      title: 'Archivo de documentos',
      description: 'Todas las facturas y notas de crédito emitidas en PDF e ISDOC, los adjuntos, las facturas electrónicas recibidas y la lista de gastos en un solo ZIP, ordenados por año.',
      empty: 'Todavía no hay documentos emitidos ni gastos.',
      yearLabel: 'Año',
      allYears: 'Todos los años',
      download: 'Descargar archivo',
      contents: 'Los documentos deben conservarse 10 años. Descarga el archivo al menos una vez por trimestre o activa una copia automática en tu propio SFTP o Google Drive.',
      badge: 'Archivo de documentos',
      turnOn: 'Activar archivo',
      turnOff: 'Desactivar archivo',
      toggleHint: 'Además de la copia de datos, sube archivos PDF e ISDOC legibles a la carpeta Billanta/{year}/. Solo se suben los documentos nuevos o modificados.'
    },
    event: { label: 'Recordatorio del archivo', hint: 'Una vez por trimestre recuerda al propietario que descargue el archivo de documentos si no hay copia automática.' },
    unsubscribe: 'recordatorios para descargar el archivo de documentos'
  },
  fr: {
    archive: {
      title: 'Archive des documents',
      description: "Toutes les factures et tous les avoirs émis en PDF et ISDOC, les pièces jointes, les factures électroniques reçues et la liste des dépenses dans un seul ZIP, classés par année.",
      empty: "Il n'y a encore aucun document émis ni aucune dépense.",
      yearLabel: 'Année',
      allYears: 'Toutes les années',
      download: "Télécharger l'archive",
      contents: "Les documents doivent être conservés 10 ans. Téléchargez l'archive au moins une fois par trimestre, ou activez une sauvegarde automatique vers votre propre SFTP ou Google Drive.",
      badge: 'Archive des documents',
      turnOn: "Activer l'archive",
      turnOff: "Désactiver l'archive",
      toggleHint: 'En plus de la sauvegarde des données, envoie des fichiers PDF et ISDOC lisibles dans le dossier Billanta/{year}/. Seuls les documents nouveaux ou modifiés sont envoyés.'
    },
    event: { label: "Rappel d'archive", hint: "Une fois par trimestre, rappelle au propriétaire de télécharger l'archive des documents s'il n'a pas de sauvegarde automatique." },
    unsubscribe: "rappels pour télécharger l'archive des documents"
  },
  hu: {
    archive: {
      title: 'Bizonylatarchívum',
      description: 'Az összes kiállított számla és jóváírás PDF és ISDOC formátumban, a mellékletek, a beérkezett e-számlák és a költséglista egy ZIP-fájlban, évek szerint rendezve.',
      empty: 'Még nincs kiállított bizonylat vagy költség.',
      yearLabel: 'Év',
      allYears: 'Minden év',
      download: 'Archívum letöltése',
      contents: 'A bizonylatokat 10 évig meg kell őrizni. Töltse le az archívumot legalább negyedévente egyszer, vagy kapcsoljon be automatikus mentést a saját SFTP-szerverére vagy Google Drive-jára.',
      badge: 'Bizonylatarchívum',
      turnOn: 'Archívum bekapcsolása',
      turnOff: 'Archívum kikapcsolása',
      toggleHint: 'Az adatmentés mellett olvasható PDF- és ISDOC-fájlokat is feltölt a Billanta/{year}/ mappába. Csak az új és a módosított bizonylatok kerülnek feltöltésre.'
    },
    event: { label: 'Archívum emlékeztető', hint: 'Negyedévente egyszer emlékezteti a tulajdonost a bizonylatarchívum letöltésére, ha nincs automatikus mentés.' },
    unsubscribe: 'emlékeztetők a bizonylatarchívum letöltésére'
  },
  it: {
    archive: {
      title: 'Archivio documenti',
      description: 'Tutte le fatture e le note di credito emesse in PDF e ISDOC, gli allegati, le fatture elettroniche ricevute e l’elenco delle spese in un unico ZIP, ordinati per anno.',
      empty: 'Non ci sono ancora documenti emessi né spese.',
      yearLabel: 'Anno',
      allYears: 'Tutti gli anni',
      download: 'Scarica archivio',
      contents: 'I documenti vanno conservati per 10 anni. Scarica l’archivio almeno una volta a trimestre oppure attiva un backup automatico sul tuo SFTP o Google Drive.',
      badge: 'Archivio documenti',
      turnOn: 'Attiva archivio',
      turnOff: 'Disattiva archivio',
      toggleHint: 'Oltre al backup dei dati, carica anche file PDF e ISDOC leggibili nella cartella Billanta/{year}/. Vengono caricati solo i documenti nuovi o modificati.'
    },
    event: { label: 'Promemoria archivio', hint: 'Una volta a trimestre ricorda al titolare di scaricare l’archivio documenti se non c’è un backup automatico.' },
    unsubscribe: 'promemoria per scaricare l’archivio documenti'
  },
  nl: {
    archive: {
      title: 'Documentarchief',
      description: 'Alle uitgegeven facturen en creditnota’s als PDF en ISDOC, bijlagen, ontvangen e-facturen en de kostenlijst in één ZIP, gesorteerd per jaar.',
      empty: 'Er zijn nog geen uitgegeven documenten of kosten.',
      yearLabel: 'Jaar',
      allYears: 'Alle jaren',
      download: 'Archief downloaden',
      contents: 'Documenten moet u 10 jaar bewaren. Download het archief minstens één keer per kwartaal, of zet een automatische back-up naar uw eigen SFTP of Google Drive aan.',
      badge: 'Documentarchief',
      turnOn: 'Archief aanzetten',
      turnOff: 'Archief uitzetten',
      toggleHint: 'Uploadt naast de databack-up ook leesbare PDF- en ISDOC-bestanden naar de map Billanta/{year}/. Alleen nieuwe en gewijzigde documenten worden geüpload.'
    },
    event: { label: 'Archiefherinnering', hint: 'Herinnert de eigenaar één keer per kwartaal eraan het documentarchief te downloaden als er geen automatische back-up is.' },
    unsubscribe: 'herinneringen om het documentarchief te downloaden'
  },
  pl: {
    archive: {
      title: 'Archiwum dokumentów',
      description: 'Wszystkie wystawione faktury i korekty w PDF i ISDOC, załączniki, otrzymane e-faktury i lista kosztów w jednym pliku ZIP, posortowane według lat.',
      empty: 'Nie ma jeszcze wystawionych dokumentów ani kosztów.',
      yearLabel: 'Rok',
      allYears: 'Wszystkie lata',
      download: 'Pobierz archiwum',
      contents: 'Dokumenty trzeba przechowywać 10 lat. Pobieraj archiwum przynajmniej raz na kwartał albo włącz automatyczną kopię na własny serwer SFTP lub Dysk Google.',
      badge: 'Archiwum dokumentów',
      turnOn: 'Włącz archiwum',
      turnOff: 'Wyłącz archiwum',
      toggleHint: 'Oprócz kopii danych wysyła też czytelne pliki PDF i ISDOC do folderu Billanta/{year}/. Wysyłane są tylko nowe i zmienione dokumenty.'
    },
    event: { label: 'Przypomnienie o archiwum', hint: 'Raz na kwartał przypomina właścicielowi o pobraniu archiwum dokumentów, jeśli nie ma automatycznej kopii.' },
    unsubscribe: 'przypomnienia o pobraniu archiwum dokumentów'
  },
  pt: {
    archive: {
      title: 'Arquivo de documentos',
      description: 'Todas as faturas e notas de crédito emitidas em PDF e ISDOC, anexos, faturas eletrónicas recebidas e a lista de despesas num único ZIP, organizados por ano.',
      empty: 'Ainda não há documentos emitidos nem despesas.',
      yearLabel: 'Ano',
      allYears: 'Todos os anos',
      download: 'Transferir arquivo',
      contents: 'Os documentos têm de ser guardados durante 10 anos. Transfira o arquivo pelo menos uma vez por trimestre ou ative uma cópia automática para o seu próprio SFTP ou Google Drive.',
      badge: 'Arquivo de documentos',
      turnOn: 'Ativar arquivo',
      turnOff: 'Desativar arquivo',
      toggleHint: 'Além da cópia de dados, envia também ficheiros PDF e ISDOC legíveis para a pasta Billanta/{year}/. Só são enviados documentos novos ou alterados.'
    },
    event: { label: 'Lembrete do arquivo', hint: 'Uma vez por trimestre lembra o proprietário de transferir o arquivo de documentos se não houver cópia automática.' },
    unsubscribe: 'lembretes para transferir o arquivo de documentos'
  },
  ro: {
    archive: {
      title: 'Arhiva documentelor',
      description: 'Toate facturile și notele de credit emise în PDF și ISDOC, atașamentele, facturile electronice primite și lista cheltuielilor într-un singur ZIP, ordonate pe ani.',
      empty: 'Încă nu există documente emise sau cheltuieli.',
      yearLabel: 'An',
      allYears: 'Toți anii',
      download: 'Descarcă arhiva',
      contents: 'Documentele trebuie păstrate 10 ani. Descărcați arhiva cel puțin o dată pe trimestru sau activați o copie automată pe propriul SFTP sau Google Drive.',
      badge: 'Arhiva documentelor',
      turnOn: 'Activează arhiva',
      turnOff: 'Dezactivează arhiva',
      toggleHint: 'Pe lângă copia datelor, încarcă și fișiere PDF și ISDOC lizibile în dosarul Billanta/{year}/. Se încarcă doar documentele noi și cele modificate.'
    },
    event: { label: 'Memento arhivă', hint: 'O dată pe trimestru îi amintește proprietarului să descarce arhiva documentelor dacă nu există o copie automată.' },
    unsubscribe: 'mementouri pentru descărcarea arhivei documentelor'
  },
  uk: {
    archive: {
      title: 'Архів документів',
      description: 'Усі виставлені рахунки та кредитні ноти у PDF та ISDOC, вкладення, отримані електронні рахунки та список витрат в одному ZIP, упорядковані за роками.',
      empty: 'Поки що немає виставлених документів чи витрат.',
      yearLabel: 'Рік',
      allYears: 'Усі роки',
      download: 'Завантажити архів',
      contents: 'Документи потрібно зберігати 10 років. Завантажуйте архів щонайменше раз на квартал або увімкніть автоматичне резервне копіювання на власний SFTP чи Google Диск.',
      badge: 'Архів документів',
      turnOn: 'Увімкнути архів',
      turnOff: 'Вимкнути архів',
      toggleHint: 'Окрім резервної копії даних, завантажує також читабельні файли PDF та ISDOC до папки Billanta/{year}/. Завантажуються лише нові та змінені документи.'
    },
    event: { label: 'Нагадування про архів', hint: 'Раз на квартал нагадує власнику завантажити архів документів, якщо немає автоматичного резервного копіювання.' },
    unsubscribe: 'нагадування про завантаження архіву документів'
  }
};

for (const [locale, m] of Object.entries(T)) {
  const file = join(dir, `${locale}.json`);
  if (!existsSync(file)) continue;
  const raw = readFileSync(file, 'utf8');
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const d = JSON.parse(raw);
  d.settings.backup.archive = m.archive;
  d.settings.notifications.events.archive_reminder = m.event;
  d.unsubscribe.types.archive_reminder = m.unsubscribe;
  writeFileSync(file, (JSON.stringify(d, null, 2) + '\n').replace(/\n/g, eol));
  console.log(`${locale}: ok`);
}
