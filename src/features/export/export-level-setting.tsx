import { SubmitButton } from "@/components/submit-button";

import { exportMinLevelLabels, type ExportSettings } from "./min-level";
import { saveExportSettings } from "./min-level-actions";

/** What this account exports: in the Excel export and through the API. */
export function ExportLevelSetting({ current }: { current: ExportSettings }) {
  return <form action={saveExportSettings} className="panel export-level-setting">
    <fieldset>
      <legend><strong>Welke events wil je exporteren?</strong></legend>
      <p className="muted">Geldt voor de Excel-export en voor gekoppelde systemen.</p>
      {(["Medium", "High", "Low"] as const).map((level) => <label className="export-level-option" key={level}>
        <input type="radio" name="level" value={level} defaultChecked={current.minLevel === level} />
        <span><strong>{exportMinLevelLabels[level]}</strong>{level === "Low" && <><br /><span className="muted">Let op: dit voegt per hotel vaak meer dan 100 events toe.</span></>}</span>
      </label>)}
    </fieldset>
    <fieldset>
      <legend><strong>Feestdagen en schoolvakanties</strong></legend>
      <p className="muted">Gaan mee als Hoog. Heeft je systeem ze zelf al, laat dit dan uit: anders staan ze er dubbel in.</p>
      <label className="export-level-option">
        <input type="checkbox" name="publicHolidays" defaultChecked={current.publicHolidays} />
        <span><strong>Feestdagen meesturen</strong><br /><span className="muted">Zoals Koningsdag, Hemelvaart en Tweede Kerstdag.</span></span>
      </label>
      <label className="export-level-option">
        <input type="checkbox" name="schoolHolidays" defaultChecked={current.schoolHolidays} />
        <span><strong>Schoolvakanties meesturen</strong><br /><span className="muted">Alleen de vakanties van de regio van het hotel.</span></span>
      </label>
    </fieldset>
    <SubmitButton>Opslaan</SubmitButton>
  </form>;
}
