import { SubmitButton } from "@/components/submit-button";

import { exportMinLevelLabels } from "./min-level";
import { saveExportMinLevel } from "./min-level-actions";
import type { ExportMinLevel } from "./types";

/** Which levels this account exports: in the Excel export and through the API. */
export function ExportLevelSetting({ current }: { current: ExportMinLevel }) {
  return <form action={saveExportMinLevel} className="panel export-level-setting">
    <fieldset>
      <legend><strong>Welke events wil je exporteren?</strong></legend>
      <p className="muted">Geldt voor de Excel-export en voor gekoppelde systemen.</p>
      {(["Medium", "High", "Low"] as const).map((level) => <label className="export-level-option" key={level}>
        <input type="radio" name="level" value={level} defaultChecked={current === level} />
        <span><strong>{exportMinLevelLabels[level]}</strong>{level === "Low" && <><br /><span className="muted">Let op: dit voegt per hotel vaak meer dan 100 events toe.</span></>}</span>
      </label>)}
    </fieldset>
    <SubmitButton>Opslaan</SubmitButton>
  </form>;
}
