export const accountMessages: Record<string, { text: string; success?: boolean }> = {
  invited: { text: "De uitnodiging is verstuurd. De ontvanger kan via de link zelf een wachtwoord kiezen.", success: true },
  resent: { text: "Een nieuwe wachtwoordlink is aangevraagd. De ontvanger kan hiermee een wachtwoord instellen.", success: true },
  deleted: { text: "De login is verwijderd. Hotels en exportgeschiedenis zijn bewaard.", success: true },
  disabled: { text: "Het account is uitgeschakeld.", success: true },
  input: { text: "Vul een accountnaam en een geldig e-mailadres in." },
  existing: { text: "Dit e-mailadres heeft al een login. Gebruik ‘Nieuwe wachtwoordlink’ bij de bestaande gebruiker." },
  missing: { text: "Dit account of deze gebruiker bestaat niet meer. Vernieuw de pagina." },
  protected: { text: "Beheerders en je eigen login kunnen hier niet worden verwijderd of aangepast." },
  inactive: { text: "Dit account is uitgeschakeld. Er kan geen uitnodiging of wachtwoordlink worden verstuurd." },
  rate: { text: "Er zijn te veel e-mails kort na elkaar aangevraagd. Wacht even en probeer opnieuw." },
  failed: { text: "De actie is niet gelukt. Probeer opnieuw. Blijft dit gebeuren, neem dan contact op met de beheerder." },
};
