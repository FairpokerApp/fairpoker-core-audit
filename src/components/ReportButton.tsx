import React, {useState} from "react";
import {useI18n} from "../lib/i18n";
import {ReportCategory, submitReport} from "../lib/auth";

const CATEGORIES: {value: ReportCategory; labelKey: 'reportCatReal_money' | 'reportCatChip_dumping' | 'reportCatCollusion' | 'reportCatHarassment' | 'reportCatOther'}[] = [
  {value: 'real_money', labelKey: 'reportCatReal_money'},
  {value: 'chip_dumping', labelKey: 'reportCatChip_dumping'},
  {value: 'collusion', labelKey: 'reportCatCollusion'},
  {value: 'harassment', labelKey: 'reportCatHarassment'},
  {value: 'other', labelKey: 'reportCatOther'},
];

// Compliance: a tucked-away report entry in the table toolbar. Lets a player
// flag suspected real-money gambling / chip dumping / collusion. Opening it is
// opt-in; it never interrupts a hand.
export default function ReportButton(props: {
  roomId?: string;
  playerId: string;
  members: string[];
  names: Map<string, string>;
}) {
  const {t} = useI18n();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<ReportCategory>('real_money');
  const [targetPeerId, setTargetPeerId] = useState('');
  const [detail, setDetail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const opponents = props.members.filter(peerId => peerId !== props.playerId);

  const reset = () => {
    setCategory('real_money');
    setTargetPeerId('');
    setDetail('');
    setError('');
    setDone(false);
    setBusy(false);
  };

  const close = () => {
    setOpen(false);
    reset();
  };

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      await submitReport({
        category,
        roomId: props.roomId || undefined,
        reportedPeerId: targetPeerId || undefined,
        detail: detail.trim() || undefined,
      });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className="report-button"
        aria-label={t('reportButton')}
        title={t('reportButton')}
        onClick={() => setOpen(true)}
      >
        <span aria-hidden="true">&#9873;</span>
      </button>

      {open && (
        <div className="report-overlay" role="dialog" aria-modal="true" aria-label={t('reportTitle')} onClick={close}>
          <div className="report-dialog" onClick={event => event.stopPropagation()}>
            <h2>{t('reportTitle')}</h2>

            {done ? (
              <>
                <p className="report-success">{t('reportSuccess')}</p>
                <div className="report-actions">
                  <button type="button" className="report-primary" onClick={close}>{t('close')}</button>
                </div>
              </>
            ) : (
              <>
                <p className="report-intro">{t('reportIntro')}</p>

                {opponents.length > 0 && (
                  <label className="report-field">
                    <span>{t('reportTargetLabel')}</span>
                    <select value={targetPeerId} onChange={event => setTargetPeerId(event.target.value)}>
                      <option value="">{t('reportTargetNone')}</option>
                      {opponents.map(peerId => (
                        <option key={peerId} value={peerId}>
                          {props.names.get(peerId) || peerId.slice(0, 8)}
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                <label className="report-field">
                  <span>{t('reportCategoryLabel')}</span>
                  <select value={category} onChange={event => setCategory(event.target.value as ReportCategory)}>
                    {CATEGORIES.map(item => (
                      <option key={item.value} value={item.value}>{t(item.labelKey)}</option>
                    ))}
                  </select>
                </label>

                <label className="report-field">
                  <span>{t('reportDetailLabel')}</span>
                  <textarea
                    value={detail}
                    maxLength={1000}
                    rows={3}
                    placeholder={t('reportDetailPlaceholder')}
                    onChange={event => setDetail(event.target.value)}
                  />
                </label>

                {error && <div className="report-error">{error}</div>}

                <div className="report-actions">
                  <button type="button" className="report-ghost" onClick={close} disabled={busy}>
                    {t('reportCancel')}
                  </button>
                  <button type="button" className="report-primary" onClick={submit} disabled={busy}>
                    {busy ? t('reportSending') : t('reportSubmit')}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
