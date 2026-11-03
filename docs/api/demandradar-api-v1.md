# DemandRadar API v1 — specificatie

Versie 1 · november 2026

## 1. Inleiding

Met de DemandRadar API haalt een revenue management systeem de events van een DemandRadar-klant automatisch op, in plaats van via de Excel-export.

- Eén klant is één DemandRadar-account. Een API-sleutel hoort bij precies één account en geeft alleen toegang tot de hotels en events van dat account.
- Het niveau, de score en de afstand worden per hotel bepaald. Daarom vraag je events altijd voor één hotel tegelijk op.
- De API is alleen-lezen.

## 2. Basis-URL

```
https://app.demandradar.nl/api/v1
```

- Alleen HTTPS.
- Alle antwoorden zijn JSON in UTF-8.
- Antwoorden worden niet gecachet (`Cache-Control: no-store`).

## 3. Authenticatie

Stuur bij elk verzoek de API-sleutel mee in de `Authorization`-header:

```
Authorization: Bearer dr_live_…
```

- De klant maakt de sleutel zelf aan in DemandRadar onder **Account → API-koppelingen**. De sleutel is daar één keer zichtbaar; daarna toont DemandRadar alleen het begin ervan.
- De klant kan een sleutel daar ook intrekken. Een ingetrokken, onbekende of ontbrekende sleutel geeft `401 unauthorized`.
- Is het abonnement van de klant opgezegd of de proefperiode verlopen, dan geeft elk verzoek `403 account_inactive`.
- Een sleutel heeft de vorm `dr_live_` gevolgd door 43 tekens (`A–Z`, `a–z`, `0–9`, `-`, `_`). Bewaar hem als een wachtwoord.

## 4. GET /hotels

Geeft de hotels van het account. Gebruik het `id` van een hotel als `hotel_id` bij `GET /events`.

### Verzoek

```bash
curl -s https://app.demandradar.nl/api/v1/hotels \
  -H "Authorization: Bearer dr_live_…"
```

### Antwoord `200`

```json
{
  "hotels": [
    {
      "id": "4b8f4557-c84b-4516-8cf6-0aa0838e71fc",
      "name": "Hotel Hegra Amsterdam",
      "address": "Herengracht 269, 1016BJ Amsterdam",
      "hotel_code": "HEGRA"
    },
    {
      "id": "c22bedf2-178a-4932-9874-6c4d2913722e",
      "name": "Hotel The Match",
      "address": "Kleine Berg 43, 5611JS Eindhoven",
      "hotel_code": "MATCH"
    }
  ]
}
```

### Velden

| Veld | Type | Betekenis |
| --- | --- | --- |
| `id` | string (UUID) | Vaste DemandRadar-ID van het hotel. |
| `name` | string | Naam van het hotel. |
| `address` | string of `null` | Adres zoals de klant het heeft ingevoerd. |
| `hotel_code` | string of `null` | De RevControl-hotelcode die de klant in DemandRadar heeft ingevuld; `null` als die ontbreekt. |

Hotels die de klant heeft gearchiveerd staan niet in de lijst. Sortering: op naam.

## 5. GET /events

Geeft de events van één hotel in een periode.

### Parameters

| Parameter | Verplicht | Formaat | Betekenis |
| --- | --- | --- | --- |
| `hotel_id` | Nee, als het account precies één hotel heeft; anders ja | UUID uit `GET /hotels` | Het hotel waarvoor de events worden berekend. |
| `from` | Ja | `JJJJ-MM-DD` | Eerste dag van de periode. |
| `to` | Ja | `JJJJ-MM-DD` | Laatste dag van de periode (inbegrepen). Maximaal 3 jaar na `from`. |
| `min_level` | Nee | `Low`, `Medium`, `High` of `Peak` | Alleen events op dit niveau of hoger. Met `min_level` kun je verder filteren binnen de selectie van de klant (zie hoofdstuk 6). Zonder deze parameter komt de hele selectie mee. Hoofdletters maken niet uit. |

### Verzoek

```bash
curl -s "https://app.demandradar.nl/api/v1/events?hotel_id=c22bedf2-178a-4932-9874-6c4d2913722e&from=2026-11-03&to=2028-11-03" \
  -H "Authorization: Bearer dr_live_…"
```

### Antwoord `200`

Voorbeeldantwoord met drie events, opgehaald op 3 november 2026.

```json
{
  "hotel_id": "c22bedf2-178a-4932-9874-6c4d2913722e",
  "from": "2026-11-03",
  "to": "2028-11-03",
  "available_until": "2027-12-31",
  "events": [
    {
      "id": "2146935d-e247-41df-9b8c-ad7c2086fe26",
      "title": "GLOW Festival Eindhoven - CONNECT",
      "start_date": "2026-11-07",
      "end_date": "2026-11-14",
      "category": "festival",
      "venue": "Eindhoven city centre",
      "city": "Eindhoven",
      "latitude": 51.45016172,
      "longitude": 5.45853544,
      "distance_km": 1.9,
      "level": "High",
      "score": 75,
      "source_url": "https://gloweindhoven.nl/praktisch/",
      "hotel_code": "MATCH",
      "updated_at": "2026-11-03T05:58:51.882Z"
    },
    {
      "id": "61b5d259-5844-451b-860d-1c4cb20176bb",
      "title": "PSV - Atleti (Champions League)",
      "start_date": "2026-12-09",
      "end_date": "2026-12-09",
      "category": "sports",
      "venue": "Philips Stadion",
      "city": null,
      "latitude": 51.4417,
      "longitude": 5.4675,
      "distance_km": 0.8,
      "level": "Peak",
      "score": 93,
      "source_url": "https://www.psv.nl",
      "hotel_code": "MATCH",
      "updated_at": "2026-11-03T05:00:58.108Z"
    },
    {
      "id": "31612a83-483f-41fa-b2a9-ff623d656d81",
      "title": "Matsuru Dutch Open Espoir 2027",
      "start_date": "2027-01-09",
      "end_date": "2027-01-10",
      "category": "judo",
      "venue": "Indoor Sport Centrum Eindhoven",
      "city": "Eindhoven",
      "latitude": 51.45016172,
      "longitude": 5.45853544,
      "distance_km": 1.9,
      "level": "Medium",
      "score": 69,
      "source_url": "https://jbn.nl/matsuru-dutch-open-espoirtoernooi",
      "hotel_code": "MATCH",
      "updated_at": "2026-11-03T05:59:02.816Z"
    }
  ]
}
```

### Velden op het hoogste niveau

| Veld | Type | Betekenis |
| --- | --- | --- |
| `hotel_id` | string (UUID) | Het hotel waarvoor de lijst geldt. |
| `from`, `to` | string `JJJJ-MM-DD` | De gevraagde periode, zoals meegestuurd. |
| `available_until` | string `JJJJ-MM-DD` | De laatste datum waarvoor DemandRadar zoekt. Nu is dat het einde van volgend jaar; die datum schuift op 1 januari een jaar op. Voor proefaccounts is dat 90 dagen vooruit. Na deze datum bevat de lijst geen events, ook niet als `to` later ligt. |
| `events` | array | De events, gesorteerd op `start_date` en daarna op titel. |

### Velden per event

| Veld | Type | Betekenis |
| --- | --- | --- |
| `id` | string (UUID) | Vaste DemandRadar-ID van het event. |
| `title` | string | Titel, inclusief eventuele aanpassing door de klant. |
| `start_date` | string `JJJJ-MM-DD` | Eerste dag, Nederlandse lokale datum. |
| `end_date` | string `JJJJ-MM-DD` | Laatste dag (inbegrepen), Nederlandse lokale datum. Bij een eendaags event gelijk aan `start_date`. |
| `category` | string | Soort event, vrije tekst (bijvoorbeeld `festival`, `sports`, `Design fair`). Geen vaste lijst. |
| `venue` | string of `null` | Locatie, inclusief eventuele aanpassing door de klant. |
| `city` | string of `null` | Plaats van het event, als die bekend is. |
| `latitude`, `longitude` | number of `null` | Coördinaten van de locatie. Is de precieze locatie niet bekend, dan is dit het centrum van de plaats. |
| `distance_km` | number of `null` | Afstand tot het hotel in kilometers, op 0,1 km afgerond. Gemeten vanaf `latitude`/`longitude`, dus bij benadering als dat het centrum van de plaats is. |
| `level` | string | Verwachte vraag voor dit hotel: `Low`, `Medium`, `High` of `Peak`. `Peak` is het hoogste niveau. `Low` komt alleen voor als de klant ervoor kiest ook Laag-events te sturen (zie hoofdstuk 6). |
| `score` | integer | Score van 0 tot 100 voor dit hotel. Hoger betekent meer verwachte vraag. Het niveau volgt niet rechtstreeks uit de score: een Medium-event kan een hogere score hebben dan een High-event. Gebruik `level` voor de indeling. |
| `source_url` | string of `null` | Openbare webpagina waar het event is bevestigd. |
| `hotel_code` | string of `null` | De RevControl-hotelcode van het hotel (gelijk aan `hotel_code` in `GET /hotels`). |
| `updated_at` | string (ISO 8601, UTC) | Laatste keer dat DemandRadar of de klant dit event heeft bijgewerkt. Dit verandert ook als DemandRadar het event alleen opnieuw heeft gecontroleerd. |

`venue`, `city`, `latitude`, `longitude`, `distance_km` en `source_url` kunnen `null` zijn, bijvoorbeeld bij feestdagen of als de bron die gegevens niet noemt.

## 6. Welke events staan in de lijst

Elk event heeft per hotel één niveau: het niveau dat de klant in de DemandRadar-kalender ziet. De klant kiest in DemandRadar zelf (onder *Exporteren*) vanaf welk niveau events naar RevControl gaan. Die keuze geldt voor de Excel-export en voor deze API:

| Keuze van de klant | Niveaus in de lijst |
| --- | --- |
| Medium, Hoog en Piek (standaard) | `Medium`, `High`, `Peak` |
| Alleen Hoog en Piek | `High`, `Peak` |
| Ook Laag | `Low`, `Medium`, `High`, `Peak` |

- **High en Peak**: events met aangetoonde grote hotelvraag. Ook als de klant het niveau zelf op High of Peak heeft gezet.
- **Medium**: events die waarschijnlijk extra hotelgasten trekken, maar waarvan de omvang nog niet bekend is.
- **Low**: de rest van de bevestigde events in de omgeving, zoals voorstellingen en exposities. Deze events worden standaard niet meegestuurd. De klant kan ervoor kiezen ze wel op te nemen.

## 7. Afspraken over de lijst

- **Volledige lijst.** Elk antwoord bevat alle events voor de gevraagde periode. Er is geen paginering en geen lijst met alleen wijzigingen. Events buiten de gevraagde periode, of na `available_until`, staan er niet in. Verwijder bij het verwerken dus alleen events die binnen de gevraagde periode vallen en niet na `available_until` beginnen.
- **Gedeeltelijke overlap.** Een event dat maar voor een deel in de periode valt, komt mee. Een event van 28 mei t/m 2 juni staat dus in de lijst voor `from=2027-06-01&to=2027-06-30`.
- **Datums.** Alle datums zijn Nederlandse lokale datums zonder tijd. `end_date` is de laatste dag van het event. Een event van 10 t/m 12 juni 2027 heeft `start_date` `2027-06-10` en `end_date` `2027-06-12`.
- **Verdwijnen.** Een event dat geannuleerd is, door de klant is uitgesloten, is samengevoegd met een ander event, of onder het niveau is gezakt dat de klant of `min_level` vraagt, staat de volgende keer niet meer in de lijst. Dat geldt ook als de klant zijn keuze verandert, bijvoorbeeld van Medium naar alleen Hoog en Piek. Er komt geen apart verwijderbericht.
- **Sortering.** Op `start_date`, daarna op `title`.

## 8. Foutafhandeling

Elke fout geeft een HTTP-foutstatus met een JSON-body in deze vorm:

```json
{
  "error": {
    "code": "unauthorized",
    "message": "Missing, invalid or revoked API key."
  }
}
```

| Status | `code` | Betekenis |
| --- | --- | --- |
| `400` | `invalid_request` | `from` of `to` ontbreekt of is geen geldige datum, `from` ligt na `to`, de periode is langer dan 3 jaar, of `min_level` is ongeldig. |
| `400` | `hotel_id_required` | Het account heeft meerdere hotels en `hotel_id` ontbreekt. |
| `401` | `unauthorized` | De API-sleutel ontbreekt, is ongeldig of is ingetrokken. |
| `403` | `account_inactive` | Het abonnement is opgezegd of de proefperiode is verlopen. |
| `404` | `hotel_not_found` | `hotel_id` hoort niet bij dit account, is gearchiveerd, of het account heeft geen hotels. |
| `500` | `server_error` | Er ging bij DemandRadar iets mis. Probeer het later opnieuw. |

**Een fout geeft nooit `200` met een lege lijst. Een `200` met een lege lijst betekent dat er in die periode echt geen events zijn.** Verwerk een lijst dus alleen als de status `200` is; laat bij elke andere status de bestaande events ongemoeid.

Gebruik `code` voor de foutafhandeling. De toelichting in `message` kan veranderen.

## 9. Ophaalfrequentie

Eén keer per dag per hotel ophalen is prima. DemandRadar zoekt elke ochtend vroeg naar nieuwe en gewijzigde events; ophalen vanaf 09:00 Nederlandse tijd geeft de meest actuele stand.

## 10. Versiebeheer

- De versie staat in de URL (`/api/v1`).
- Wijzigingen die niet compatibel zijn, komen in een nieuwe versie (`/api/v2`). `v1` blijft werken tot RevControl is overgestapt.
- Nieuwe velden kunnen zonder nieuwe versie worden toegevoegd. De koppeling moet onbekende velden negeren.

## 11. Contact

Kaya van Vliet — kayavanvliet@websharp.nl
