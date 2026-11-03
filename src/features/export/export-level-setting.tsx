import { SubmitButton } from "@/components/submit-button";

import { exportMinLevelLabels } from "./min-level";
import { saveExportMinLevel } from "./min-level-actions";
import type { ExportMinLevel } from "./types";

const explanations: Record<ExportMinLevel, string> = {
  Medium: "Aanbevolen. Ook events die waarschijnlijk extra hotelgasten trekken, maar waarvan de omvang nog niet bekend is.",
  High: "Alleen events met aangetoonde grote hotelvraag. Je mist dan events die nog niet groot genoeg bewezen zijn.",
  Low: "Ook de verborgen Laag-events: per hotel zo'n 40 tot 180 extra, zoals voorstellingen, exposities en meetups. De meeste zeggen weinig over hotelvraag. Een event dat je op Laag zet, gaat dan ook mee.",
};

/** Which levels this account sends to RevControl, in the Excel export and through the API. */
export function ExportLevelSetting({ current }: { current: ExportMinLevel }) {
  return <form action={saveExportMinLevel} className="panel export-level-setting">
    <fieldset>
      <legend><strong>Welke events stuur je naar RevControl?</strong></legend>
      <p className="muted">Geldt voor de Excel-export en voor de automatische koppeling met RevControl.</p>
      {(["Medium", "High", "Low"] as const).map((level) => <label className="export-level-option" key={level}>
        <input type="radio" name="level" value={level} defaultChecked={current === level} />
        <span><strong>{exportMinLevelLabels[level]}</strong><br /><span className="muted">{explanations[level]}</span></span>
      </label>)}
    </fieldset>
    <SubmitButton>Opslaan</SubmitButton>
  </form>;
}
