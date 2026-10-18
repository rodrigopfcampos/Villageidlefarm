// Tela "enquanto você esteve fora": tempo fora, tempo creditado, aviso do limite de 8 h e colher tudo.

import { useState } from 'preact/hooks';
import { ECONOMY, looksReady } from '@vif/shared';
import { newRequestId } from '../../core/ids';
import { Button, Glyph, Panel } from '../components';
import { useBus, useUi } from '../context';
import { formatDurationShort } from '../format';
import { STR } from '../strings';

export function OfflineReportPanel() {
  const ui = useUi();
  const { store, api } = ui.s;
  useBus(['plot:updated', 'farm:snapshot']);
  const [busy, setBusy] = useState(false);
  const r = store.offlineReport;
  if (!r) return null;
  const fc = store.estimatedFarmClock();
  const ready = [...store.plots.values()].filter((p) => looksReady(p, fc)).length;

  const harvestAll = async () => {
    setBusy(true);
    const res = await ui.mutate('harvestAll', () => api.harvestAll({ requestId: newRequestId() }));
    setBusy(false);
    if (res) {
      ui.toast('success', STR.offline.harvestedAll);
      ui.close();
    }
  };

  return (
    <Panel title={STR.offline.title} onClose={ui.close} width={560} class="vif-panel--offline">
      <div class="vif-offline">
        <p class="vif-big">{STR.offline.away(formatDurationShort(r.realSeconds))}</p>
        <p>{STR.offline.credited(formatDurationShort(r.creditedSeconds))}</p>
        {r.capped && (
          <p class="vif-banner vif-banner--warn" role="alert">
            <Glyph name="warn" />{' '}
            {STR.offline.capped(formatDurationShort(ECONOMY.OFFLINE_CAP_SECONDS))}
          </p>
        )}
        <p class="vif-strong">
          {ready > 0 ? STR.offline.readyPlots(ready) : STR.offline.noneReady}
        </p>
        <div class="vif-actions">
          <Button variant="flat" onClick={ui.close}>
            {STR.offline.continue}
          </Button>
          {ready > 0 && (
            <Button variant="gold" disabled={busy} onClick={() => void harvestAll()}>
              {STR.offline.harvestAll}
            </Button>
          )}
        </div>
      </div>
    </Panel>
  );
}
