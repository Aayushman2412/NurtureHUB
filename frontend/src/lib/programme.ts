/**
 * Programme-wide constants the screens share, served by the backend
 * (/api/metadata/programme) so one setting there — PNC_SPLIT_DAYS — moves the
 * MASD rules, the growth monitor's cohorts and every label together. The
 * values here are the defaults until the server answers.
 */
import i18n from 'i18next';
import client from '../api/client';

export const programme = {
  /** Age (days) at adoption splitting PNC adoptions into under / from N months. */
  pncSplitDays: 150,
  pncSplitMonths: 5,
};

function applyToLabels() {
  // Labels say "PNC <{{pncM}}M"; i18next fills these in every t() call.
  const interp = (i18n.options.interpolation ??= {});
  interp.defaultVariables = { ...(interp.defaultVariables ?? {}), pncM: programme.pncSplitMonths, pncDays: programme.pncSplitDays };
}

applyToLabels();

export async function loadProgramme(): Promise<void> {
  try {
    const { data } = await client.get('/api/metadata/programme');
    if (typeof data?.pnc_split_days === 'number') {
      const changed = data.pnc_split_days !== programme.pncSplitDays;
      programme.pncSplitDays = data.pnc_split_days;
      programme.pncSplitMonths = data.pnc_split_months ?? Math.round(data.pnc_split_days / 30);
      applyToLabels();
      // Re-render translated text with the new value (react-i18next listens).
      if (changed) i18n.emit('languageChanged', i18n.language);
    }
  } catch {
    // Offline or older server: the defaults stand.
  }
}
