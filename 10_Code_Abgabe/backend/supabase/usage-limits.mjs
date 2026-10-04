// Nutzungskontingente pro Tarif. Zum Anpassen einfach die Zahlen ändern.
//
// - `free` gilt für alle ohne aktives Abo, `pro` für den Abo-Status active oder trialing.
// - `...PerMonth` zählt pro Kalendermonat (Europe/Berlin) und beginnt am 1. um 00:00 neu.
// - 0 sperrt die Funktion für den Tarif komplett.
// - Wirksam wird eine Änderung mit dem nächsten Deploy (Staging/Produktion) bzw. lokal mit
//   `npm run db:workers`. Bis dahin gelten die zuletzt eingespielten Werte.
// - Durchgesetzt wird serverseitig in der Datenbank. Das Frontend kann nichts davon umgehen.
//
// Unabhängig davon bleiben die bestehenden Kurzzeitgrenzen aktiv, z. B. Chatfragen pro
// Minute (AI_QUESTIONS_PER_MINUTE) und Zusammenfassungen pro Stunde.
export default {
  free: {
    // Neue KI-Chat-Ausführungen (gespeicherte Replays kosten nichts), inklusive der
    // KI-Aktionen direkt am Dokument, soweit sie über den Chat laufen.
    // Quizgenerierungen zählen separat.
    chatMessagesPerMonth: 100,
    // Direkte Dokumentsuche (Endpoint documents-search).
    searchesPerMonth: 200,
    searchesPerMinute: 10,
    // Gespeicherte Zusammenfassungen (Dokument oder Kurs). Ein erneuter Versuch desselben
    // Auftrags zählt nicht extra.
    summariesPerMonth: 10,
    // Karteikarten-Generierungen für einen Kurs.
    flashcardGenerationsPerMonth: 5,
    quizGenerationsPerMonth: 5,
    // Materialanalysen (Termine und Prüfungen aus Unterlagen erkennen).
    materialAnalysesPerMonth: 10,
    // Hochgeladene Dateien. Löschen gibt das Kontingent nicht zurück, sonst ließe sich die
    // kostenpflichtige Verarbeitung beliebig oft wiederholen.
    uploadsPerMonth: 20,
    // Gesamtspeicher aller eigenen Dateien. Löschen gibt Speicher sofort wieder frei.
    storageMegabytes: 250,
  },
  pro: {
    chatMessagesPerMonth: 1500,
    searchesPerMonth: 3000,
    searchesPerMinute: 30,
    summariesPerMonth: 100,
    flashcardGenerationsPerMonth: 50,
    quizGenerationsPerMonth: 50,
    materialAnalysesPerMonth: 100,
    uploadsPerMonth: 300,
    storageMegabytes: 5000,
  },
};
